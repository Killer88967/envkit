import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { confirm, select } from "@inquirer/prompts";
import pc from "picocolors";

import {
  printDiffSymbol,
  printError,
  printKeyValue,
  printSuccess,
  printWarning,
} from "./output";
import { diffEnv } from "../diff/diff";
import { diffRemoteEnv } from "../diff/remote";
import { loadEnvSources, mergeEnvSources } from "../env/load";
import { parseEnv } from "../env/parse";
import { stringifyEnv } from "../env/stringify";
import { vercelProvider } from "../providers/vercel";
import type {
  ResolvedRemoteEnvVariable,
  VercelTarget,
} from "../providers/types";
import { looksSecret, redactEnvValue } from "../security/redact";
import { runDoctor } from "../doctor/doctor";

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
  ${pc.cyan("pull vercel")}           Pull Vercel variables to a local file
  ${pc.cyan("doctor")}                Check the environment setup for common problems
  ${pc.cyan("vercel")}                List Vercel environment variables
  ${pc.cyan("help")}                  Show this help message

${pc.bold("Vercel options")}
  ${pc.yellow("--production")}          Use the production environment
  ${pc.yellow("--preview")}             Use the preview environment
  ${pc.yellow("--development")}         Use the development environment
`);
}

function loadEnvFile(path: string) {
  const absolutePath = resolve(process.cwd(), path);
  const contents = readFileSync(absolutePath, "utf8");

  return parseEnv(contents, {
    expand: true,
  });
}

function getVercelTarget(): VercelTarget | undefined {
  const targets: VercelTarget[] = [];

  if (args.includes("--production")) {
    targets.push("production");
  }

  if (args.includes("--preview")) {
    targets.push("preview");
  }

  if (args.includes("--development")) {
    targets.push("development");
  }

  if (targets.length > 1) {
    throw new Error("Only one Vercel environment can be selected at a time.");
  }

  return targets[0];
}

async function resolveVercelTarget(): Promise<VercelTarget | undefined> {
  const target = getVercelTarget();

  if (target) {
    return target;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }

  return select<VercelTarget>({
    message: "Select a Vercel environment",
    choices: [
      {
        name: "Production",
        value: "production",
      },
      {
        name: "Preview",
        value: "preview",
      },
      {
        name: "Development",
        value: "development",
      },
    ],
  });
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

    printKeyValue(key, display ?? "", secret);
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
    printError("Missing environment file.");

    console.log(`
${pc.bold("Usage")}
  ${pc.cyan("envkit diff")} <left> <right>
  ${pc.cyan("envkit diff vercel")}
`);

    process.exitCode = 1;
    return;
  }

  let left;
  let right;

  try {
    left = loadEnvFile(leftPath);
    right = loadEnvFile(rightPath);
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
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
    printError(error instanceof Error ? error.message : String(error));
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
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  let target: VercelTarget | undefined;

  try {
    target = await resolveVercelTarget();
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const scopedRemote = target
    ? remote.filter((variable) => variable.targets.includes(target))
    : remote;

  let resolvedRemote: ResolvedRemoteEnvVariable[];

  try {
    resolvedRemote = await Promise.all(
      scopedRemote.map(async (variable) => ({
        ...variable,
        value: await vercelProvider.getValue(project, variable),
      })),
    );
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const differences = diffRemoteEnv(local, resolvedRemote);

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

async function pullVercel(): Promise<void> {
  let project;

  try {
    project = vercelProvider.detect();
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
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

  let target: VercelTarget | undefined;

  try {
    target = await resolveVercelTarget();
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  if (!target) {
    printError("A Vercel environment is required when pulling variables.");
    process.exitCode = 1;
    return;
  }

  let variables;

  try {
    variables = await vercelProvider.list(project);
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const filtered = variables.filter((variable) =>
    variable.targets.includes(target),
  );

  if (filtered.length === 0) {
    printWarning(`No Vercel environment variables found for ${target}.`);
    return;
  }

  const readable: Record<string, string> = {};
  const unreadable: string[] = [];

  for (const variable of filtered) {
    let value: string | undefined;

    try {
      value = await vercelProvider.getValue(project, variable);
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }

    if (value === undefined) {
      unreadable.push(variable.key);
      continue;
    }

    readable[variable.key] = value;
  }

  if (Object.keys(readable).length === 0) {
    printWarning(
      `No readable Vercel environment variables found for ${target}.`,
    );

    if (unreadable.length > 0) {
      printWarning(
        `${unreadable.length} sensitive variable${
          unreadable.length === 1 ? " is" : "s are"
        } write-only on Vercel and could not be pulled:`,
      );

      for (const key of unreadable) {
        console.log(`  ${pc.dim(key)}`);
      }
    }

    return;
  }

  const filename = `.env.vercel.${target}`;
  const outputPath = resolve(process.cwd(), filename);

  if (existsSync(outputPath)) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      printError(
        `${filename} already exists and cannot be overwritten non-interactively.`,
      );
      process.exitCode = 1;
      return;
    }

    let overwrite: boolean;

    try {
      overwrite = await confirm({
        message: `${filename} already exists. Overwrite it?`,
        default: false,
      });
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }

    if (!overwrite) {
      printWarning("Pull cancelled.");
      return;
    }
  }

  writeFileSync(outputPath, stringifyEnv(readable), "utf8");

  const count = Object.keys(readable).length;

  printSuccess(
    `Pulled ${count} variable${count === 1 ? "" : "s"} to ${filename}.`,
  );

  if (unreadable.length > 0) {
    printWarning(
      `${unreadable.length} sensitive variable${
        unreadable.length === 1 ? " is" : "s are"
      } write-only on Vercel and could not be pulled:`,
    );

    for (const key of unreadable) {
      console.log(`  ${pc.dim(key)}`);
    }
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
    printError(
      "No linked Vercel project found. Expected .vercel/project.json.",
    );
    process.exitCode = 1;
    return;
  }

  try {
    const variables = await vercelProvider.list(project);

    let target: VercelTarget | undefined;

    try {
      target = await resolveVercelTarget();
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }

    const filtered = target
      ? variables.filter((variable) => variable.targets.includes(target))
      : variables;

    if (filtered.length === 0) {
      printWarning(
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
    printError(error instanceof Error ? error.message : String(error));
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

  case "pull":
    if (args[0] === "vercel") {
      await pullVercel();
      break;
    }

    printError("Unknown pull provider.");
    console.log(`${pc.dim("Usage:")} ${pc.cyan("envkit pull vercel")}`);
    process.exitCode = 1;
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
    printError(`Unknown command: ${command}`);
    console.log(
      `${pc.dim("Run")} ${pc.cyan("envkit help")} ${pc.dim("for usage.")}`,
    );
    process.exitCode = 1;
}
