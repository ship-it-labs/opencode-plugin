import { tool } from "@opencode-ai/plugin";
import type { SessionState } from "../../core/state/session.js";
import type { ToolRegistry } from "../types.js";
import { formatError } from "../build/index.js";
import { runOAuthLogin, ensurePluginConfigured, OAuthLoginError } from "../../oauth/login.js";

export function createAuthTools(state: SessionState, controlPlaneUrl: string): ToolRegistry {
  void state;
  // Deliberately needs no API key: this is how the key comes to exist.
  const login = tool({
    description: [
      "Connect OpenCode to Ship-It with a browser login (OAuth).",
      "",
      "Opens the Ship-It authorize page in the browser; the user signs in and",
      "approves, and the access token is stored in shipit.key next to your",
      "opencode.jsonc/opencode.json automatically.",
      "Use this when tools report missing credentials, or to switch accounts.",
      "No arguments are needed.",
    ].join("\n"),
    args: {},
    async execute() {
      try {
        const result = await runOAuthLogin({ controlPlaneUrl });
        const lines = [
          "Ship-It connected.",
          `Access token stored in ${result.keyPath}.`,
        ];
        try {
          const configured = ensurePluginConfigured();
          lines.push(
            configured.added
              ? `Added the plugin to ${configured.file}.`
              : `Plugin already listed in ${configured.file}.`
          );
        } catch (err) {
          lines.push(
            `Could not update the OpenCode config automatically: ${err instanceof Error ? err.message : err}`
          );
        }
        lines.push("Restart OpenCode so every tool picks up the new credentials.");
        return lines.join("\n");
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
