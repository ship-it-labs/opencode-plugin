#!/usr/bin/env node
// Entry point for `npx opencode-shipit-runtime login` (bin/shipit-login).
import("../dist/oauth/cli.js").then((cli) => cli.main()).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
