import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";

/** Stable identity of a project on this machine. */
export interface ProjectIdentity {
  id: string;
  name: string;
  providerProfileId: string;
  createdAt: string;
}

/** Generate a new project id of the form `proj_<8 hex>`. */
export function generateProjectId(): string {
  return `proj_${randomBytes(4).toString("hex")}`;
}

/** Read `.loomflo/project.json` walking up from `dir`. Returns `null` if not found. */
export async function readProjectIdentity(dir: string): Promise<ProjectIdentity | null> {
  const root = parse(dir).root;
  let current = dir;
  while (true) {
    const candidate = join(current, ".loomflo", "project.json");
    try {
      const raw = await readFile(candidate, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (isIdentity(parsed)) return parsed;
    } catch {
      /* not this level */
    }
    if (current === root) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Create a fresh identity and write `.loomflo/project.json` in `dir`. */
export async function createProjectIdentity(
  dir: string,
  options?: { name?: string; providerProfileId?: string },
): Promise<ProjectIdentity> {
  const ident: ProjectIdentity = {
    id: generateProjectId(),
    name: options?.name ?? basename(dir),
    providerProfileId: options?.providerProfileId ?? "default",
    createdAt: new Date().toISOString(),
  };
  const outDir = join(dir, ".loomflo");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "project.json"), JSON.stringify(ident, null, 2));
  return ident;
}

/** Return existing identity at `dir`, or create one (migrating legacy layouts transparently). */
export async function ensureProjectIdentity(
  dir: string,
  options?: { name?: string; providerProfileId?: string },
): Promise<ProjectIdentity> {
  const existing = await readProjectIdentity(dir);
  if (existing) return existing;

  const legacyState = join(dir, ".loomflo", "state.json");
  const legacy = await stat(legacyState).then(() => true).catch(() => false);
  if (legacy) {
    console.warn(`[loomflo] migrating legacy project at ${dir} to multi-project layout`);
  }

  return await createProjectIdentity(dir, options);
}

function isIdentity(value: unknown): value is ProjectIdentity {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["name"] === "string" &&
    typeof v["providerProfileId"] === "string" &&
    typeof v["createdAt"] === "string"
  );
}
