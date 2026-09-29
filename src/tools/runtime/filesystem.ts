import { tool } from "@opencode-ai/plugin";
import type { SessionState } from "../../core/state/session.js";
import type { ToolRegistry } from "../types.js";
import { formatError } from "../build/index.js";

const FS_OPERATIONS = [
  "list",
  "read",
  "write",
  "delete",
  "move",
  "copy",
  "mkdir",
  "stat",
  "exists",
  "chmod",
  "symlink",
] as const;

export function createFilesystemTools(state: SessionState): ToolRegistry {
  const fs = tool({
    description: `Operate on the runtime sandbox filesystem. The application has full access inside its own sandbox. Supported operations: ${FS_OPERATIONS.join(", ")}. Paths cannot escape the sandbox.`,
    args: {
      runtime_id: tool.schema.string().describe("The runtime id whose sandbox to operate on"),
      operation: tool.schema
        .enum(FS_OPERATIONS)
        .describe("The filesystem operation to perform"),
      path: tool.schema.string().describe("Absolute path inside the sandbox"),
      dest: tool.schema.string().optional().describe("Destination path for move, copy and symlink"),
      content: tool.schema.string().optional().describe("File content for write"),
      mode: tool.schema.string().optional().describe("Octal mode for chmod, e.g. '0755'"),
    },
    async execute(args) {
      try {
        const result = await state.api.post<{ output?: string }>(
          `/api/v1/runtimes/${args.runtime_id}/fs`,
          {
            operation: args.operation,
            path: args.path,
            dest: args.dest,
            content: args.content,
            mode: args.mode,
          }
        );
        return result.output ?? "Operation completed with no output.";
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const net = tool({
    description:
      "Manage port exposure for a runtime. Use 'list' to see exposed ports, 'expose' to publish a sandbox port, 'close' to withdraw it. Only ports the application already listens on can be exposed.",
    args: {
      runtime_id: tool.schema.string().describe("The runtime id to manage ports for"),
      action: tool.schema.enum(["list", "expose", "close"]).describe("Port operation"),
      port: tool.schema.number().optional().describe("Port number for expose and close"),
    },
    async execute(args) {
      try {
        const result = await state.api.post<{ output?: string }>(
          `/api/v1/runtimes/${args.runtime_id}/network`,
          { action: args.action, port: args.port }
        );
        return result.output ?? JSON.stringify(result);
      } catch (err) {
        return formatError(err);
      }
    },
  });

  return {
    fs: fs,
    network: net,
  };
}
