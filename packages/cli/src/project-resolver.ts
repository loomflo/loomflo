import { dirname, parse } from "node:path";
import { readFile } from "node:fs/promises";
import { ensureProjectIdentity, readProjectIdentity, type ProjectIdentity } from "@loomflo/core";

export interface ResolveOptions {
  cwd: string;
  createIfMissing: boolean;
  name?: string;
}

export interface ResolveResult {
  identity: ProjectIdentity;
  projectRoot: string;
  created: boolean;
}

export async function resolveProject(opts: ResolveOptions): Promise<ResolveResult> {
  const existing = await readProjectIdentity(opts.cwd);
  if (existing) {
    const root = await findProjectRoot(opts.cwd);
    return { identity: existing, projectRoot: root, created: false };
  }
  if (!opts.createIfMissing) {
    throw new Error(
      `${opts.cwd} is not a loomflo project (no .loomflo/project.json found). ` +
        `Run 'loomflo start' to initialise, or cd into a project directory.`,
    );
  }
  const identity = await ensureProjectIdentity(
    opts.cwd,
    opts.name !== undefined ? { name: opts.name } : undefined,
  );
  return { identity, projectRoot: opts.cwd, created: true };
}

async function findProjectRoot(dir: string): Promise<string> {
  const root = parse(dir).root;
  let current = dir;
  for (;;) {
    try {
      await readFile(`${current}/.loomflo/project.json`, "utf-8");
      return current;
    } catch {
      if (current === root) throw new Error("project root not found");
      current = dirname(current);
    }
  }
}
