export type ProviderName = "vercel";

export interface RemoteEnvVariable {
  id: string;
  key: string;
  targets: string[];
  type?: string;
}

export interface ResolvedRemoteEnvVariable extends RemoteEnvVariable {
  value?: string;
}

export interface ProviderProject {
  provider: ProviderName;
  projectId: string;
  orgId?: string;
}

export interface ProviderOptions {
  token?: string;
}

export interface ProviderAdapter {
  name: ProviderName;

  detect(cwd?: string): ProviderProject | null;

  list(
    project: ProviderProject,
    options?: ProviderOptions,
  ): Promise<RemoteEnvVariable[]>;

  getValue(
    project: ProviderProject,
    variable: RemoteEnvVariable,
    options?: ProviderOptions,
  ): Promise<string | undefined>;
}

export type VercelTarget = "production" | "preview" | "development";
