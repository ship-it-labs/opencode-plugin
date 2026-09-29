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

export const ShipItRuntimePlugin: Plugin = async (ctx) => {
  const config = loadConfig(readConfigFromContext(ctx));
  const state = new SessionState();
  const auth = new AuthContext(config, state);

  if (!auth.isConfigured) {
    await ctx.client.app.log({
      body: {
        service: "shipit-runtime",
        level: "warn",
        message:
          "Ship-It runtime tools are disabled: no API key configured. Set SHIPIT_API_KEY to enable them.",
      },
    });
    return {};
  }

  state.connect(config.apiKey!, config.controlPlaneUrl);

  try {
    const verified = await auth.verify();
    await ctx.client.app.log({
      body: {
        service: "shipit-runtime",
        level: "info",
        message: `Connected to control plane at ${config.controlPlaneUrl}`,
        extra: { plan: verified.plan },
      },
    });
  } catch (err) {
    await ctx.client.app.log({
      body: {
        service: "shipit-runtime",
        level: "error",
        message: `Could not verify API key against ${config.controlPlaneUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
    });
  }

  state.onEvent((event) => {
    if (event.type === "build.complete" || event.type === "runtime.stopped") {
      ctx.client.app
        .log({
          body: {
            service: "shipit-runtime",
            level: "info",
            message: `${event.type}`,
            extra: event.payload as Record<string, unknown>,
          },
        })
        .catch(() => undefined);
    }
  });

  return {
    tool: {
      ...createBuildTools(state),
      ...createRuntimeTools(state),
      ...createFilesystemTools(state),
      ...createUsageTools(state),
      ...createArtifactTools(state),
      ...createProjectTools(state),
    },
  };
};

function readConfigFromContext(ctx: unknown): Partial<PluginConfig> {
  const container = (ctx as { container?: { config?: Record<string, unknown> } })?.container;
  const raw = container?.config?.shipit as Partial<PluginConfig> | undefined;
  return raw ?? {};
}

export default ShipItRuntimePlugin;
