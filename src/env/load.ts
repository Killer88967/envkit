import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EnvLoadOptions, EnvRecord, EnvSource } from "../types";
import { parseEnv } from "./parse";

function processEnvToRecord(): EnvRecord {
  const result: EnvRecord = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      result[name] = value;
    }
  }

  return result;
}

export function loadEnvSources(options: EnvLoadOptions = {}): EnvSource[] {
  const cwd = options.cwd ?? process.cwd();
  const files = options.files ?? [".env", ".env.local"];
  const sources: EnvSource[] = [];

  for (const file of files) {
    const absolutePath = resolve(cwd, file);

    if (!existsSync(absolutePath)) {
      continue;
    }

    const contents = readFileSync(absolutePath, "utf8");

    sources.push({
      type: "file",
      name: file,
      values: parseEnv(contents, {
        expand: true,
      }),
    });
  }

  if (options.includeProcessEnv ?? true) {
    sources.push({
      type: "process",
      name: "process.env",
      values: processEnvToRecord(),
    });
  }

  return sources;
}
