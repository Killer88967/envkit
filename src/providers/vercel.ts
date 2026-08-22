import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  ProviderAdapter,
  ProviderProject,
  RemoteEnvVariable,
} from "./types";

interface VercelProjectFile {
  projectId?: string;
  orgId?: string;
}

interface VercelEnvVariable {
  id: string;
  key: string;
  value?: string;
  target?: string[];
  type?: string;
}

interface VercelEnvResponse {
  envs?: VercelEnvVariable[];
}

function getToken(explicit?: string): string {
  const token = explicit ?? process.env.VERCEL_TOKEN;

  if (!token) {
    throw new Error(
      "Vercel authentication required. Set VERCEL_TOKEN before using the Vercel provider.",
    );
  }

  return token;
}

export const vercelProvider: ProviderAdapter = {
  name: "vercel",

  detect(cwd = process.cwd()): ProviderProject | null {
    const projectPath = resolve(cwd, ".vercel", "project.json");

    if (!existsSync(projectPath)) {
      return null;
    }

    let project: VercelProjectFile;

    try {
      project = JSON.parse(
        readFileSync(projectPath, "utf8"),
      ) as VercelProjectFile;
    } catch {
      throw new Error("Unable to parse .vercel/project.json.");
    }

    if (!project.projectId) {
      throw new Error(".vercel/project.json does not contain a projectId.");
    }

    return {
      provider: "vercel",
      projectId: project.projectId,
      orgId: project.orgId,
    };
  },

  async list(project, options = {}): Promise<RemoteEnvVariable[]> {
    const token = getToken(options.token);

    const url = new URL(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(
        project.projectId,
      )}/env`,
    );

    if (project.orgId) {
      url.searchParams.set("teamId", project.orgId);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      let details = "";

      try {
        const body = await response.json();

        if (body && typeof body === "object" && "error" in body) {
          const error = body.error;

          if (
            error &&
            typeof error === "object" &&
            "message" in error &&
            typeof error.message === "string"
          ) {
            details = `: ${error.message}`;
          }
        }
      } catch {
        // Ignore malformed error responses.
      }

      throw new Error(
        `Vercel API request failed with ${response.status}${details}`,
      );
    }

    const data = (await response.json()) as VercelEnvResponse;

    return (data.envs ?? []).map((env) => ({
      id: env.id,
      key: env.key,
      value: env.value,
      targets: env.target ?? [],
      type: env.type,
    }));
  },
};
