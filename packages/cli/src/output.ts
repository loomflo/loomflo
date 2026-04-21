import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { theme } from './theme/index.js';

export interface WithJsonOption {
  json?: boolean;
}

export function withJsonSupport(cmd: Command): Command {
  const already = cmd.options.some((o) => o.long === '--json');
  if (already) return cmd;
  return cmd.option('--json', 'Emit machine-readable JSON (no colours, no spinners)');
}

export function isJsonMode(opts: WithJsonOption): boolean {
  return opts.json === true;
}

export function isDebugMode(): boolean {
  return process.env['LOOMFLO_DEBUG'] === '1';
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function writeJsonStream(values: Iterable<unknown>): void {
  for (const v of values) {
    process.stdout.write(`${JSON.stringify(v)}\n`);
  }
}

export function writeError(
  opts: WithJsonOption,
  message: string,
  code?: string,
  err?: unknown,
): void {
  if (isJsonMode(opts)) {
    const payload: Record<string, unknown> =
      code === undefined ? { error: message } : { error: message, code };
    if (isDebugMode() && err instanceof Error && typeof err.stack === 'string') {
      payload["stack"] = err.stack;
    }
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  const meta = code === undefined ? undefined : code;
  process.stderr.write(`${theme.line(theme.glyph.cross, 'err', message, meta)}\n`);
  if (isDebugMode()) {
    if (err instanceof Error && typeof err.stack === 'string') {
      process.stderr.write(`${err.stack}\n`);
    }
    const daemonLog = join(homedir(), '.loomflo', 'daemon.log');
    process.stderr.write(`  daemon log: ${daemonLog}\n`);
  }
}
