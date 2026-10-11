import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { defaultKeyPath as configKeyPath } from "../core/config/index.js";

/**
 * Loopback OAuth login for the first-party OpenCode plugin. Flow:
 *
 * 1. Start a temporary HTTP server on 127.0.0.1 (first free port from 4567).
 * 2. Open the system browser at the control plane's authorize page with a
 *    state token and a PKCE S256 challenge.
 * 3. The user signs in (if needed) and approves; the site redirects back to
 *    the loopback server with a one-time code, which is verified against the
 *    state before anything else happens.
 * 4. Exchange the code (plus PKCE verifier) for an access token, shut the
 *    server down, and store the token in the key file with owner-only
 *    permissions — the same file the normal key resolution reads.
 *
 * Redirects are loopback-only by construction (we listen on 127.0.0.1 and
 * hand that exact URL to the site), so a code can never land anywhere else.
 */

export const OAUTH_CLIENT_ID = "opencode";
export const CALLBACK_PATH = "/callback";
const FIRST_PORT = 4567;
const LAST_PORT = 4576;
const CALLBACK_TIMEOUT_MS = 5 * 60_000;

export class OAuthLoginError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OAuthLoginError";
    this.code = code;
  }
}

export function createState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(
  controlPlaneUrl: string,
  options: { redirectUri: string; state: string; challenge: string }
): string {
  const url = new URL("/oauth/authorize", controlPlaneUrl.replace(/\/+$/, ""));
  url.searchParams.set("client_id", OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Extracts the code from a callback URL, verifying state first. */
export function parseCallbackUrl(rawUrl: string, expectedState: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl, "http://127.0.0.1");
  } catch {
    throw new OAuthLoginError("BAD_CALLBACK", "The callback URL is malformed.");
  }
  const error = url.searchParams.get("error");
  if (error) {
    throw new OAuthLoginError(
      "ACCESS_DENIED",
      error === "access_denied"
        ? "Authorization was denied in the browser."
        : `Authorization failed: ${error}`
    );
  }
  const state = url.searchParams.get("state");
  if (!state || state !== expectedState) {
    throw new OAuthLoginError(
      "STATE_MISMATCH",
      "The callback state does not match this login attempt. Start over — never approve a login you did not start."
    );
  }
  const code = url.searchParams.get("code");
  if (!code) {
    throw new OAuthLoginError("BAD_CALLBACK", "The callback carried no authorization code.");
  }
  return code;
}

export function defaultKeyPath(): string {
  return configKeyPath();
}

/** Stores the token with owner-only permissions; creates parent dirs. */
export function writeKeyFile(keyPath: string, apiKey: string): void {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, apiKey.trim() + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    // Windows has no POSIX modes; the write already restricted what it could.
  }
}

/** Opens the authorize page. Never throws: headless callers use the URL. */
export function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    // NOTE (Windows): the URL must be double-quoted. cmd.exe splits an
    // unquoted URL on & into separate commands, so the browser would receive
    // only ?client_id=... and the authorize page would report the rest
    // missing. The empty title ("") stays: without it start() eats the URL.
    const args =
      platform === "win32"
        ? ["/c", "start", "", `"${url}"`]
        : [url];
    const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // The URL is always returned alongside, so a failed open is directions,
    // not a failure.
  }
}

export interface OAuthLoginOptions {
  controlPlaneUrl: string;
  port?: number;
  timeoutMs?: number;
  keyPath?: string;
  openBrowser?: boolean;
  /** Called with the authorize URL (also opened automatically unless disabled). */
  onAuthorizeUrl?: (url: string) => void;
}

export interface OAuthLoginResult {
  apiKey: string;
  keyPath: string;
  authorizeUrl: string;
}

function successPage(): string {
  return [
    "<!doctype html><html><body style='background:#09090b;color:#e4e4e7;",
    "font-family:system-ui;display:flex;align-items:center;justify-content:center;",
    "height:100vh;margin:0'>",
    "<p>Ship-It is connected. You can close this tab and go back to OpenCode.</p>",
    "</body></html>",
  ].join("");
}

function failurePage(message: string): string {
  const safe = message.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return [
    "<!doctype html><html><body style='background:#09090b;color:#e4e4e7;",
    "font-family:system-ui;display:flex;align-items:center;justify-content:center;",
    "height:100vh;margin:0'>",
    `<p>Ship-It login failed: ${safe}</p>`,
    "</body></html>",
  ].join("");
}

export async function runOAuthLogin(options: OAuthLoginOptions): Promise<OAuthLoginResult> {
  const baseUrl = options.controlPlaneUrl.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new OAuthLoginError("BAD_CONTROL_PLANE", "Control plane URL must be http(s).");
  }
  const timeoutMs = options.timeoutMs ?? CALLBACK_TIMEOUT_MS;
  const keyPath = options.keyPath ?? defaultKeyPath();
  const state = createState();
  const { verifier, challenge } = createPkcePair();

  // Listen first: the redirect URI hands the site our exact port, and the
  // server must already be up before the browser can call back to it.
  const { server, port } = await listenLoopback(options.port);
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const authorizeUrl = buildAuthorizeUrl(baseUrl, { redirectUri, state, challenge });
  try {
    options.onAuthorizeUrl?.(authorizeUrl);
  } catch {
    // Reporting hook only; a throwing hook must not kill the login.
  }
  if (options.openBrowser !== false) {
    openBrowser(authorizeUrl);
  }

  let code: string;
  try {
    code = await waitForCallback(server, redirectUri, state, timeoutMs);
  } finally {
    server.close();
  }

  let token: { access_token?: string; error?: { message?: string } };
  try {
    const response = await fetch(`${baseUrl}/api/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        client_id: OAUTH_CLIENT_ID,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    token = (await response.json()) as typeof token;
    if (!response.ok || !token.access_token) {
      throw new OAuthLoginError(
        "TOKEN_EXCHANGE_FAILED",
        token?.error?.message ?? `Token exchange failed with status ${response.status}.`
      );
    }
  } catch (err) {
    if (err instanceof OAuthLoginError) throw err;
    throw new OAuthLoginError(
      "TOKEN_EXCHANGE_FAILED",
      err instanceof Error ? err.message : "Could not reach the control plane."
    );
  }

  writeKeyFile(keyPath, token.access_token);
  return { apiKey: token.access_token, keyPath, authorizeUrl };
}

async function waitForCallback(
  server: import("node:http").Server,
  redirectUri: string,
  state: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new OAuthLoginError(
          "CALLBACK_TIMEOUT",
          "No browser callback arrived in time. Run the login again."
        )
      );
    }, timeoutMs);

    server.on("request", (req, res) => {
      try {
        const host = req.headers.host ?? "127.0.0.1";
        const full = new URL(req.url ?? CALLBACK_PATH, `http://${host}`);
        if (full.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { "Content-Type": "text/html" });
          res.end(failurePage("Unknown callback path."));
          return;
        }
        const code = parseCallbackUrl(full.toString(), state);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(successPage());
        clearTimeout(timer);
        resolve(code);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Callback failed.";
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(failurePage(message));
        // Keep listening: a stray request (favicon, scanner) must not kill
        // the login. Only a timeout, a good callback, or a real error
        // (denial, state mismatch) ends the wait.
        if (err instanceof OAuthLoginError && err.code !== "BAD_CALLBACK") {
          clearTimeout(timer);
          reject(err);
        }
      }
    });
  });
}

async function listenLoopback(preferredPort: number | undefined): Promise<{
  server: import("node:http").Server;
  port: number;
}> {
  const http = await import("node:http");
  const ports: number[] = [];
  if (preferredPort) ports.push(preferredPort);
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    if (!ports.includes(port)) ports.push(port);
  }
  let lastError: unknown = null;
  for (const port of ports) {
    const server = http.createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      return { server, port };
    } catch (err) {
      lastError = err;
    }
  }
  throw new OAuthLoginError(
    "NO_PORT",
    `No free loopback port (${FIRST_PORT}-${LAST_PORT}). Close something and retry. ${String(lastError)}`
  );
}
