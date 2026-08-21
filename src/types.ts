export type EnvRecord = Record<string, string>;

export type EnvSourceType = "file" | "process" | "provider";

export interface EnvSource {
  type: EnvSourceType;
  name: string;
  values: EnvRecord;
}

export interface EnvLoadOptions {
  cwd?: string;
  files?: string[];
  includeProcessEnv?: boolean;
}
