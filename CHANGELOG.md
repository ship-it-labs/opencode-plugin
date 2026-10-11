# Changelog

## 1.2.3

- Login adds the plugin to `opencode.jsonc` (or `opencode.json`) automatically:
  one command connects end to end, then restart OpenCode.
- Connecting docs collapsed to the single login flow everywhere.
- 401s point at reconnecting via login instead of dying cryptically.

## 1.2.1

- Fix Windows browser open: quote the authorize URL so `cmd.exe` no longer
  splits it on `&` (which dropped every parameter but `client_id`), and print
  the URL as a copy-paste fallback.

## 1.2.0
## 1.2.0

- Browser OAuth login: `npx opencode-shipit-runtime login` and the new
  `shipit_login` tool (loopback server + PKCE, token stored automatically).
- `project_upload` and `build_submit` accept `language` (node, python, go,
  cpp, c, rust, java, ruby, elixir) and `env` (runtime vs build-time).
- Control plane defaults to production; localhost is opt-in.
- Key sources are trimmed and validated, with fallthrough instead of 401s.

## 1.0.4

- Verified live package contents and metadata.
