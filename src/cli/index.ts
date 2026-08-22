import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { diffEnv } from "../diff/diff";
import { loadEnvSources, mergeEnvSources } from "../env/load";
import { parseEnv } from "../env/parse";
import { looksSecret, redactEnvValue } from "../security/redact";

const [, , command, ...args] = process.argv;

function printHelp(): void {
  console.log(`
envkit

Environment inspection and synchronization toolkit.

Usage:
  envkit <command>

Commands:
  list                  List detected environment variables
  diff <left> <right>   Compare two environment files
  help                  Show this help message
`);
}

function list(): void {
  const showAll = process.argv.includes("--all");

  const sources = loadEnvSources({
    includeProcessEnv: showAll,
  });

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

function loadEnvFile(path: string) {
  const absolutePath = resolve(process.cwd(), path);
  const contents = readFileSync(absolutePath, "utf8");

  return parseEnv(contents, {
    expand: true,
  });
}

function diff(): void {
  const changesOnly = args.includes("--changes-only");
  const files = args.filter((arg) => !arg.startsWith("--"));

  const [leftPath, rightPath] = files;

  if (!leftPath || !rightPath) {
    console.error("Usage: envkit diff <left> <right>");
    process.exitCode = 1;
    return;
  }

  let left;
  let right;

  try {
    left = loadEnvFile(leftPath);
    right = loadEnvFile(rightPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(message);
    process.exitCode = 1;
    return;
  }

  const differences = diffEnv(left, right);

  for (const entry of differences) {
    if (changesOnly && entry.type === "unchanged") {
      continue;
    }

    const symbol =
      entry.type === "added"
        ? "+"
        : entry.type === "removed"
          ? "-"
          : entry.type === "changed"
            ? "~"
            : "=";

    console.log(`${symbol} ${entry.key}`);
  }
}

switch (command) {
  case "list":
    list();
    break;

  case "diff":
    diff();
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
