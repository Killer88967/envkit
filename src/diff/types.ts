export type EnvDiffType = "added" | "removed" | "changed" | "unchanged";

export interface EnvDiffEntry {
  key: string;
  type: EnvDiffType;

  local?: string;
  remote?: string;
}
