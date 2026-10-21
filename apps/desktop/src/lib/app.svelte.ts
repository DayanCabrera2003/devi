import type { DeviRequest, Draft, FileMeta, UserEvent } from "@devi/protocol";
import { type DeviApi, errorMessage } from "./api";
import type { MascotState } from "./mascot";
import { type AppPrefs, type ClientConfig, type Native, type ServerStatus, prefsOf } from "./native";
import { type Notice, noticeFor, noticeKey, shouldNotify, summaryNotice } from "./notify";
import { ConnectionStore } from "./stores/connection.svelte";
import { type Card, InboxStore } from "./stores/inbox.svelte";
import { SessionsStore } from "./stores/sessions.svelte";
import { TeamStore } from "./stores/team.svelte";

export type View = "bandeja" | "ajustes" | "admin";
export type Phase = "loading" | "wizard" | "app";

export type AppDeps = {
  native: Native;
  makeApi: (config: ClientConfig) => DeviApi;
  notify: (n: Notice) => void | Promise<void>;
  emitMascot: (s: MascotState) => void;
};

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
  serverError = $state<string | null>(null);

  readonly conn = new ConnectionStore();
  readonly team = new TeamStore();
  readonly inbox = new InboxStore();
  readonly sessions = new SessionsStore();

  private readonly deps: AppDeps;
  private api: DeviApi | null = null;
  private unsubscribe: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  // Cada connect()/disconnect() la sube; un connect() que despierta con otra generación se retira.
  private generation = 0;
  private readonly notified = new Set<string>();
  private replay: Replay | null = null;

  constructor(deps: AppDeps) {
    this.deps = deps;
  }

  get native(): Native {
    return this.deps.native;
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
    if (ev.type === "team.updated") {
      void this.team.refresh(this.api).catch(() => {});
      return;
    }
    if (ev.type === "sessions.updated") {
      if (ev.memberId === me) void this.sessions.load(this.api, me);
      return;
    }
    const added = this.inbox.apply(ev, me);
    if (added) {
      if (this.replay) this.collectReplayed(added);
      else this.announce(added);
    }
    this.publishMascot();
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

  // Enviar a sesión: solo avisa al servidor. El MCP de esa sesión descarga los archivos
  // en la carpeta de recibidos (decisión entre fases, opción 2).
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

  // Desde el tray (evento): solo estado local.
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  // Desde la UI: también actualiza la casilla del tray.
  async togglePause(paused: boolean): Promise<void> {
    this.paused = paused;
    await this.deps.native.setPaused(paused).catch(() => {});
  }

  goto(view: View): void {
    this.view = view;
  }
}
