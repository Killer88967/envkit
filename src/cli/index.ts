import { loadEnvSources, mergeEnvSources } from "../env/load";
import { looksSecret, redactEnvValue } from "../security/redact";

const [, , command] = process.argv;

function printHelp(): void {
  console.log(`
envkit

Environment inspection and synchronization toolkit.

Usage:
  envkit <command>

Commands:
  list      List detected environment variables
  help      Show this help message
`);
}

function list(): void {
  const sources = loadEnvSources();
  const values = mergeEnvSources(sources);
  const keys = Object.keys(values).sort((a, b) => a.localeCompare(b));

  if (keys.length === 0) {
    console.log("No environment variables found.");

    return;
  }

  for (const key of keys) {
    const value = values[key];
    const display = redactEnvValue(key, value);
    const suffix = looksSecret(key) ? " [secret]" : "";

    console.log(`${key}=${display ?? ""}${suffix}`);
  }
}

switch (command) {
  case "list":
    list();
    break;

  case "help":
  case "--help":
  case "-h":
  case undefined:
    printHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "envkit help" for usage.');

    process.exitCode = 1;
}
