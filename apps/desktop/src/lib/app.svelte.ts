import type { DeviRequest, Draft, FileMeta, UserEvent } from "@devi/protocol";
import { type DeviApi, errorMessage } from "./api";
import { type AuditEntry, auditNotice } from "./audit";
import { Clock } from "./clock.svelte";
import { type ConversationsHttp, type NativeFiles, conversationsHttp, nativeFiles } from "./conversations-api";
import type { MascotState } from "./mascot";
import { type AppPrefs, type ClientConfig, type Native, type ServerStatus, prefsOf } from "./native";
import { type Notice, noticeFor, noticeKey, shouldNotify, summaryNotice } from "./notify";
import { ConnectionStore } from "./stores/connection.svelte";
import { ComposerStore, DragState } from "./stores/composer.svelte";
import { ConversationsStore } from "./stores/conversations.svelte";
import { type Card, InboxStore } from "./stores/inbox.svelte";
import { SessionsStore } from "./stores/sessions.svelte";
import { TeamStore } from "./stores/team.svelte";
import { AGENT_THREAD, waitingByPeer } from "./thread-items";
import { ThreadStore } from "./stores/thread.svelte";

export type View = "bandeja" | "ajustes" | "admin";
export type Phase = "loading" | "wizard" | "app";

export type AppDeps = {
  native: Native;
  makeApi: (config: ClientConfig) => DeviApi;
  notify: (n: Notice) => void | Promise<void>;
  emitMascot: (s: MascotState) => void;
  // Solo la ventana principal: lleva el número de pendientes al icono de la bandeja.
  trayAttention?: (pending: number) => void;
  // Conversaciones y archivos nativos; por defecto, los reales.
  conversations?: (api: DeviApi) => ConversationsHttp;
  files?: NativeFiles;
};

// Tras varios eventos seguidos, la lista de conversaciones se pide una sola vez.
const CONVERSATIONS_DEBOUNCE_MS = 250;

const MAX_RETRY_MS = 30_000;

// Tras cada "open" el servidor reenvía las tarjetas abiertas, sin marca de fin. Se da por
// terminado el reenvío cuando pasan REPLAY_QUIET_MS sin eventos (o REPLAY_MAX_MS desde open).
export const REPLAY_QUIET_MS = 300;
const REPLAY_MAX_MS = 3_000;

type Replay = { cards: Map<string, Card>; timer: ReturnType<typeof setTimeout> | null; deadline: number };

// Estado global de la ventana principal. Una instancia por ventana (la crea Shell).
export class DeviApp {
  phase = $state<Phase>("loading");
  view = $state<View>("bandeja");
  config = $state<ClientConfig | null>(null);
  prefs = $derived(prefsOf(this.config));
  paused = $state(false);
  pokeKey = $state(0);
  server = $state<ServerStatus | null>(null);
  // Alertas de seguridad (audit.alert) aún no vistas en Admin → Auditoría: dan el número de la pestaña.
  auditAlerts = $state<AuditEntry[]>([]);
  serverError = $state<string | null>(null);

  readonly conn = new ConnectionStore();
  readonly team = new TeamStore();
  readonly inbox = new InboxStore();
  readonly sessions = new SessionsStore();
  readonly clock = new Clock(); // lo arranca y lo para Shell
  readonly convos = new ConversationsStore();
  readonly thread = new ThreadStore();
  readonly composer = new ComposerStore();
  readonly drag = new DragState();
  // Persona de la conversación abierta (null = ninguna).
  selected = $state<string | null>(null);
  // Lo que espera de mí cada persona según la bandeja (tarjetas abiertas y borradores).
  waiting = $derived(waitingByPeer(this.inbox.cards, (id) => this.lookupRequest(id)));

  private readonly deps: AppDeps;
  private api: DeviApi | null = null;
  private http: ConversationsHttp | null = null;
  private convosTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  // Cada connect()/disconnect() la sube; un connect() que despierta con otra generación se retira.
  private generation = 0;
  private readonly notified = new Set<string>();
  private readonly alerted = new Set<number>();
  private replay: Replay | null = null;
  private trayPending = -1;

  constructor(deps: AppDeps) {
    this.deps = deps;
  }

  get native(): Native {
    return this.deps.native;
  }

  get files(): NativeFiles {
    return this.deps.files ?? nativeFiles;
  }

  // ---- arranque y conexión -------------------------------------------------------

  async boot(): Promise<void> {
    try {
      this.config = await this.deps.native.readConfig();
    } catch (e) {
      console.error("[devi] no se pudo leer config.json", e);
      this.config = null;
    }
    if (!this.config?.serverUrl || !this.prefs.setupDone) {
      this.phase = "wizard";
      return;
    }
    await this.startLocalServer();
    this.phase = "app";
    await this.connect();
  }

  makeApi(config: ClientConfig): DeviApi {
    return this.deps.makeApi(config);
  }

  async connect(): Promise<void> {
    this.disconnect(); // sube la generación: cualquier connect() anterior queda obsoleto
    const gen = this.generation;
    const config = this.config;
    if (!config?.serverUrl) return;
    const api = this.deps.makeApi(config);
    this.api = api;
    this.http = (this.deps.conversations ?? conversationsHttp)(api);
    if (this.conn.state.status !== "reconnecting") this.conn.set({ status: "connecting" });
    try {
      await this.team.refresh(api);
    } catch (e) {
      if (gen !== this.generation) return;
      this.conn.fail(e);
      if (this.conn.state.status === "reconnecting") this.scheduleRetry();
      this.publishMascot();
      return;
    }
    if (gen !== this.generation) return;
    this.retries = 0;
    const off = api.subscribe(
      (ev) => {
        if (gen === this.generation) this.onEvent(ev);
      },
      (status, err) => {
        if (gen === this.generation) this.onStatus(status, err);
      },
    );
    // subscribe() es síncrono, pero si algo desconectó entretanto no se deja colgando.
    if (gen !== this.generation) {
      off();
      return;
    }
    this.unsubscribe = off;
    this.publishMascot();
  }

  disconnect(): void {
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.convosTimer) clearTimeout(this.convosTimer);
    this.convosTimer = null;
    this.cancelReplay();
  }

  // Espera exponencial: 1 s, 2 s, 4 s… hasta 30 s.
  private scheduleRetry(): void {
    const delay = Math.min(MAX_RETRY_MS, 1000 * 2 ** this.retries);
    this.retries++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private onStatus(status: string, err?: unknown): void {
    const before = this.conn.state.status;
    this.conn.fromClient(status, err);
    if (this.conn.state.status === "connected" && before !== "connected") {
      // Al conectar, el servidor reenvía las tarjetas abiertas: se parte de cero.
      this.inbox.clear();
      this.startReplay();
      if (this.api) void this.team.refresh(this.api).catch(() => {});
      void this.refreshConversations();
    } else if (this.conn.state.status !== "connected") {
      // Se cortó antes de acabar el reenvío: esas tarjetas se volverán a reenviar y contar.
      this.cancelReplay();
    }
    if (this.conn.blocked) this.disconnect();
    this.publishMascot();
  }

  private onEvent(ev: UserEvent): void {
    const me = this.team.myId;
    if (!me || !this.api) return;
    if (ev.type === "audit.alert") {
      this.onAuditAlert(ev.entry);
      return;
    }
    if (ev.type === "conversation.updated") {
      this.scheduleConversations();
      if (this.selected === ev.memberId) void this.reloadThread();
      return;
    }
    if (ev.type === "team.updated") {
      void this.team.refresh(this.api).catch(() => {});
      return;
    }
    if (ev.type === "sessions.updated") {
      if (ev.memberId === me) void this.sessions.load(this.api, me);
      return;
    }
    if ("request" in ev) {
      this.thread.upsert(ev.request);
      this.scheduleConversations();
    }
    const added = this.inbox.apply(ev, me);
    if (added) {
      if (this.replay) this.collectReplayed(added);
      else this.announce(added);
    }
    this.publishMascot();
  }

  // @devi/client ya validó la entrada con UserEventSchema.
  private onAuditAlert(entry: AuditEntry): void {
    if (!this.team.isAdmin || this.alerted.has(entry.id)) return;
    this.alerted.add(entry.id);
    this.auditAlerts = [entry, ...this.auditAlerts];
    // Un cambio de seguridad avisa aunque Devi esté en pausa; solo lo silencia desactivar los avisos.
    if (this.prefs.notifications) void this.deps.notify(auditNotice(entry, (id) => this.team.nameOf(id)));
  }

  clearAuditAlerts(): void {
    this.auditAlerts = [];
  }

  private announce(card: Card): void {
    const key = noticeKey(card);
    if (this.notified.has(key)) return;
    this.notified.add(key);
    this.pokeKey++;
    if (shouldNotify(this.prefs, this.paused)) {
      void this.deps.notify(noticeFor(card, (id) => this.team.nameOf(id)));
    }
  }

  // ---- reenvío inicial: un solo aviso resumen en vez de uno por tarjeta ----------------

  private startReplay(): void {
    this.cancelReplay();
    this.replay = { cards: new Map(), timer: null, deadline: Date.now() + REPLAY_MAX_MS };
    this.armReplay();
  }

  private armReplay(): void {
    const r = this.replay;
    if (!r) return;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(() => this.flushReplay(), Math.max(0, Math.min(REPLAY_QUIET_MS, r.deadline - Date.now())));
  }

  private cancelReplay(): void {
    if (this.replay?.timer) clearTimeout(this.replay.timer);
    this.replay = null;
  }

  private collectReplayed(card: Card): void {
    const key = noticeKey(card);
    if (!this.notified.has(key)) this.replay?.cards.set(key, card);
    this.armReplay();
  }

  private flushReplay(): void {
    const r = this.replay;
    this.replay = null;
    if (!r) return;
    const open = new Set(this.inbox.cards.map((c) => c.key));
    const fresh = [...r.cards.entries()].filter(([key, c]) => !this.notified.has(key) && open.has(c.key));
    if (fresh.length === 0) return;
    for (const [key] of fresh) this.notified.add(key);
    this.pokeKey++;
    if (shouldNotify(this.prefs, this.paused)) {
      const first = fresh[0]![1];
      void this.deps.notify(fresh.length === 1 ? noticeFor(first, (id) => this.team.nameOf(id)) : summaryNotice(fresh.length));
    }
    this.publishMascot();
  }

  publishMascot(): void {
    this.deps.emitMascot({
      online: this.conn.online,
      pending: this.inbox.pending,
      label: this.conn.label,
      pokeKey: this.pokeKey,
    });
    // Al icono de la bandeja solo cuando cambia el número.
    if (this.deps.trayAttention && this.inbox.pending !== this.trayPending) {
      this.trayPending = this.inbox.pending;
      this.deps.trayAttention(this.trayPending);
    }
  }

  // ---- modo servidor ----------------------------------------------------------------

  async startLocalServer(): Promise<void> {
    const login = this.prefs.serverAdminLogin;
    if (!login) return;
    this.serverError = null;
    try {
      this.server = await this.deps.native.startServer(login);
    } catch (e) {
      // P. ej. "Ya hay un servidor de Devi en el puerto 4747…": se muestra en Ajustes.
      this.serverError = errorMessage(e);
      this.server = { running: false, pid: null, exitCode: null, log: [] };
    }
  }

  async stopLocalServer(): Promise<void> {
    this.server = await this.deps.native.stopServer();
  }

  async refreshServerStatus(): Promise<void> {
    this.server = await this.deps.native.serverStatus();
  }

  // ---- acciones de las tarjetas ------------------------------------------------------

  private need(): DeviApi {
    if (!this.api) throw new Error("Sin conexión con el servidor de Devi");
    return this.api;
  }

  call<T>(fn: (api: DeviApi) => Promise<T>): Promise<T> {
    return fn(this.need());
  }

  // Acción de admin: tras ella se recarga el equipo (el evento team.updated también llegará).
  async admin<T>(fn: (api: DeviApi) => Promise<T>): Promise<T> {
    const api = this.need();
    const out = await fn(api);
    await this.team.refresh(api);
    return out;
  }

  private applyRequest(r: DeviRequest): void {
    const me = this.team.myId;
    if (me) this.inbox.applyRequest(r, me);
    this.thread.upsert(r);
    this.scheduleConversations();
    this.publishMascot();
  }

  downloadFile(id: string): Promise<string> {
    return this.need().downloadFile(id);
  }

  async authorizeDraft(d: Draft): Promise<void> {
    await this.need().authorizeDraft(d.id);
    this.inbox.remove(`draft:${d.id}`);
    this.publishMascot();
  }

  async discardDraft(d: Draft): Promise<void> {
    await this.need().discardDraft(d.id);
    this.inbox.remove(`draft:${d.id}`);
    this.publishMascot();
  }

  // Enviar a sesión: solo avisa al servidor. El MCP de esa sesión (o el hook, sin canal) descarga
  // los archivos en la carpeta de recibidos.
  async forward(r: DeviRequest, sessionId: string): Promise<void> {
    this.applyRequest(await this.need().forwardRequest(r.id, sessionId));
  }

  async forwardResponse(r: DeviRequest, sessionId: string): Promise<void> {
    this.applyRequest(await this.need().forwardResponse(r.id, sessionId));
  }

  async accept(r: DeviRequest, note: string): Promise<void> {
    this.applyRequest(await this.need().acceptRequest(r.id, note || undefined));
  }

  async reject(r: DeviRequest, reason: string): Promise<void> {
    this.applyRequest(await this.need().rejectRequest(r.id, reason));
  }

  async acceptResponse(r: DeviRequest): Promise<void> {
    this.applyRequest(await this.need().acceptResponse(r.id));
  }

  async resend(r: DeviRequest): Promise<void> {
    this.applyRequest(await this.need().resendRequest(r.id));
  }

  async ignore(r: DeviRequest): Promise<void> {
    this.applyRequest(await this.need().ignoreRequest(r.id));
  }

  // Descarga del servidor y guarda en <recibidos>/<id>/ o <recibidos>/<id>/respuesta/
  // (Rust sanea y confina; es la misma carpeta que usa el MCP).
  async saveFiles(requestId: string, kind: "request" | "response", files: FileMeta[]): Promise<string[]> {
    const api = this.need();
    const contents = await Promise.all(files.map(async (f) => ({ name: f.name, content: await api.downloadFile(f.id) })));
    return this.deps.native.saveReceivedFiles(requestId, kind, contents);
  }

  async loadSessions(): Promise<void> {
    const me = this.team.myId;
    if (me && this.api) await this.sessions.load(this.api, me);
  }

  // ---- conversaciones -----------------------------------------------------------------

  // Una solicitud conocida por su id: en la bandeja o en el hilo abierto.
  lookupRequest(id: string): DeviRequest | undefined {
    return this.inbox.requestById(id) ?? this.thread.requests.find((r) => r.id === id);
  }

  async refreshConversations(): Promise<void> {
    if (this.http) await this.convos.load(this.http);
  }

  private scheduleConversations(): void {
    if (this.convosTimer) clearTimeout(this.convosTimer);
    this.convosTimer = setTimeout(() => {
      this.convosTimer = null;
      void this.refreshConversations();
    }, CONVERSATIONS_DEBOUNCE_MS);
  }

  async openConversation(memberId: string): Promise<void> {
    this.view = "bandeja";
    if (this.selected !== memberId || this.composer.to !== memberId) await this.composer.reset(this.files, memberId);
    this.selected = memberId;
    if (memberId === AGENT_THREAD) this.thread.close();
    else if (this.http) await this.thread.open(this.http, memberId);
  }

  closeConversation(): void {
    this.selected = null;
    this.thread.close();
    void this.composer.reset(this.files);
  }

  async reloadThread(): Promise<void> {
    if (this.http && this.selected) await this.thread.open(this.http, this.selected);
  }

  async loadOlder(): Promise<void> {
    if (this.http) await this.thread.loadMore(this.http);
  }

  async pickFiles(): Promise<void> {
    this.composer.add(this.files, await this.files.pickFiles());
  }

  // Enviar desde la app: la solicitud nueva entra en el hilo en cuanto el servidor la devuelve.
  async sendMessage(): Promise<void> {
    if (!this.http) throw new Error("Sin conexión con el servidor de Devi");
    const r = await this.composer.send(this.http, this.files);
    if (!r) return;
    this.thread.upsert(r);
    this.scheduleConversations();
  }

  // Archivos arrastrados y soltados sobre la ventana (Rust los lee y da tokens).
  listenForDrops(): () => void {
    const offs = [
      this.files.onDragHover((s) => (this.drag.active = s.active)),
      this.files.onFilesDropped((r) => {
        this.drag.active = false;
        if (this.selected) this.composer.add(this.files, r);
        else void this.files.discardFiles(r.files.map((f) => f.token)).catch(() => {});
      }),
    ];
    return () => {
      for (const off of offs) void off.then((f) => f()).catch(() => {});
    };
  }

  // ---- configuración y navegación ------------------------------------------------------

  async saveConfig(next: ClientConfig): Promise<void> {
    const plain = $state.snapshot(next) as ClientConfig;
    await this.deps.native.writeConfig(plain);
    this.config = plain;
  }

  async updatePrefs(patch: Partial<AppPrefs>): Promise<void> {
    if (!this.config) return;
    await this.saveConfig({ ...this.config, app: { ...this.prefs, ...patch } });
  }

  // Ajustes → "Mostrar a Devi flotando": primero la ventana y luego la preferencia; si no se puede
  // guardar, se deshace para que lo que se ve coincida con lo guardado.
  async setShowMascot(on: boolean): Promise<void> {
    await this.deps.native.setMascotVisible(on);
    try {
      await this.updatePrefs({ showMascot: on });
    } catch (e) {
      await this.deps.native.setMascotVisible(!on).catch(() => {});
      throw e;
    }
  }

  // La carpeta de recibidos la elige Rust con el diálogo nativo; el webview nunca da la ruta.
  async chooseReceivedDir(): Promise<void> {
    const cfg = await this.deps.native.chooseReceivedDir();
    if (cfg) this.config = cfg;
  }

  async resetReceivedDir(): Promise<void> {
    this.config = await this.deps.native.resetReceivedDir();
  }

  async changeServer(url: string): Promise<void> {
    if (!this.config) return;
    await this.saveConfig({ ...this.config, serverUrl: url });
    await this.connect();
  }

  // Paso 3 del asistente: en cuanto la conexión funciona se guarda config.json (setupDone: false),
  // para que `devi install-integration` y `devi doctor` (pasos 4 y 5) ya vean el servidor.
  async saveWizardConfig(config: ClientConfig): Promise<void> {
    await this.saveConfig({ ...config, app: { ...prefsOf(config), setupDone: false } });
  }

  // Último paso: solo marca setupDone y conecta.
  async finishWizard(): Promise<void> {
    if (!this.config) throw new Error("Falta la configuración: vuelve al paso 3 del asistente");
    await this.saveConfig({ ...this.config, app: { ...this.prefs, setupDone: true } });
    this.phase = "app";
    this.view = "bandeja";
    await this.connect();
  }

  restartWizard(): void {
    this.disconnect();
    this.phase = "wizard";
  }

  // Al volver a ejecutar el asistente: mientras config.json siga completo (el paso 3 aún no lo
  // ha reescrito con setupDone: false) se puede volver a la app sin cambiar nada.
  get canCancelWizard(): boolean {
    return !!this.config?.serverUrl && this.prefs.setupDone;
  }

  async cancelWizard(): Promise<void> {
    if (!this.canCancelWizard) return;
    this.phase = "app";
    await this.connect();
  }

  // Desde el tray (evento): solo estado local.
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  // Desde la UI: también actualiza la casilla del tray. Si falla, se deshace y se propaga el error.
  async togglePause(paused: boolean): Promise<void> {
    const before = this.paused;
    this.paused = paused;
    try {
      await this.deps.native.setPaused(paused);
    } catch (e) {
      this.paused = before;
      throw e;
    }
  }

  goto(view: View): void {
    this.view = view;
  }
}
