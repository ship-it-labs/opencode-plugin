import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig, type PluginConfig } from "./core/config/index.js";
import { AuthContext } from "./core/auth/index.js";
import { SessionState } from "./core/state/session.js";
import { createBuildTools } from "./tools/build/index.js";
import { createRuntimeTools } from "./tools/runtime/index.js";
import { createFilesystemTools } from "./tools/runtime/filesystem.js";
import { createUsageTools } from "./tools/usage/index.js";
import { createArtifactTools } from "./tools/artifact/index.js";
import { createProjectTools } from "./tools/project/index.js";

/**
 * Best-effort structured logging. If the host client does not expose
 * app.log, the message goes to the console instead of throwing, because a
 * logging failure must never prevent the tools from registering.
 */
function safeLog(ctx: unknown, level: string, message: string, extra?: unknown): void {
  try {
    const client = (ctx as any)?.client;
    const log = client?.app?.log;
    if (typeof log === "function") {
      Promise.resolve(
        log.call(client.app, {
          body: { service: "shipit-runtime", level, message, extra },
        })
      ).catch(() => undefined);
      return;
    }
  } catch {
    // Fall through to console.
  }

  const line = `[shipit-runtime:${level}] ${message}${extra ? " " + JSON.stringify(extra) : ""}`;
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const ShipItRuntimePlugin: Plugin = async (ctx) => {
  const config = loadConfig(readConfigFromContext(ctx));
  const state = new SessionState();
  const auth = new AuthContext(config, state);

  const tools = {
    ...createBuildTools(state),
    ...createRuntimeTools(state),
    ...createFilesystemTools(state),
    ...createUsageTools(state),
    ...createArtifactTools(state),
    ...createProjectTools(state),
  };

  if (!auth.isConfigured) {
    safeLog(
      ctx,
      "warn",
      "Ship-It runtime tools are registered but disabled: no API key configured. Set SHIPIT_API_KEY to enable them."
    );
    return { tool: tools };
  }

  try {
    state.connect(config.apiKey!, config.controlPlaneUrl);
  } catch (err) {
    safeLog(ctx, "warn", "Realtime connection failed; tools still work.", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const verified = await auth.verify();
    safeLog(ctx, "info", `Connected to control plane at ${config.controlPlaneUrl}`, {
      plan: verified.plan,
    });
  } catch (err) {
    safeLog(
      ctx,
      "error",
      `Could not verify API key against ${config.controlPlaneUrl}. Tools are registered but calls will fail until the control plane is reachable.`,
      { error: err instanceof Error ? err.message : String(err) }
    );
  }

  state.onEvent((event) => {
    if (event.type === "build.complete" || event.type === "runtime.stopped") {
      safeLog(ctx, "info", event.type, event.payload);
    }
  });

  return { tool: tools };
};

function readConfigFromContext(ctx: unknown): Partial<PluginConfig> {
  try {
    const container = (ctx as { container?: { config?: Record<string, unknown> } })?.container;
    const raw = container?.config?.shipit as Partial<PluginConfig> | undefined;
    return raw ?? {};
  } catch {
    return {};
  }
}

export default ShipItRuntimePlugin;
