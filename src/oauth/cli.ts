import { runOAuthLogin, ensurePluginConfigured, OAuthLoginError } from "./login.js";

/**
 * `shipit-login` (also runnable as `npx opencode-shipit-runtime login`):
 * browser OAuth login outside any agent session. Prints the key file path on
 * success — never the key itself.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h") || argv[0] !== "login") {
    printUsage();
    return;
  }

  const controlPlaneUrl = flagValue(argv, "--control-plane") ?? process.env.SHIPIT_CONTROL_PLANE_URL ?? "https://ship-it-fri1.onrender.com";
  const port = flagNumber(argv, "--port");
  const keyPath = flagValue(argv, "--key-file");
  const openBrowser = !argv.includes("--no-browser");

  try {
    await runOAuthLogin({
      controlPlaneUrl,
      port,
      keyPath,
      openBrowser,
      onAuthorizeUrl: (url) => {
        console.log("If the browser did not open, visit this URL:");
        console.log(url);
      },
    });
    console.log("Ship-It connected.");
    console.log(`Access token stored.`);
    try {
      const configured = ensurePluginConfigured();
      console.log(
        configured.added
          ? `Added the plugin to ${configured.file}.`
          : `Plugin already listed in ${configured.file}.`
      );
    } catch (err) {
      // Token is stored; a config edit failure must not fail the login.
      console.log(
        `Could not update the OpenCode config automatically: ${err instanceof Error ? err.message : err}`
      );
    }
    console.log("Restart OpenCode so every tool picks up the new credentials.");
  } catch (err) {
    if (err instanceof OAuthLoginError) {
      console.error(`Login failed (${err.code}): ${err.message}`);
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exitCode = 1;
  }
}

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function flagNumber(argv: string[], name: string): number | undefined {
  const raw = flagValue(argv, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : undefined;
}

function printUsage(): void {
  console.log(
    [
      "Usage: shipit-login login [options]",
      "",
      "Connect OpenCode to Ship-It with a browser login (OAuth).",
      "",
      "Options:",
      "  --control-plane URL   Control plane base URL (default: production)",
      "  --port N              Loopback callback port (default: first free 4567-4576)",
      "  --key-file PATH       Where to store the token (default: ./shipit.key next to opencode.jsonc/json, else ~/.config/opencode/shipit.key)",
      "  --no-browser          Print the authorize URL instead of opening it",
    ].join("\n")
  );
}
