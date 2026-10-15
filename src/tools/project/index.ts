import { tool } from "@opencode-ai/plugin";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { SessionState } from "../../core/state/session.js";
import type { ToolRegistry } from "../types.js";
import { formatError } from "../build/index.js";
import { zipDirectory } from "./zip.js";
import {
  LANGUAGES,
  LANGUAGE_ARG_DESCRIPTION,
  PROJECT_ENV_ARG_DESCRIPTION,
} from "../languages.js";

/**
 * Directories excluded by default: none. The archive ships the entire project
 * directory — dependency directories, build output, everything — because the
 * runtime starts what was uploaded and a missing file (a compiled server.js,
 * a vendored dependency) is a broken deploy. The platform stores up to 20GB
 * per upload on the server-agent's disk, so size is a transfer-time cost, not
 * a correctness filter. Pass exclude_dirs to slim the archive (e.g. [".git"]
 * when history dwarfs the source); it replaces this empty list.
 */
export const DEFAULT_EXCLUDE_DIRS: string[] = [];

const MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024;

interface Collected {
  files: string[];
  totalBytes: number;
}

/**
 * A Blob backed by a file on disk, so multi-gigabyte archives stream into the
 * upload instead of being buffered. OpenCode runs plugins in Bun, where
 * Bun.file is lazy; anything else is a clear error rather than a silent OOM.
 */
function fileBlob(filePath: string): Blob {
  const bun = (
    globalThis as unknown as { Bun?: { file: (p: string) => Blob } }
  ).Bun;
  if (!bun) {
    throw new Error("File uploads of this size require the Bun runtime");
  }
  return bun.file(filePath);
}

async function collect(
  root: string,
  excludeDirs: Set<string>,
  current: string
): Promise<Collected> {
  const result: Collected = { files: [], totalBytes: 0 };

  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const full = path.join(current, entry.name);

    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      const nested = await collect(root, excludeDirs, full);
      result.files.push(...nested.files);
      result.totalBytes += nested.totalBytes;
      continue;
    }

    // Every regular file ships, whatever its size: the runtime needs all
    // files to run, and the 20GB total cap (not a per-file cap) is the backstop.
    if (!entry.isFile()) continue;

    let info;
    try {
      info = await stat(full);
    } catch {
      continue;
    }

    result.files.push(full);
    result.totalBytes += info.size;
  }

  return result;
}

export function createProjectTools(state: SessionState): ToolRegistry {
  const uploadProject = tool({
    description: [
      "Package the project source and upload it to the platform so it can be built.",
      "",
      "This is the first step of any build. It archives the ENTIRE project directory",
      "— every file, including dependency directories and build output — and uploads",
      "the archive. Nothing is excluded by default: the runtime starts what was",
      "uploaded, so a missing file is a broken deploy. The archive streams from",
      "disk (never held in memory) and the platform stores up to 20GB per upload.",
      "After uploading, call build_submit to run the install and build commands in",
      "GitHub Actions against this uploaded code.",
      "",
      "Use exclude_dirs ONLY to slim a huge upload (e.g. [\".git\"] when history",
      "dwarfs the source). It replaces the (empty) default list outright.",
    ].join("\n"),
    args: {
      project_id: tool.schema
        .string()
        .describe("The project id to create or update with this upload"),
      path: tool.schema
        .string()
        .optional()
        .describe("Project directory to upload. Defaults to the OpenCode worktree root."),
      exclude_dirs: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe(
          "Directory names to exclude from the archive. The default list is EMPTY " +
            "— everything ships, because the runtime needs all files to run. Pass " +
            "names here only to slim a huge upload (e.g. [\".git\"] when history " +
            "dwarfs the source). Replaces the default list outright."
        ),
      project_name: tool.schema.string().optional().describe("Display name for the project"),
      run_command: tool.schema
        .string()
        .optional()
        .describe(
          "The command that starts this project, run inside the sandbox on the " +
            "runtime, e.g. 'node dist/server.js' or 'npm start'. The server-agent " +
            "uses this as the container entrypoint instead of guessing, so set it " +
            "whenever the app does not start on its own."
        ),
      language: tool.schema
        .enum(LANGUAGES)
        .optional()
        .describe(LANGUAGE_ARG_DESCRIPTION),
      env: tool.schema
        .record(tool.schema.string(), tool.schema.string())
        .optional()
        .describe(PROJECT_ENV_ARG_DESCRIPTION),
    },
    async execute(args, context) {
      try {
        const root = path.resolve(args.path || (context as any).worktree || process.cwd());
        const excludeDirs = new Set(args.exclude_dirs ?? DEFAULT_EXCLUDE_DIRS);

        const collected = await collect(root, excludeDirs, root);

        if (collected.files.length === 0) {
          return `No files found under ${root}. Check the path and exclude_dirs.`;
        }

        if (collected.totalBytes > MAX_TOTAL_BYTES) {
          const gb = (n: number) => `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
          return [
            `Project is ${gb(collected.totalBytes)}, over the`,
            `${gb(MAX_TOTAL_BYTES)} upload limit.`,
            "Pass exclude_dirs (e.g. [\".git\", \"node_modules\"]) to slim it.",
          ].join(" ");
        }

        const manifest = {
          files: collected.files
            .map((f) => path.relative(root, f).split(path.sep).join("/"))
            .sort(),
          total_bytes: collected.totalBytes,
          excluded: Array.from(excludeDirs).sort(),
        };

        // The archive streams from a temp file (never RAM) and uploads as a
        // file-backed Blob for the same reason: multi-gigabyte projects must
        // not pass through memory on this machine either.
        const { path: zipPath } = await zipDirectory(root, collected.files);
        try {
          const form = new FormData();
          form.append("project_id", args.project_id);
          if (args.project_name) form.append("project_name", args.project_name);
          if (args.run_command) form.append("run_command", args.run_command);
          if (args.language) form.append("language", args.language);
          if (args.env) form.append("env", JSON.stringify(args.env));
          form.append("manifest", JSON.stringify(manifest));
          form.append("file", fileBlob(zipPath), `${args.project_id}.zip`);

          // project_id rides the query string too (in addition to the form
          // field): the edge resolves the project's home host BEFORE reading
          // the multipart body, so part order can never scatter files.
          const result = await state.api.upload<{
            project_id: string;
            upload_id: string;
            sha256: string;
            file_count: number;
            total_bytes: number;
          }>(`/api/v1/projects/upload?project_id=${encodeURIComponent(args.project_id)}`, form);

          const lines = [
            `Uploaded ${result.file_count} files (${(result.total_bytes / 1024).toFixed(0)}KB) for project ${result.project_id}.`,
            `project_id: ${result.project_id}`,
            "Use this exact project_id for build_submit and project_run: the platform",
            "scopes ids per account, so it may differ from the one you passed when the",
            "slug was already taken by another account.",
            `upload_id: ${result.upload_id}`,
            `sha256: ${result.sha256}`,
          ];

          lines.push("Now call build_submit with install_commands and build_commands.");
          return lines.join("\n");
        } finally {
          await rm(zipPath, { force: true }).catch(() => {});
        }
      } catch (err) {
        return formatError(err);
      }
    },
  });

  return { project_upload: uploadProject };
}
