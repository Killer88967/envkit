import type { EnvRecord } from "../types";
import type { RemoteEnvVariable, VercelTarget } from "../providers/types";
import type { EnvDiffEntry } from "./types";

export function diffRemoteEnv(
  local: EnvRecord,
  remote: RemoteEnvVariable[],
  target?: VercelTarget,
): EnvDiffEntry[] {
  const filteredRemote = target
    ? remote.filter((variable) => variable.targets.includes(target))
    : remote;

  const remoteByKey = new Map(
    filteredRemote.map((variable) => [variable.key, variable]),
  );

  const keys = new Set([
    ...Object.keys(local),
    ...filteredRemote.map((variable) => variable.key),
  ]);

  const result: EnvDiffEntry[] = [];

  for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
    const localExists = Object.prototype.hasOwnProperty.call(local, key);
    const remoteVariable = remoteByKey.get(key);

    if (localExists && !remoteVariable) {
      result.push({
        key,
        type: "added",
        local: local[key],
      });
      continue;
    }

    if (!localExists && remoteVariable) {
      result.push({
        key,
        type: "removed",
        remote: remoteVariable.value,
      });
      continue;
    }

    if (!remoteVariable) {
      continue;
    }

    if (remoteVariable.value === undefined) {
      result.push({
        key,
        type: "unknown",
        local: local[key],
      });
      continue;
    }

    if (local[key] !== remoteVariable.value) {
      result.push({
        key,
        type: "changed",
        local: local[key],
        remote: remoteVariable.value,
      });
      continue;
    }

    result.push({
      key,
      type: "unchanged",
      local: local[key],
      remote: remoteVariable.value,
    });
  }

  return result;
}
