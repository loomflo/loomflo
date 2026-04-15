import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { withJsonSupport, isJsonMode, writeJson, writeError } from '../../src/output.js';

describe('withJsonSupport', () => {
  it('adds a --json flag to the command', () => {
    const cmd = withJsonSupport(new Command('demo'));
    const opt = cmd.options.find((o) => o.long === '--json');
    expect(opt).toBeDefined();
  });

  it('does not add --json twice if already present', () => {
    const cmd = new Command('demo').option('--json', 'existing');
    const wrapped = withJsonSupport(cmd);
    const jsonOpts = wrapped.options.filter((o) => o.long === '--json');
    expect(jsonOpts).toHaveLength(1);
  });
});

describe('isJsonMode', () => {
  it('returns true when --json was passed', () => {
    expect(isJsonMode({ json: true })).toBe(true);
  });

  it('returns false when --json absent or falsy', () => {
    expect(isJsonMode({ json: false })).toBe(false);
    expect(isJsonMode({})).toBe(false);
  });
});

describe('writeJson', () => {
  it('writes a single stringified object with trailing newline to stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    writeJson({ ok: true, count: 3 });
    expect(spy).toHaveBeenCalledWith('{"ok":true,"count":3}\n');
    spy.mockRestore();
  });
});

describe('writeError', () => {
  it('writes a single {error,code} JSON line to stderr in JSON mode', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeError({ json: true }, 'boom', 'E_BOOM');
    expect(spy).toHaveBeenCalledWith('{"error":"boom","code":"E_BOOM"}\n');
    spy.mockRestore();
  });

  it('writes a themed red line to stderr in non-JSON mode', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeError({}, 'boom', 'E_BOOM');
    const call = spy.mock.calls[0]?.[0] as string;
    expect(call).toContain('boom');
    expect(call).toContain('E_BOOM');
    spy.mockRestore();
  });
});
