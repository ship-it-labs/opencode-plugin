import { tool } from "@opencode-ai/plugin";
import type { SessionState } from "../../core/state/session.js";
import type { ToolRegistry } from "../types.js";
import { formatError } from "../build/index.js";
import { runOAuthLogin, OAuthLoginError } from "../../oauth/login.js";

export function createAuthTools(state: SessionState, controlPlaneUrl: string): ToolRegistry {
  void state;
  // Deliberately needs no API key: this is how the key comes to exist.
  const login = tool({
    description: [
      "Connect OpenCode to Ship-It with a browser login (OAuth).",
      "",
      "Opens the Ship-It authorize page in the browser; the user signs in and",
      "approves, and the access token is stored in the key file automatically.",
      "Use this when tools report missing credentials, or to switch accounts.",
      "No arguments are needed.",
    ].join("\n"),
    args: {},
    async execute() {
      try {
        const result = await runOAuthLogin({ controlPlaneUrl });
        return [
          "Ship-It connected.",
          `Access token stored in ${result.keyPath}.`,
          "Restart OpenCode so every tool picks up the new credentials.",
        ].join("\n");
      } catch (err) {
        if (err instanceof OAuthLoginError) {
          return `Login failed (${err.code}): ${err.message}`;
        }
        return formatError(err);
      }
    },
  });

  return { shipit_login: login };
}
