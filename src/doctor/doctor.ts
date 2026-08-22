import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseEnv } from "../env/parse";
import { looksSecret } from "../security/redact";
import type { DoctorCheck } from "./types";

const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "VITE_", "NUXT_PUBLIC_", "PUBLIC_"];

function checkGitIgnore(cwd: string): DoctorCheck {
  const gitignorePath = resolve(cwd, ".gitignore");

  if (!existsSync(gitignorePath)) {
    return {
      status: "warn",
      message: ".gitignore was not found.",
    };
  }

  const contents = readFileSync(gitignorePath, "utf8");

  const ignoresEnv = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => {
      return (
        line === ".env" ||
        line === ".env*" ||
        line === "*.env" ||
        line === ".env.local"
      );
    });

  if (!ignoresEnv) {
    return {
      status: "fail",
      message: ".env files do not appear to be ignored by Git.",
    };
  }

  return {
    status: "pass",
    message: ".env files are ignored by Git.",
  };
}

function checkEnvFile(cwd: string): DoctorCheck[] {
  const envPath = resolve(cwd, ".env");

  if (!existsSync(envPath)) {
    return [
      {
        status: "warn",
        message: ".env was not found.",
      },
    ];
  }

  let values;

  try {
    values = parseEnv(readFileSync(envPath, "utf8"), {
      expand: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return [
      {
        status: "fail",
        message: `.env could not be parsed: ${message}`,
      },
    ];
  }

  const checks: DoctorCheck[] = [
    {
      status: "pass",
      message: `.env parsed successfully with ${Object.keys(values).length} variables.`,
    },
  ];

  for (const key of Object.keys(values)) {
    if (!looksSecret(key)) {
      continue;
    }

    const publicPrefix = PUBLIC_PREFIXES.find((prefix) =>
      key.startsWith(prefix),
    );

    if (!publicPrefix) {
      continue;
    }

    checks.push({
      status: "fail",
      message: `${key} looks like a secret but uses the public prefix ${publicPrefix}`,
    });
  }

  return checks;
}

export function runDoctor(cwd = process.cwd()): DoctorCheck[] {
  return [...checkEnvFile(cwd), checkGitIgnore(cwd)];
}
