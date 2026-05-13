import stripAnsi from 'strip-ansi';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

let themeModule: typeof import('../../../src/theme/theme.js');

async function loadTheme(forceLevel: 0 | 3): Promise<void> {
  vi.resetModules();
  const chalk = (await import('chalk')).default;
  chalk.level = forceLevel;
  themeModule = await import('../../../src/theme/theme.js');
}

describe('theme', () => {
  beforeEach(() => {
    delete process.env['NO_COLOR'];
    delete process.env['FORCE_COLOR'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accent() emits ANSI at chalk.level=3', async () => {
    await loadTheme(3);
    const out = themeModule.theme.accent('ok');
    expect(out).not.toBe('ok');
    expect(stripAnsi(out)).toBe('ok');
  });

  it('accent() returns plain string at chalk.level=0', async () => {
    await loadTheme(0);
    expect(themeModule.theme.accent('ok')).toBe('ok');
  });

  it('glyph helpers are stable constants', async () => {
    await loadTheme(3);
    const { glyph } = themeModule.theme;
    expect(glyph.check).toBe('\u2713');
    expect(glyph.cross).toBe('\u2717');
    expect(glyph.arrow).toBe('\u2192');
    expect(glyph.warn).toBe('\u26A0');
    expect(glyph.dot).toBe('\u25CF');
  });

  it('line() formats glyph + text + optional meta', async () => {
    await loadTheme(0);
    const { theme } = themeModule;
    expect(theme.line(theme.glyph.check, 'accent', 'daemon running')).toBe('\u2713 daemon running');
    expect(theme.line(theme.glyph.check, 'accent', 'daemon running', 'pid 42, up 3s')).toBe('\u2713 daemon running  (pid 42, up 3s)');
  });

  it('kv() aligns key/value with 2-space indent and fixed key width', async () => {
    await loadTheme(0);
    const { theme } = themeModule;
    expect(theme.kv('provider', 'anthropic-oauth')).toBe('  provider   anthropic-oauth');
    expect(theme.kv('level', '2')).toBe('  level      2');
  });

  it('heading() renders underlined accent title', async () => {
    await loadTheme(0);
    const out = themeModule.theme.heading('my-todo-app');
    expect(out.split('\n')[0]).toBe('my-todo-app');
    expect(out.split('\n')[1]).toBe('-----------');
  });

  it('table() renders a cli-table3 with ASCII borders at level 0', async () => {
    await loadTheme(0);
    const out = themeModule.theme.table(
      ['A', 'B'],
      [{ a: '1', b: '2' }, { a: '3', b: '4' }],
      [{ header: 'A', get: (r) => r.a }, { header: 'B', get: (r) => r.b }],
    );
    expect(out).toContain('A');
    expect(out).toContain('B');
    expect(out).toContain('1');
    expect(out).toContain('4');
  });

  it('spinner() returns an ora instance (smoke)', async () => {
    await loadTheme(3);
    const s = themeModule.theme.spinner('loading');
    expect(s).toBeDefined();
    expect(typeof s.start).toBe('function');
    expect(typeof s.stop).toBe('function');
  });
});
