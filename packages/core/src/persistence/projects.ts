import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

/** One registered project known to the daemon. */
export interface ProjectEntry {
  id: string;
  name: string;
  projectPath: string;
  providerProfileId: string;
}

/** File mode for the registry file — owner read/write only. */
const REGISTRY_MODE = 0o600;

/** Read / write `~/.loomflo/projects.json` atomically, tolerant of corruption. */
export class ProjectsRegistry {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ProjectEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ProjectEntry[];
      throw new Error("projects.json is not an array");
    } catch {
      // Corrupt — quarantine and start empty.
      const quarantine = `${this.filePath}.corrupt.${Date.now()}`;
      await rename(this.filePath, quarantine).catch(() => undefined);
      await this.writeRaw([]);
      return [];
    }
  }

  async upsert(entry: ProjectEntry): Promise<void> {
    const list = await this.list();
    const idx = list.findIndex((e) => e.id === entry.id);
    if (idx === -1) list.push(entry);
    else list[idx] = entry;
    await this.writeRaw(list);
  }

  async remove(id: string): Promise<void> {
    const list = await this.list();
    const filtered = list.filter((e) => e.id !== id);
    await this.writeRaw(filtered);
  }

  async get(id: string): Promise<ProjectEntry | null> {
    const list = await this.list();
    return list.find((e) => e.id === id) ?? null;
  }

  private async writeRaw(list: ProjectEntry[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, JSON.stringify(list, null, 2), { mode: REGISTRY_MODE });
    await rename(tmp, this.filePath);
    // ensure mode even if the file pre-existed with different mode
    await chmod(this.filePath, REGISTRY_MODE);
  }
}
