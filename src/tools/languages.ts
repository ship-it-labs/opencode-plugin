/**
 * Project languages. Mirrors the control plane
 * (website/server/src/services/languages.ts) — keep the ids identical.
 * The AI declares the language at upload; the server detects from the archive
 * when the declaration is missing or contradicts the files.
 */
export const LANGUAGES = [
  "node",
  "python",
  "go",
  "cpp",
  "c",
  "rust",
  "java",
  "ruby",
  "elixir",
] as const;

export type ProjectLanguage = (typeof LANGUAGES)[number];

/** One line per choice, so the model can match its project to an id. */
export const LANGUAGE_CHOICES =
  "node (JavaScript/TypeScript, package.json), " +
  "python (requirements.txt, pyproject.toml), " +
  "go (go.mod), " +
  "cpp (C++, CMakeLists.txt, Makefile, .cpp), " +
  "c (C only, .c files), " +
  "rust (Cargo.toml), " +
  "java (pom.xml, build.gradle), " +
  "ruby (Gemfile), " +
  "elixir (mix.exs)";

export const LANGUAGE_ARG_DESCRIPTION =
  "Project language, one of: " +
  LANGUAGE_CHOICES +
  ". Omit it and the platform detects from the uploaded files; a wrong value " +
  "is overridden by detection, so when in doubt leave it out.";

export const PROJECT_ENV_ARG_DESCRIPTION =
  "Runtime environment variables as NAME to value, e.g. {DATABASE_URL: '...', API_KEY: '...'}. " +
  "Stored encrypted and injected into the runtime sandbox only — never into builds, " +
  "logs or responses. Omit to keep the project's existing environment; pass {} " +
  "to clear it. Do not put secrets in install/build/test commands.";

export const BUILD_ENV_ARG_DESCRIPTION =
  "Build-time environment variables as NAME to value, e.g. {NPM_TOKEN: '...'}. " +
  "Forwarded to the GitHub Actions runner for this build only — never stored, " +
  "never logged. Omit when the build needs nothing secret.";
