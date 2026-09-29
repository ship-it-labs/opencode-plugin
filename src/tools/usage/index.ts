import { tool } from "@opencode-ai/plugin";
import type { SessionState } from "../../core/state/session.js";
import type { ToolRegistry } from "../types.js";
import { formatError } from "../build/index.js";

export function createUsageTools(state: SessionState): ToolRegistry {
  const quota = tool({
    description:
      "Get monthly runtime quota for the authenticated account: total allowance, used seconds, remaining seconds and the maximum permitted session length. Check this before starting long runtimes.",
    args: {},
    async execute() {
      try {
        const result = await state.api.get<{
          monthly_runtime_limit_seconds: number;
          runtime_used_seconds: number;
          runtime_remaining_seconds: number;
          max_session_seconds: number;
          plan: { name: string; max_runtime_hours: number };
        }>("/api/v1/usage");

        const hours = (seconds: number) => (seconds / 3600).toFixed(2);

        return [
          `plan: ${result.plan.name}`,
          `monthly_runtime_limit_seconds: ${result.monthly_runtime_limit_seconds} (${hours(result.monthly_runtime_limit_seconds)}h)`,
          `runtime_used_seconds: ${result.runtime_used_seconds} (${hours(result.runtime_used_seconds)}h)`,
          `runtime_remaining_seconds: ${result.runtime_remaining_seconds} (${hours(result.runtime_remaining_seconds)}h)`,
          `max_session_seconds: ${result.max_session_seconds} (${hours(result.max_session_seconds)}h)`,
        ].join("\n");
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const monitoring = tool({
    description:
      "Get CPU, memory, disk and uptime for a running runtime, along with the remaining session time.",
    args: {
      runtime_id: tool.schema.string().describe("The runtime id to measure"),
      metric: tool.schema
        .enum(["cpu", "memory", "disk", "uptime", "all"])
        .describe("Which metric to report, or 'all'"),
    },
    async execute(args) {
      try {
        const result = await state.api.get<Record<string, unknown>>(
          `/api/v1/runtimes/${args.runtime_id}/${args.metric}`
        );

        if (args.metric !== "all") {
          return `${args.metric}: ${JSON.stringify(result)}`;
        }

        return JSON.stringify(result, null, 2);
      } catch (err) {
        return formatError(err);
      }
    },
  });

  return {
    usage_quota: quota,
    runtime_monitoring: monitoring,
  };
}
