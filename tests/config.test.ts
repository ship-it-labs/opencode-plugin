import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeKey,
  loadConfig,
  API_KEY_FILE,
  findOpencodeConfigDirs,
  keyFileCandidates,
  defaultKeyPath,
  KEY_FILE_NAME,
  type ConfigOverrides,
} from "../src/core/config/index.js";

describe("normalizeKey", () => {
  it("accepts clean keys", () => {
    expect(normalizeKey("ox_live_abc123")).toBe("ox_live_abc123");
    expect(normalizeKey("ox_test_abc123")).toBe("ox_test_abc123");
  });

  it("trims pasted whitespace and newlines", () => {
    expect(normalizeKey("  ox_live_abc123\n")).toBe("ox_live_abc123");
    expect(normalizeKey("ox_live_abc123\r\n")).toBe("ox_live_abc123");
  });

  it("strips launcher quotes", () => {
    expect(normalizeKey('"ox_live_abc123"')).toBe("ox_live_abc123");
    expect(normalizeKey("'ox_live_abc123'")).toBe("ox_live_abc123");
  });

  it("rejects empties, garbage and non-strings", () => {
    expect(normalizeKey("")).toBeUndefined();
    expect(normalizeKey("   ")).toBeUndefined();
    expect(normalizeKey("not-a-key")).toBeUndefined();
    expect(normalizeKey(undefined)).toBeUndefined();
    expect(normalizeKey(null)).toBeUndefined();
    expect(normalizeKey(42)).toBeUndefined();
  });
});

describe("shipit.key next to opencode config", () => {
  const saved = { ...process.env };
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipit-cfg-"));
    delete process.env[API_KEY_FILE];
    // A stray SHIPIT_API_KEY in the dev environment must never authenticate.
    delete process.env["SHIPIT_API_KEY"];
  });

  afterEach(() => {
    process.env = { ...saved };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads shipit.key from the same dir as opencode.jsonc", () => {
    fs.writeFileSync(path.join(dir, "opencode.jsonc"), '{ "plugin": [] }\n');
    fs.writeFileSync(path.join(dir, "shipit.key"), "ox_live_fromfile\n");
    const config = loadConfig({}, { cwd: dir });
    expect(config.apiKey).toBe("ox_live_fromfile");
    expect(config.keyFile).toBe(path.join(dir, "shipit.key"));
  });

  it("reads shipit.key from the same dir as opencode.json", () => {
    fs.writeFileSync(path.join(dir, "opencode.json"), '{ "plugin": [] }\n');
    fs.writeFileSync(path.join(dir, "shipit.key"), "  ox_test_fromjson  \n");
    expect(loadConfig({}, { cwd: dir }).apiKey).toBe("ox_test_fromjson");
  });

  it("reads shipit.key from a .opencode/ config dir", () => {
    const sub = path.join(dir, ".opencode");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "opencode.json"), '{ "plugin": [] }\n');
    fs.writeFileSync(path.join(sub, "shipit.key"), "ox_live_dotopencode\n");
    expect(loadConfig({}, { cwd: dir }).apiKey).toBe("ox_live_dotopencode");
  });

  it("prefers the nearest project config walking up", () => {
    fs.writeFileSync(path.join(dir, "opencode.jsonc"), "{}\n");
    fs.writeFileSync(path.join(dir, "shipit.key"), "ox_live_outer\n");
    const inner = path.join(dir, "a", "b");
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(inner, "opencode.jsonc"), "{}\n");
    fs.writeFileSync(path.join(inner, "shipit.key"), "ox_live_inner\n");
    expect(loadConfig({}, { cwd: inner }).apiKey).toBe("ox_live_inner");
    expect(loadConfig({}, { cwd: inner }).keyFile).toBe(
      path.join(inner, "shipit.key")
    );
  });

  it("ignores the SHIPIT_API_KEY env var: file is the only source", () => {
    fs.writeFileSync(path.join(dir, "opencode.jsonc"), "{}\n");
    fs.writeFileSync(path.join(dir, "shipit.key"), "ox_live_filewins\n");
    process.env["SHIPIT_API_KEY"] = "ox_live_fromenv";
    expect(loadConfig({}, { cwd: dir }).apiKey).toBe("ox_live_filewins");
  });

  it("never authenticates from the SHIPIT_API_KEY env var alone", () => {
    const empty = path.join(dir, "empty");
    fs.mkdirSync(empty, { recursive: true });
    process.env["SHIPIT_API_KEY"] = "ox_live_envonly";
    const apiKey = loadConfig({}, { cwd: empty }).apiKey;
    // Either undefined or a real global file key — but never the env value.
    expect(apiKey).not.toBe("ox_live_envonly");
  });

  it("always uses shipit.key: an apiKey option cannot override it", () => {
    fs.writeFileSync(path.join(dir, "opencode.jsonc"), "{}\n");
    fs.writeFileSync(path.join(dir, "shipit.key"), "ox_live_fromfile\n");
    const config = loadConfig(
      { apiKey: "ox_live_override" } as unknown as ConfigOverrides,
      { cwd: dir }
    );
    expect(config.apiKey).toBe("ox_live_fromfile");
    expect(config.keyFile).toBe(path.join(dir, "shipit.key"));
  });

  it("honours SHIPIT_API_KEY_FILE as an explicit path override", () => {
    const custom = path.join(dir, "custom.key");
    fs.writeFileSync(custom, "ox_live_custom\n");
    process.env[API_KEY_FILE] = custom;
    expect(loadConfig({}, { cwd: dir }).apiKey).toBe("ox_live_custom");
  });

  it("findOpencodeConfigDirs lists nearest first", () => {
    fs.writeFileSync(path.join(dir, "opencode.jsonc"), "{}\n");
    const inner = path.join(dir, "sub");
    fs.mkdirSync(inner, { recursive: true });
    const dirs = findOpencodeConfigDirs(inner);
    expect(dirs[0]).toBe(dir);
  });

  it("defaultKeyPath lands next to the project config", () => {
    fs.writeFileSync(path.join(dir, "opencode.jsonc"), "{}\n");
    expect(defaultKeyPath(dir)).toBe(path.join(dir, KEY_FILE_NAME));
  });

  it("keyFileCandidates includes project and global keys", () => {
    fs.writeFileSync(path.join(dir, "opencode.jsonc"), "{}\n");
    const candidates = keyFileCandidates(dir);
    expect(candidates).toContain(path.join(dir, KEY_FILE_NAME));
    expect(candidates[candidates.length - 1].endsWith("shipit-key.txt")).toBe(
      true
    );
  });
});
