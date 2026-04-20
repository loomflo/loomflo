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

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function writeJsonStream(values: Iterable<unknown>): void {
  for (const v of values) {
    process.stdout.write(`${JSON.stringify(v)}\n`);
  }
}

export function writeError(opts: WithJsonOption, message: string, code?: string): void {
  if (isJsonMode(opts)) {
    const payload = code === undefined ? { error: message } : { error: message, code };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  const meta = code === undefined ? undefined : code;
  process.stderr.write(`${theme.line(theme.glyph.cross, 'err', message, meta)}\n`);
}
