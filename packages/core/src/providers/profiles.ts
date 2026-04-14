// packages/core/src/providers/profiles.ts
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** A named bundle of provider credentials. */
export type ProviderProfile =
  | { type: "anthropic-oauth" }
  | { type: "anthropic"; apiKey: string }
  | { type: "openai"; apiKey: string; baseUrl?: string; defaultModel?: string }
  | { type: "moonshot"; apiKey: string; baseUrl?: string; defaultModel?: string }
  | { type: "nvidia"; apiKey: string; baseUrl?: string; defaultModel?: string };

interface CredentialsFile {
  profiles: Record<string, ProviderProfile>;
}

const FILE_MODE = 0o600;

/** Read / write `~/.loomflo/credentials.json` with atomic writes and 0600 perms. */
export class ProviderProfiles {
  constructor(private readonly filePath: string) {}

  async list(): Promise<Record<string, ProviderProfile>> {
    const file = await this.read();
    return file.profiles;
  }

  async get(name: string): Promise<ProviderProfile | null> {
    const file = await this.read();
    return file.profiles[name] ?? null;
  }

  async upsert(name: string, profile: ProviderProfile): Promise<void> {
    const file = await this.read();
    file.profiles[name] = profile;
    await this.writeRaw(file);
  }

  async remove(name: string): Promise<void> {
    const file = await this.read();
    delete file.profiles[name];
    await this.writeRaw(file);
  }

  private async read(): Promise<CredentialsFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { profiles: {} };
      throw err;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "profiles" in parsed &&
        typeof (parsed as CredentialsFile).profiles === "object"
      ) {
        return parsed as CredentialsFile;
      }
    } catch {
      /* fall through */
    }
    // Corrupt — quarantine and start empty.
    const quarantine = `${this.filePath}.corrupt.${Date.now()}`;
    await rename(this.filePath, quarantine).catch(() => undefined);
    const empty: CredentialsFile = { profiles: {} };
    await this.writeRaw(empty);
    return empty;
  }

  private async writeRaw(file: CredentialsFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, JSON.stringify(file, null, 2), { mode: FILE_MODE });
    await rename(tmp, this.filePath);
    await chmod(this.filePath, FILE_MODE);
  }
}
