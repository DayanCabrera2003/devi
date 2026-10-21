import { describe, expect, test } from "bun:test";
import { MIN_CLAUDE_CODE_VERSION, approvalFor } from "./approval";

describe("dónde aprueba el humano: chat de Claude Code o app de Devi", () => {
  test("Claude Code con la versión mínima o posterior → chat", () => {
    expect(approvalFor({ name: "claude-code", version: MIN_CLAUDE_CODE_VERSION }, undefined)).toBe("chat");
    expect(approvalFor({ name: "claude-code", version: "2.1.307" }, undefined)).toBe("chat");
    expect(approvalFor({ name: "claude-code", version: "2.2.0" }, undefined)).toBe("chat");
    expect(approvalFor({ name: "claude-code", version: "3.0.0-beta.1" }, undefined)).toBe("chat");
  });

  test("Claude Code anterior, sin versión legible, otro cliente o sin clientInfo → app", () => {
    expect(approvalFor({ name: "claude-code", version: "2.1.245" }, undefined)).toBe("app");
    expect(approvalFor({ name: "claude-code", version: "2.0.999" }, undefined)).toBe("app");
    expect(approvalFor({ name: "claude-code", version: "1.9.0" }, undefined)).toBe("app");
    expect(approvalFor({ name: "claude-code", version: "dev" }, undefined)).toBe("app");
    expect(approvalFor({ name: "cursor", version: "9.9.9" }, undefined)).toBe("app");
    expect(approvalFor({ name: "Claude Code", version: "2.1.307" }, undefined)).toBe("app");
    expect(approvalFor(undefined, undefined)).toBe("app");
  });

  test("DEVI_APPROVAL manda sobre la detección", () => {
    expect(approvalFor({ name: "claude-code", version: "2.1.307" }, "app")).toBe("app");
    expect(approvalFor({ name: "cursor", version: "1.0.0" }, "chat")).toBe("chat");
    expect(approvalFor(undefined, " CHAT ")).toBe("chat");
    // Un valor desconocido no cuenta: se usa la detección.
    expect(approvalFor({ name: "claude-code", version: "2.1.307" }, "auto")).toBe("chat");
    expect(approvalFor(undefined, "")).toBe("app");
  });
});
