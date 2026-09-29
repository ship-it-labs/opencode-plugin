import { tool } from "@opencode-ai/plugin";
import type { SessionState } from "../../core/state/session.js";
import type { RuntimeRecord } from "../../core/state/session.js";
import type { ToolRegistry } from "../types.js";
import { formatError } from "../build/index.js";

export function createRuntimeTools(state: SessionState): ToolRegistry {
  const start = tool({
    description:
      "Start a runtime session for a project. The session runs in an isolated ephemeral sandbox on a server-agent. Duration is capped by the plan and the remaining monthly quota; the server is authoritative.",
    args: {
      project_id: tool.schema.string().describe("The project id to run"),
    },
    async execute(args) {
      try {
        const result = await state.api.post<{ runtime: RuntimeRecord }>("/api/v1/runtimes", {
          project_id: args.project_id,
        });
        state.trackRuntime(result.runtime);
        return [
          `Runtime ${result.runtime.runtime_id} started.`,
          `status: ${result.runtime.status}`,
          `lease_expires_at: ${result.runtime.lease_expires_at ?? "n/a"}`,
          result.runtime.app_url ? `app_url: ${result.runtime.app_url}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const stop = tool({
    description: "Stop a running runtime session. The sandbox filesystem is destroyed.",
    args: {
      runtime_id: tool.schema.string().describe("The runtime id to stop"),
    },
    async execute(args) {
      try {
        await state.api.post(`/api/v1/runtimes/${args.runtime_id}/stop`);
        state.forgetRuntime(args.runtime_id);
        return `Runtime ${args.runtime_id} stopped.`;
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const restart = tool({
    description: "Restart a runtime session without destroying its sandbox filesystem.",
    args: {
      runtime_id: tool.schema.string().describe("The runtime id to restart"),
    },
    async execute(args) {
      try {
        await state.api.post(`/api/v1/runtimes/${args.runtime_id}/restart`);
        return `Runtime ${args.runtime_id} restarted.`;
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const status = tool({
    description: "Get the status, application URL and lease expiry of a runtime.",
    args: {
      runtime_id: tool.schema.string().describe("The runtime id to inspect"),
    },
    async execute(args) {
      try {
        const result = await state.api.get<{ runtime: Record<string, unknown> }>(
          `/api/v1/runtimes/${args.runtime_id}`
        );
        const r = result.runtime;
        return [
          `runtime_id: ${r.id}`,
          `status: ${r.status}`,
          `app_url: ${r.app_url ?? "n/a"}`,
          `lease_expires_at: ${r.lease_expires_at ?? "n/a"}`,
          `started_at: ${r.started_at ?? "n/a"}`,
          `stopped_at: ${r.stopped_at ?? "n/a"}`,
        ].join("\n");
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const list = tool({
    description: "List recent runtime sessions for the authenticated account.",
    args: {},
    async execute() {
      try {
        const result = await state.api.get<{ runtimes: RuntimeRecord[] }>("/api/v1/runtimes");
        if (result.runtimes.length === 0) {
          return "No runtimes yet.";
        }
        return result.runtimes
          .map(
            (r) =>
              `${r.runtime_id} ${r.status} project=${r.project_id} lease=${r.lease_expires_at ?? "n/a"}`
          )
          .join("\n");
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const logs = tool({
    description: "Retrieve stdout and stderr from a running runtime container.",
    args: {
      runtime_id: tool.schema.string().describe("The runtime id to read logs for"),
    },
    async execute(args) {
      try {
        const result = await state.api.get<{ output?: string; logs?: string }>(
          `/api/v1/runtimes/${args.runtime_id}/logs`
        );
        return result.output ?? result.logs ?? "No logs returned.";
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const info = tool({
    description: "Get sandbox metadata for a runtime, including container id and agent id.",
    args: {
      runtime_id: tool.schema.string().describe("The runtime id to inspect"),
    },
    async execute(args) {
      try {
        const result = await state.api.get<Record<string, unknown>>(
          `/api/v1/runtimes/${args.runtime_id}/info`
        );
        return JSON.stringify(result, null, 2);
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const health = tool({
    description: "Check whether a runtime container is responsive.",
    args: {
      runtime_id: tool.schema.string().describe("The runtime id to check"),
    },
    async execute(args) {
      try {
        await state.api.get(`/api/v1/runtimes/${args.runtime_id}/health`);
        return `Runtime ${args.runtime_id} is healthy.`;
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const exec = tool({
    description:
      "Run a shell command inside the runtime sandbox. The command executes inside the container only and cannot see the host filesystem or host processes.",
    args: {
      runtime_id: tool.schema.string().describe("The runtime id to execute in"),
      command: tool.schema.string().describe("The shell command to run"),
    },
    async execute(args) {
      try {
        const result = await state.api.post<{ output?: string }>(
          `/api/v1/runtimes/${args.runtime_id}/exec`,
          { command: args.command }
        );
        return result.output ?? "Command completed with no output.";
      } catch (err) {
        return formatError(err);
      }
    },
  });

  return {
    runtime_start: start,
    runtime_stop: stop,
    runtime_restart: restart,
    runtime_status: status,
    runtime_list: list,
    runtime_logs: logs,
    runtime_info: info,
    runtime_health: health,
    runtime_exec: exec,
  };
}
