export type ProviderName = "vercel";

export interface RemoteEnvVariable {
  id: string;
  key: string;
  value?: string;
  targets: string[];
  type?: string;
}

export interface ProviderProject {
  provider: ProviderName;
  projectId: string;
  orgId?: string;
}

export interface ProviderAdapter {
  name: ProviderName;
  detect(cwd?: string): ProviderProject | null;
  list(
    project: ProviderProject,
    options?: {
      token?: string;
    },
  ): Promise<RemoteEnvVariable[]>;
}

export type VercelTarget = "production" | "preview" | "development";
