import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createState,
  createPkcePair,
  buildAuthorizeUrl,
  parseCallbackUrl,
  writeKeyFile,
  OAuthLoginError,
  OAUTH_CLIENT_ID,
} from "../src/oauth/login.js";

describe("OAuth PKCE pair", () => {
  it("produces a verifier/challenge that verify against each other", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    // Recompute the S256 the way the server does.
    return import("node:crypto").then((crypto) => {
      const expected = crypto
        .createHash("sha256")
        .update(verifier, "ascii")
        .digest("base64url");
      expect(challenge).toBe(expected);
    });
  });

  it("produces fresh state every time", () => {
    expect(createState()).not.toBe(createState());
  });
});

describe("authorize URL", () => {
  it("points at the site's authorize page with every parameter", () => {
    const url = new URL(
      buildAuthorizeUrl("https://ship-it-fri1.onrender.com/", {
        redirectUri: "http://127.0.0.1:4567/callback",
        state: "state-abc",
        challenge: "challenge-xyz",
      })
    );
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(OAUTH_CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:4567/callback");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-xyz");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("callback parsing", () => {
  const base = "http://127.0.0.1:4567/callback";

  it("returns the code on a matching state", () => {
    expect(parseCallbackUrl(`${base}?code=CODE123&state=s1`, "s1")).toBe("CODE123");
  });

  it("rejects state mismatch", () => {
    expect(() => parseCallbackUrl(`${base}?code=CODE123&state=other`, "s1")).toThrow(
      expect.objectContaining({ code: "STATE_MISMATCH" })
    );
  });

  it("surfaces denials distinctly", () => {
    expect(() => parseCallbackUrl(`${base}?error=access_denied&state=s1`, "s1")).toThrow(
      expect.objectContaining({ code: "ACCESS_DENIED" })
    );
  });

  it("rejects missing codes and garbage", () => {
    expect(() => parseCallbackUrl(`${base}?state=s1`, "s1")).toThrow(OAuthLoginError);
    expect(() => parseCallbackUrl(":::bad:::", "s1")).toThrow(OAuthLoginError);
  });
});

describe("key file", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipit-oauth-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes the key with a trailing newline for file readers", () => {
    const file = path.join(dir, "sub", "shipit.key");
    writeKeyFile(file, "ox_live_abc");
    expect(fs.readFileSync(file, "utf8")).toBe("ox_live_abc\n");
  });

  it("restricts permissions on POSIX", () => {
    if (process.platform === "win32") return;
    const file = path.join(dir, "shipit.key");
    writeKeyFile(file, "ox_live_abc");
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
