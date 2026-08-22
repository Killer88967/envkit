import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";

import {
  printDiffSymbol,
  printError,
  printSuccess,
  printWarning,
} from "./output";
import { diffEnv } from "../diff/diff";
import { diffRemoteEnv } from "../diff/remote";
import { loadEnvSources, mergeEnvSources } from "../env/load";
import { parseEnv } from "../env/parse";
import { looksSecret, redactEnvValue } from "../security/redact";
import { runDoctor } from "../doctor/doctor";
import { vercelProvider } from "../providers/vercel";

const [, , command, ...args] = process.argv;

function printHelp(): void {
  console.log(`
${pc.bold(pc.cyan("envkit"))}

${pc.dim("Environment inspection and synchronization toolkit.")}

${pc.bold("Usage")}
  ${pc.cyan("envkit")} <command>

${pc.bold("Commands")}
  ${pc.cyan("list")}                  List detected environment variables
  ${pc.cyan("diff")} <left> <right>   Compare two environment files
  ${pc.cyan("diff vercel")}           Compare local variables with Vercel
  ${pc.cyan("doctor")}                Check the environment setup for common problems
  ${pc.cyan("vercel")}                List Vercel environment variables
  ${pc.cyan("help")}                  Show this help message

${pc.bold("Vercel options")}
  ${pc.yellow("--production")}
  ${pc.yellow("--preview")}
  ${pc.yellow("--development")}
`);
}

function loadEnvFile(path: string) {
  const absolutePath = resolve(process.cwd(), path);
  const contents = readFileSync(absolutePath, "utf8");

  return parseEnv(contents, {
    expand: true,
  });
}

/** @deprecated */
function getDiffSymbol(type: string): string {
  switch (type) {
    case "added":
      return "+";

    case "removed":
      return "-";

    case "changed":
      return "~";

    case "unchanged":
      return "=";

    case "unknown":
      return "?";

    default:
      return "?";
  }
}

function getVercelTarget() {
  if (args.includes("--production")) {
    return "production" as const;
  }

  if (args.includes("--preview")) {
    return "preview" as const;
  }

  if (args.includes("--development")) {
    return "development" as const;
  }

  return undefined;
}

function list(): void {
  const showAll = process.argv.includes("--all");

  const sources = loadEnvSources({
    includeProcessEnv: showAll,
  });

  const values = mergeEnvSources(sources);
  const keys = Object.keys(values).sort((a, b) => a.localeCompare(b));

  if (keys.length === 0) {
    printWarning("No environment variables found.");
    return;
  }

  for (const key of keys) {
    const value = values[key];
    const secret = looksSecret(key);
    const display = redactEnvValue(key, value);

    console.log(
      `${pc.bold(key)}=${secret ? pc.dim(display ?? "") : (display ?? "")}${
        secret ? ` ${pc.yellow("[secret]")}` : ""
      }`,
    );
  }
}

async function diff(): Promise<void> {
  const changesOnly = args.includes("--changes-only");
  const files = args.filter((arg) => !arg.startsWith("--"));

  if (files[0] === "vercel") {
    await diffVercel(changesOnly);
    return;
  }

  const [leftPath, rightPath] = files;

  if (!leftPath || !rightPath) {
    console.error("Usage:");
    console.error("  envkit diff <left> <right>");
    console.error("  envkit diff vercel");
    process.exitCode = 1;
    return;
  }

  let left;
  let right;

  try {
    left = loadEnvFile(leftPath);
    right = loadEnvFile(rightPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    process.exitCode = 1;
    return;
  }

  const differences = diffEnv(left, right);

  for (const entry of differences) {
    if (changesOnly && entry.type === "unchanged") {
      continue;
    }

    console.log(`${printDiffSymbol(entry.type)} ${pc.bold(entry.key)}`);
  }
}

async function diffVercel(changesOnly: boolean): Promise<void> {
  let project;

  try {
    project = vercelProvider.detect();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    process.exitCode = 1;
    return;
  }

  if (!project) {
    printError(
      "No linked Vercel project found. Expected .vercel/project.json.",
    );

    process.exitCode = 1;
    return;
  }

  const localSources = loadEnvSources({
    includeProcessEnv: false,
  });

  const local = mergeEnvSources(localSources);

  let remote;

  try {
    remote = await vercelProvider.list(project);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    process.exitCode = 1;
    return;
  }

  const target = getVercelTarget();

  const differences = diffRemoteEnv(local, remote, target);

  if (differences.length === 0) {
    printWarning("No environment variables found locally or on Vercel.");

    return;
  }

  for (const entry of differences) {
    if (changesOnly && entry.type === "unchanged") {
      continue;
    }

    console.log(`${printDiffSymbol(entry.type)} ${pc.bold(entry.key)}`);
  }
}

function doctor(): void {
  const checks = runDoctor();

  for (const check of checks) {
    switch (check.status) {
      case "pass":
        printSuccess(check.message);
        break;
      case "warn":
        printWarning(check.message);
        break;
      case "fail":
        printError(check.message);
        break;
    }
  }

  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}

async function vercel(): Promise<void> {
  let project;

  try {
    project = vercelProvider.detect();
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));

    process.exitCode = 1;
    return;
  }

  if (!project) {
    console.error(
      "No linked Vercel project found. Expected .vercel/project.json.",
    );

    process.exitCode = 1;
    return;
  }

  try {
    const variables = await vercelProvider.list(project);

    const target = getVercelTarget();

    const filtered = target
      ? variables.filter((variable) => variable.targets.includes(target))
      : variables;

    if (filtered.length === 0) {
      console.log(
        target
          ? `No Vercel environment variables found for ${target}.`
          : "No Vercel environment variables found.",
      );

      return;
    }

    for (const variable of filtered) {
      const targets =
        variable.targets.length > 0 ? variable.targets.join(", ") : "unknown";

      console.log(`${pc.bold(variable.key)} ${pc.dim(`[${targets}]`)}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    process.exitCode = 1;
  }
}

switch (command) {
  case "list":
    list();
    break;

  case "diff":
    await diff();
    break;

  case "doctor":
    doctor();
    break;

  case "vercel":
    await vercel();
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
