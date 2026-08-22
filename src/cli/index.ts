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
  ${pc.cyan("push vercel")}           Push local variables to Vercel
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

async function pushVercel(): Promise<void> {
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
    printError("A Vercel environment is required when pushing variables.");
    process.exitCode = 1;
    return;
  }

  const sources = loadEnvSources({
    includeProcessEnv: false,
  });

  const local = mergeEnvSources(sources);

  if (Object.keys(local).length === 0) {
    printWarning("No local environment variables found.");
    return;
  }

  let remote;

  try {
    remote = await vercelProvider.list(project);
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const scopedRemote = remote.filter((variable) =>
    variable.targets.includes(target),
  );

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

  const actionable = differences.filter(
    (entry) => entry.type === "added" || entry.type === "changed",
  );

  const unknown = differences.filter((entry) => entry.type === "unknown");

  if (actionable.length === 0 && unknown.length === 0) {
    printSuccess(`Vercel ${target} environment is already up to date.`);
    return;
  }

  console.log(`\n${pc.bold(`Vercel ${target}`)}\n`);

  for (const entry of actionable) {
    console.log(`${printDiffSymbol(entry.type)} ${pc.bold(entry.key)}`);
  }

  for (const entry of unknown) {
    console.log(
      `${printDiffSymbol(entry.type)} ${pc.bold(entry.key)} ${pc.dim(
        "(sensitive, skipped)",
      )}`,
    );
  }

  if (actionable.length === 0) {
    printWarning("No safely comparable variables need to be pushed.");
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    printError("Push requires confirmation in interactive mode.");
    process.exitCode = 1;
    return;
  }

  let proceed: boolean;

  try {
    proceed = await confirm({
      message: `Push ${actionable.length} variable${
        actionable.length === 1 ? "" : "s"
      } to Vercel ${target}?`,
      default: false,
    });
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  if (!proceed) {
    printWarning("Push cancelled.");
    return;
  }

  for (const entry of actionable) {
    const value = local[entry.key];

    if (value === undefined) {
      continue;
    }

    const existing = scopedRemote.find(
      (variable) => variable.key === entry.key,
    );

    try {
      await vercelProvider.upsert(project, {
        key: entry.key,
        value,
        target,
        type: existing?.type === "plain" ? "plain" : "encrypted",
      });
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }

    printSuccess(`Pushed ${entry.key}.`);
  }

  printSuccess(`Vercel ${target} environment updated.`);

  if (unknown.length > 0) {
    printWarning(
      `${unknown.length} sensitive variable${
        unknown.length === 1 ? " was" : "s were"
      } skipped because Vercel does not expose their current values.`,
    );
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

  case "push":
    if (args[0] === "vercel") {
      await pushVercel();
      break;
    }

    printError("Unknown push provider.");
    console.log(`${pc.dim("Usage:")} ${pc.cyan("envkit push vercel")}`);
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
