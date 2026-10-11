# Changelog

## 1.2.0

- Browser OAuth login: `npx opencode-shipit-runtime login` and the new
  `shipit_login` tool (loopback server + PKCE, token stored automatically).
- `project_upload` and `build_submit` accept `language` (node, python, go,
  cpp, c, rust, java, ruby, elixir) and `env` (runtime vs build-time).
- Control plane defaults to production; localhost is opt-in.
- Key sources are trimmed and validated, with fallthrough instead of 401s.

- `project_upload` accepts `language` (node, python, go, cpp, c, rust, java,
  ruby, elixir) and `env` (runtime environment, stored encrypted server-side).
  Omit `language` and the platform detects it from the uploaded files.
- `build_submit` accepts `language` (per-build override) and `env`
  (build-time only: forwarded to the runner, never stored, never logged).
- `runtime_start` description now explains the language sandbox model: CI
  builds a self-contained bundle per language, and the sandbox executes it
  with the project's stored environment.

## 1.0.4

- Verified live package contents and metadata.
