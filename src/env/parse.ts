import type { EnvRecord } from "../types";

export interface ParseEnvOptions {
  expand?: boolean;
}

function stripInlineComment(value: string): string {
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < value.length; index++) {
    const character = value[index];

    if (character === "'" || character === '"') {
      if (quote === character) {
        quote = null;
      } else if (quote === null) {
        quote = character;
      }

      continue;
    }

    if (character === "#" && quote === null) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

function unquote(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];

  if (first === '"' && last === '"') {
    return value
      .slice(1, -1)
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }

  if (first === "'" && last === "'") {
    return value.slice(1, -1);
  }

  return value;
}

function expandValue(value: string, values: EnvRecord): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => values[name] ?? "",
  );
}

export function parseEnv(
  input: string,
  options: ParseEnvOptions = {},
): EnvRecord {
  const values: EnvRecord = {};

  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    let line = lines[lineNumber]?.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("export ")) {
      line = line.slice(7).trimStart();
    }

    const separator = line.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new SyntaxError(
        `Invalid environment variable name "${key}" on line ${lineNumber + 1}`,
      );
    }

    let value = line.slice(separator + 1).trim();

    value = stripInlineComment(value);
    value = unquote(value);

    if (options.expand) {
      value = expandValue(value, values);
    }

    values[key] = value;
  }

  return values;
}
