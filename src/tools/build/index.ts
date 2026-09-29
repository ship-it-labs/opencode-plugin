import { tool } from "@opencode-ai/plugin";
import type { SessionState } from "../../core/state/session.js";
import type { ToolRegistry } from "../types.js";
import { ApiError, TransportError } from "../../core/api/errors.js";

export function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    return `Control plane rejected the request (${err.code}, HTTP ${err.status}): ${err.message}`;
  }
  if (err instanceof TransportError) {
    return `${err.message} Tools will keep working once the connection is restored.`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export interface BuildSubmission {
  build_id: string;
  status: string;
}

export function createBuildTools(state: SessionState): ToolRegistry {
  const submitBuild = tool({
    description:
      "Submit a build to the platform build system. Installs dependencies and builds the project in GitHub Actions with a hard 180 second timeout. Returns a build id; use build_logs to inspect the result.",
    args: {
      project_id: tool.schema.string().describe("The project id to build"),
      install_commands: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Dependency install commands, e.g. ['npm ci']"),
      build_commands: tool.schema
        .array(tool.schema.string())
        .describe("Build commands, e.g. ['npm run build']"),
      test_commands: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Test commands, e.g. ['npm test']"),
    },
    async execute(args) {
      try {
        const result = await state.api.post<BuildSubmission>("/api/v1/builds", {
          project_id: args.project_id,
          install_commands: args.install_commands ?? [],
          build_commands: args.build_commands,
          test_commands: args.test_commands ?? [],
        });
        state.trackBuild(result);
        return `Build ${result.build_id} accepted with status ${result.status}. Poll build_status for the outcome, then read build_logs if it failed.`;
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const buildStatus = tool({
    description: "Get the current status of a build, including exit code and timing.",
    args: {
      build_id: tool.schema.string().describe("The build id returned by build_submit"),
    },
    async execute(args) {
      try {
        const result = await state.api.get<{ build: Record<string, unknown> }>(
          `/api/v1/builds/${args.build_id}`
        );
        const b = result.build;
        return [
          `build_id: ${b.id}`,
          `status: ${b.status}`,
          `exit_code: ${b.exit_code ?? "n/a"}`,
          `started_at: ${b.started_at ?? "n/a"}`,
          `completed_at: ${b.completed_at ?? "n/a"}`,
          `install_commands: ${JSON.stringify(b.install_commands)}`,
          `build_commands: ${JSON.stringify(b.build_commands)}`,
        ].join("\n");
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const buildLogs = tool({
    description:
      "Retrieve stdout and stderr from a build. Use this to diagnose failures before submitting a corrected build.",
    args: {
      build_id: tool.schema.string().describe("The build id to read logs for"),
    },
    async execute(args) {
      try {
        const result = await state.api.get<{
          logs: Array<{ stream: string; content: string }>;
        }>(`/api/v1/builds/${args.build_id}/logs`);

        if (result.logs.length === 0) {
          return `No logs recorded for build ${args.build_id} yet.`;
        }

        return result.logs
          .map((entry) => `[${entry.stream}] ${entry.content}`)
          .join("\n");
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const buildList = tool({
    description: "List recent builds for the authenticated account.",
    args: {},
    async execute() {
      try {
        const result = await state.api.get<{ builds: Array<Record<string, unknown>> }>(
          "/api/v1/builds"
        );
        if (result.builds.length === 0) {
          return "No builds yet.";
        }
        return result.builds
          .map(
            (b) =>
              `${b.id} ${b.status} exit=${b.exit_code ?? "n/a"} created=${b.created_at}`
          )
          .join("\n");
      } catch (err) {
        return formatError(err);
      }
    },
  });

  return {
    build_submit: submitBuild,
    build_status: buildStatus,
    build_logs: buildLogs,
    build_list: buildList,
  };
}

