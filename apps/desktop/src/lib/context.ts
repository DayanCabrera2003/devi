import { getContext, setContext } from "svelte";
import type { DeviApp } from "./app.svelte";

const KEY = Symbol("devi-app");

export const provideApp = (app: DeviApp) => setContext(KEY, app);

export function useApp(): DeviApp {
  const app = getContext<DeviApp | undefined>(KEY);
  if (!app) throw new Error("useApp() fuera de <Shell>");
  return app;
}
