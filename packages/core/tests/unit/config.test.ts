import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PartialConfig } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}));

// Import after mocks are set up
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  ConfigSchema,
  deepMerge,
  loadConfigFile,
  loadConfig,
} from '../../src/config.js';

const mockReadFile = vi.mocked(readFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure mockReadFile to return specific content per file path,
 * and ENOENT for all others.
 */
function stubFiles(files: Record<string, string>): void {
  mockReadFile.mockImplementation(async (path: Parameters<typeof readFile>[0]) => {
    const p = typeof path === 'string' ? path : String(path);
    if (p in files) {
      return files[p];
    }
    const err = new Error(`ENOENT: no such file: ${p}`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
  // Default: all file reads return ENOENT
  stubFiles({});
});

// ===== DEFAULT_CONFIG =====

describe('DEFAULT_CONFIG', () => {
  it('has level 3', () => {
    expect(DEFAULT_CONFIG.level).toBe(3);
  });

  it('has apiRateLimit 60', () => {
    expect(DEFAULT_CONFIG.apiRateLimit).toBe(60);
  });

  it('has reviewerEnabled true', () => {
    expect(DEFAULT_CONFIG.reviewerEnabled).toBe(true);
  });

  it('has expected default values for all fields', () => {
    expect(DEFAULT_CONFIG).toEqual({
      level: 3,
      defaultDelay: '0',
      reviewerEnabled: true,
      maxRetriesPerNode: 3,
      maxRetriesPerTask: 2,
      maxLoomasPerLoomi: null,
      retryStrategy: 'adaptive',
      models: {
        loom: 'claude-opus-4-6',
        loomi: 'claude-sonnet-4-6',
        looma: 'claude-sonnet-4-6',
        loomex: 'claude-sonnet-4-6',
      },
      provider: 'anthropic',
      budgetLimit: null,
      pauseOnBudgetReached: true,
      sandboxCommands: true,
      allowNetwork: false,
      dashboardPort: 3000,
      dashboardAutoOpen: true,
      agentTimeout: 600_000,
      agentTokenLimit: 100_000,
      apiRateLimit: 60,
    });
  });
});

// ===== ConfigSchema validation =====

describe('ConfigSchema validation', () => {
  it('produces full defaults from an empty object', () => {
    const result = ConfigSchema.parse({});
    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it('rejects a string where a boolean is expected', () => {
    const result = ConfigSchema.safeParse({ reviewerEnabled: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects a string where a number is expected', () => {
    const result = ConfigSchema.safeParse({ apiRateLimit: 'fast' });
    expect(result.success).toBe(false);
  });

  it('rejects dashboardPort below 1', () => {
    const result = ConfigSchema.safeParse({ dashboardPort: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects dashboardPort above 65535', () => {
    const result = ConfigSchema.safeParse({ dashboardPort: 70000 });
    expect(result.success).toBe(false);
  });

  it('rejects negative maxRetriesPerNode', () => {
    const result = ConfigSchema.safeParse({ maxRetriesPerNode: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects negative agentTimeout', () => {
    const result = ConfigSchema.safeParse({ agentTimeout: -100 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid level value', () => {
    const result = ConfigSchema.safeParse({ level: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid retryStrategy value', () => {
    const result = ConfigSchema.safeParse({ retryStrategy: 'exponential' });
    expect(result.success).toBe(false);
  });
});

// ===== deepMerge =====

describe('deepMerge', () => {
  it('merges flat properties', () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  it('recursively merges nested objects', () => {
    const target = { nested: { x: 1, y: 2 } };
    const source = { nested: { y: 3 } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ nested: { x: 1, y: 3 } });
  });

  it('sets value to null when source is null', () => {
    const result = deepMerge({ a: 10 }, { a: null });
    expect(result).toEqual({ a: null });
  });

  it('skips undefined values in source', () => {
    const result = deepMerge({ a: 1, b: 2 }, { a: undefined, b: 5 });
    expect(result).toEqual({ a: 1, b: 5 });
  });

  it('replaces arrays instead of concatenating', () => {
    const result = deepMerge({ items: [1, 2, 3] }, { items: [4, 5] });
    expect(result).toEqual({ items: [4, 5] });
  });

  it('does not mutate the target object', () => {
    const target = { a: 1, nested: { x: 10 } };
    const original = { ...target, nested: { ...target.nested } };
    deepMerge(target, { a: 2, nested: { x: 20 } });
    expect(target).toEqual(original);
  });

  it('adds new keys from source', () => {
    const result = deepMerge({ a: 1 } as Record<string, unknown>, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

// ===== loadConfigFile =====

describe('loadConfigFile', () => {
  it('returns empty object for non-existent file', async () => {
    const result = await loadConfigFile('/does/not/exist.json');
    expect(result).toEqual({});
  });

  it('parses valid JSON correctly', async () => {
    stubFiles({
      '/config.json': JSON.stringify({ level: 2, provider: 'openai' }),
    });
    const result = await loadConfigFile('/config.json');
    expect(result).toEqual({ level: 2, provider: 'openai' });
  });

  it('throws Error on invalid JSON', async () => {
    stubFiles({ '/bad.json': '{not valid json' });
    await expect(loadConfigFile('/bad.json')).rejects.toThrow('Invalid JSON');
  });

  it('throws Error when schema validation fails', async () => {
    stubFiles({
      '/invalid.json': JSON.stringify({ dashboardPort: -5 }),
    });
    await expect(loadConfigFile('/invalid.json')).rejects.toThrow('Invalid config');
  });

  it('throws Error on non-ENOENT read failure', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    await expect(loadConfigFile('/forbidden.json')).rejects.toThrow('Failed to read config file');
  });
});

// ===== loadConfig (3-level merge) =====

describe('loadConfig', () => {
  it('returns defaults when no config files exist', async () => {
    const config = await loadConfig();
    // Level 3 preset overrides some defaults
    expect(config.level).toBe(3);
    expect(config.reviewerEnabled).toBe(true);
    expect(config.provider).toBe('anthropic');
    expect(config.models.loom).toBe('claude-opus-4-6');
  });

  it('applies global config on top of defaults', async () => {
    stubFiles({
      '/mock-home/.loomflo/config.json': JSON.stringify({ provider: 'openai' }),
    });
    const config = await loadConfig();
    expect(config.provider).toBe('openai');
    expect(config.level).toBe(3);
  });

  it('project config overrides global config', async () => {
    stubFiles({
      '/mock-home/.loomflo/config.json': JSON.stringify({ provider: 'openai', apiRateLimit: 30 }),
      '/project/.loomflo/config.json': JSON.stringify({ provider: 'anthropic' }),
    });
    const config = await loadConfig({ projectPath: '/project' });
    expect(config.provider).toBe('anthropic');
    expect(config.apiRateLimit).toBe(30);
  });

  it('CLI overrides take highest precedence', async () => {
    stubFiles({
      '/mock-home/.loomflo/config.json': JSON.stringify({ apiRateLimit: 30 }),
      '/project/.loomflo/config.json': JSON.stringify({ apiRateLimit: 50 }),
    });
    const config = await loadConfig({
      projectPath: '/project',
      overrides: { apiRateLimit: 100 },
    });
    expect(config.apiRateLimit).toBe(100);
  });

  it('deep-merges nested models object across levels', async () => {
    stubFiles({
      '/mock-home/.loomflo/config.json': JSON.stringify({ models: { loom: 'custom-model' } }),
    });
    const config = await loadConfig();
    expect(config.models.loom).toBe('custom-model');
    // Other model keys still have level-3 preset values
    expect(config.models.loomi).toBe('claude-opus-4-6');
  });

  it('loads config without projectPath', async () => {
    const config = await loadConfig({ overrides: { allowNetwork: true } });
    expect(config.allowNetwork).toBe(true);
  });
});

// ===== Level presets =====

describe('level presets', () => {
  it('level 1 sets reviewerEnabled=false and all Sonnet models', async () => {
    const config = await loadConfig({ overrides: { level: 1 } });
    expect(config.reviewerEnabled).toBe(false);
    expect(config.maxRetriesPerNode).toBe(0);
    expect(config.maxLoomasPerLoomi).toBe(1);
    expect(config.models).toEqual({
      loom: 'claude-sonnet-4-6',
      loomi: 'claude-sonnet-4-6',
      looma: 'claude-sonnet-4-6',
      loomex: 'claude-sonnet-4-6',
    });
  });

  it('level 2 sets Loom/Looma=Opus and Loomi/Loomex=Sonnet', async () => {
    const config = await loadConfig({ overrides: { level: 2 } });
    expect(config.reviewerEnabled).toBe(true);
    expect(config.maxRetriesPerNode).toBe(1);
    expect(config.maxLoomasPerLoomi).toBe(2);
    expect(config.models.loom).toBe('claude-opus-4-6');
    expect(config.models.looma).toBe('claude-opus-4-6');
    expect(config.models.loomi).toBe('claude-sonnet-4-6');
    expect(config.models.loomex).toBe('claude-sonnet-4-6');
  });

  it('level 3 sets all Opus models', async () => {
    const config = await loadConfig({ overrides: { level: 3 } });
    expect(config.models).toEqual({
      loom: 'claude-opus-4-6',
      loomi: 'claude-opus-4-6',
      looma: 'claude-opus-4-6',
      loomex: 'claude-opus-4-6',
    });
  });

  it('custom level applies no preset overrides', async () => {
    const config = await loadConfig({ overrides: { level: 'custom' } });
    // With no preset, defaults come directly from ConfigSchema defaults
    expect(config.level).toBe('custom');
    expect(config.models).toEqual(DEFAULT_CONFIG.models);
    expect(config.maxRetriesPerNode).toBe(DEFAULT_CONFIG.maxRetriesPerNode);
  });

  it('explicit config overrides level preset values', async () => {
    stubFiles({
      '/mock-home/.loomflo/config.json': JSON.stringify({
        models: { loomi: 'custom-orchestrator' },
      }),
    });
    const config = await loadConfig({ overrides: { level: 1 } });
    // Level 1 would set loomi to sonnet, but global config overrides it
    expect(config.models.loomi).toBe('custom-orchestrator');
    // Other models still get level-1 sonnet preset
    expect(config.models.loom).toBe('claude-sonnet-4-6');
  });

  it('level from project config is used when no CLI override', async () => {
    stubFiles({
      '/project/.loomflo/config.json': JSON.stringify({ level: 1 }),
    });
    const config = await loadConfig({ projectPath: '/project' });
    expect(config.level).toBe(1);
    expect(config.reviewerEnabled).toBe(false);
  });
});
