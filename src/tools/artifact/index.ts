import { tool } from "@opencode-ai/plugin";
import type { SessionState } from "../../core/state/session.js";
import type { ToolRegistry } from "../types.js";
import { formatError } from "../build/index.js";

export function createArtifactTools(state: SessionState): ToolRegistry {
  const list = tool({
    description:
      "List artifacts produced by a build, including SHA-256 hash and size. Artifacts are integrity checked before use.",
    args: {
      build_id: tool.schema.string().describe("The build id to list artifacts for"),
    },
    async execute(args) {
      try {
        const result = await state.api.get<{
          artifacts: Array<{ id: string; name: string; sha256: string; size: number; url: string }>;
        }>(`/api/v1/builds/${args.build_id}/artifacts`);

        if (result.artifacts.length === 0) {
          return `No artifacts for build ${args.build_id}.`;
        }

        return result.artifacts
          .map((a) => `${a.id} name=${a.name} size=${a.size} sha256=${a.sha256} url=${a.url}`)
          .join("\n");
      } catch (err) {
        return formatError(err);
      }
    },
  });

  const verify = tool({
    description:
      "Verify an artifact's SHA-256 hash and size against what the build system recorded, then report whether it is intact.",
    args: {
      build_id: tool.schema.string().describe("The build id the artifact belongs to"),
      artifact_id: tool.schema.string().describe("The artifact id to verify"),
    },
    async execute(args) {
      try {
        const result = await state.api.post<{
          verified: boolean;
          expected_sha256: string;
          actual_sha256?: string;
        }>(`/api/v1/builds/${args.build_id}/artifacts/${args.artifact_id}/verify`, {});

        return result.verified
          ? `Artifact ${args.artifact_id} verified. sha256=${result.expected_sha256}`
          : `Artifact ${args.artifact_id} FAILED verification. expected=${result.expected_sha256} actual=${result.actual_sha256}`;
      } catch (err) {
        return formatError(err);
      }
    },
  });

  return {
    artifact_list: list,
    artifact_verify: verify,
  };
}
