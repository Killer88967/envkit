import type { EnvRecord } from "../types";

function quoteEnvValue(value: string): string {
  if (value === "" || /^\s|\s$/.test(value) || /[\n\r#"']/.test(value)) {
    return JSON.stringify(value);
  }

  return value;
}

export function stringifyEnv(values: EnvRecord): string {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
    .join("\n")
    .concat("\n");
}
