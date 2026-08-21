import type { EnvRecord } from "../types";
import type { EnvDiffEntry } from "./types";

export function diffEnv(local: EnvRecord, remote: EnvRecord): EnvDiffEntry[] {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const result: EnvDiffEntry[] = [];

  for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
    const localExists = Object.prototype.hasOwnProperty.call(local, key);
    const remoteExists = Object.prototype.hasOwnProperty.call(remote, key);

    if (localExists && !remoteExists) {
      result.push({
        key,
        type: "added",
        local: local[key],
      });

      continue;
    }

    if (!localExists && remoteExists) {
      result.push({
        key,
        type: "removed",
        remote: remote[key],
      });

      continue;
    }

    if (local[key] !== remote[key]) {
      result.push({
        key,
        type: "changed",
        local: local[key],
        remote: remote[key],
      });

      continue;
    }

    result.push({
      key,
      type: "unchanged",
      local: local[key],
      remote: remote[key],
    });
  }

  return result;
}
