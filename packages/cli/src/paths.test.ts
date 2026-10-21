import { describe, expect, test } from "bun:test";
import { appDataDir, clientConfigPath, defaultReceivedDir, marketplaceDir, stableBinPath } from "./paths";

const linux = { platform: "linux" as const, env: {}, home: "/home/a" };
const mac = { platform: "darwin" as const, env: {}, home: "/Users/a" };
const win = {
  platform: "win32" as const,
  env: { APPDATA: "C:\\Users\\a\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" },
  home: "C:\\Users\\a",
};

describe("rutas por sistema operativo", () => {
  test("config del cliente", () => {
    expect(clientConfigPath(linux)).toBe("/home/a/.config/devi/config.json");
    expect(clientConfigPath({ ...linux, env: { XDG_CONFIG_HOME: "/x" } })).toBe("/x/devi/config.json");
    expect(clientConfigPath(mac)).toBe("/Users/a/Library/Application Support/devi/config.json");
    expect(clientConfigPath(win)).toBe("C:\\Users\\a\\AppData\\Roaming\\devi\\config.json");
    expect(clientConfigPath({ ...linux, env: { DEVI_CONFIG: "/tmp/c.json" } })).toBe("/tmp/c.json");
  });

  test("binario estable y marketplace", () => {
    expect(stableBinPath(linux)).toBe("/home/a/.local/share/devi/bin/devi");
    expect(stableBinPath(mac)).toBe("/Users/a/Library/Application Support/Devi/bin/devi");
    expect(stableBinPath(win)).toBe("C:\\Users\\a\\AppData\\Local\\Devi\\bin\\devi.exe");
    expect(marketplaceDir(linux)).toBe("/home/a/.local/share/devi/marketplace");
    expect(marketplaceDir(win)).toBe("C:\\Users\\a\\AppData\\Local\\Devi\\marketplace");
    expect(appDataDir({ ...linux, env: { XDG_DATA_HOME: "/d" } })).toBe("/d/devi");
  });

  test("carpeta de recibidos por defecto", () => {
    expect(defaultReceivedDir(linux)).toBe("/home/a/Devi/recibidos");
    expect(defaultReceivedDir(win)).toBe("C:\\Users\\a\\Devi\\recibidos");
  });
});
