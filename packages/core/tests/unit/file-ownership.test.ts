import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FileOwnershipManager,
  generateTestPaths,
  isLockProtocolMessage,
  parseLockProtocolMessage,
  createLockRequest,
  createLockGrant,
  createLockDenied,
  createLockRelease,
} from '../../src/workflow/file-ownership.js';
import type {
  TemporaryLock,
  FileOwnershipState,
  LockRequestMessage,
  LockGrantMessage,
  LockDeniedMessage,
  LockReleaseMessage,
} from '../../src/workflow/file-ownership.js';

// ===========================================================================
// FileOwnershipManager
// ===========================================================================

describe('FileOwnershipManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // Constructor
  // =========================================================================

  describe('constructor', () => {
    it('creates an empty manager with no arguments', () => {
      const manager = new FileOwnershipManager();
      expect(manager.getAllScopes()).toEqual({});
      expect(manager.getActiveLocks()).toEqual([]);
    });

    it('initializes with provided scopes', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
        'looma-2': ['tests/**'],
      });
      expect(manager.getScope('looma-1')).toEqual(['src/**']);
      expect(manager.getScope('looma-2')).toEqual(['tests/**']);
    });

    it('defensive-copies initial scope arrays', () => {
      const patterns = ['src/**'];
      const manager = new FileOwnershipManager({ 'looma-1': patterns });
      patterns.push('lib/**');
      expect(manager.getScope('looma-1')).toEqual(['src/**']);
    });
  });

  // =========================================================================
  // Scope Management
  // =========================================================================

  describe('setScope', () => {
    it('sets patterns for an agent', () => {
      const manager = new FileOwnershipManager();
      manager.setScope('looma-1', ['src/**', 'lib/**']);
      expect(manager.getScope('looma-1')).toEqual(['src/**', 'lib/**']);
    });

    it('replaces existing patterns', () => {
      const manager = new FileOwnershipManager({ 'looma-1': ['old/**'] });
      manager.setScope('looma-1', ['new/**']);
      expect(manager.getScope('looma-1')).toEqual(['new/**']);
    });

    it('defensive-copies the patterns array', () => {
      const manager = new FileOwnershipManager();
      const patterns = ['src/**'];
      manager.setScope('looma-1', patterns);
      patterns.push('sneaky/**');
      expect(manager.getScope('looma-1')).toEqual(['src/**']);
    });
  });

  describe('getScope', () => {
    it('returns empty array for unknown agent', () => {
      const manager = new FileOwnershipManager();
      expect(manager.getScope('unknown')).toEqual([]);
    });
  });

  describe('removeScope', () => {
    it('removes scope for an agent', () => {
      const manager = new FileOwnershipManager({ 'looma-1': ['src/**'] });
      manager.removeScope('looma-1');
      expect(manager.getScope('looma-1')).toEqual([]);
    });

    it('is a no-op for non-existent agent', () => {
      const manager = new FileOwnershipManager();
      manager.removeScope('unknown');
      expect(manager.getAllScopes()).toEqual({});
    });
  });

  describe('getAllScopes', () => {
    it('returns a defensive copy', () => {
      const manager = new FileOwnershipManager({ 'looma-1': ['src/**'] });
      const scopes = manager.getAllScopes();
      scopes['looma-1']!.push('hack/**');
      expect(manager.getScope('looma-1')).toEqual(['src/**']);
    });
  });

  // =========================================================================
  // Non-Overlap Validation
  // =========================================================================

  describe('validateNoOverlap', () => {
    it('returns valid when no scopes exist', () => {
      const manager = new FileOwnershipManager();
      expect(manager.validateNoOverlap()).toEqual({ valid: true, overlaps: [] });
    });

    it('returns valid with a single agent', () => {
      const manager = new FileOwnershipManager({ 'looma-1': ['src/**'] });
      expect(manager.validateNoOverlap().valid).toBe(true);
    });

    it('returns valid with non-overlapping scopes', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
        'looma-2': ['tests/**'],
        'looma-3': ['docs/**'],
      });
      expect(manager.validateNoOverlap().valid).toBe(true);
    });

    it('detects overlapping scopes', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
        'looma-2': ['src/utils/**'],
      });
      const result = manager.validateNoOverlap();
      expect(result.valid).toBe(false);
      expect(result.overlaps).toHaveLength(1);
      expect(result.overlaps[0]).toContain('looma-1');
      expect(result.overlaps[0]).toContain('looma-2');
    });

    it('skips agents with empty pattern arrays', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
        'looma-2': [],
      });
      expect(manager.validateNoOverlap().valid).toBe(true);
    });

    it('detects multiple overlaps', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['**/*.ts'],
        'looma-2': ['src/**/*.ts'],
        'looma-3': ['lib/**/*.ts'],
      });
      const result = manager.validateNoOverlap();
      expect(result.valid).toBe(false);
      expect(result.overlaps.length).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // Temporary Locks
  // =========================================================================

  describe('grantTemporaryLock', () => {
    it('creates a lock with correct fields', () => {
      const manager = new FileOwnershipManager();
      const lock = manager.grantTemporaryLock(
        'looma-1',
        ['config/*.json'],
        60_000,
        'loomi-1',
      );

      expect(lock.id).toBeDefined();
      expect(lock.agentId).toBe('looma-1');
      expect(lock.patterns).toEqual(['config/*.json']);
      expect(lock.grantedAt).toBe('2026-03-28T12:00:00.000Z');
      expect(lock.expiresAt).toBe('2026-03-28T12:01:00.000Z');
      expect(lock.grantedBy).toBe('loomi-1');
    });

    it('uses default duration when not specified', () => {
      const manager = new FileOwnershipManager();
      const lock = manager.grantTemporaryLock(
        'looma-1',
        ['config/*.json'],
        undefined as unknown as number,
        'loomi-1',
      );

      // Default is 5 minutes (300000ms)
      expect(lock.expiresAt).toBe('2026-03-28T12:05:00.000Z');
    });

    it('defensive-copies patterns', () => {
      const manager = new FileOwnershipManager();
      const patterns = ['config/*.json'];
      const lock = manager.grantTemporaryLock('looma-1', patterns, 60_000, 'loomi-1');
      patterns.push('sneaky/**');
      expect(lock.patterns).toEqual(['config/*.json']);
    });
  });

  describe('releaseTemporaryLock', () => {
    it('removes an existing lock and returns true', () => {
      const manager = new FileOwnershipManager();
      const lock = manager.grantTemporaryLock('looma-1', ['a/**'], 60_000, 'loomi-1');
      expect(manager.releaseTemporaryLock(lock.id)).toBe(true);
      expect(manager.getActiveLocks()).toEqual([]);
    });

    it('returns false for non-existent lock', () => {
      const manager = new FileOwnershipManager();
      expect(manager.releaseTemporaryLock('no-such-lock')).toBe(false);
    });
  });

  describe('getActiveLocks', () => {
    it('returns only non-expired locks', () => {
      const manager = new FileOwnershipManager();
      manager.grantTemporaryLock('looma-1', ['a/**'], 30_000, 'loomi-1');
      manager.grantTemporaryLock('looma-2', ['b/**'], 90_000, 'loomi-1');

      // Advance 60 seconds — first lock expired, second still active
      vi.advanceTimersByTime(60_000);

      const active = manager.getActiveLocks();
      expect(active).toHaveLength(1);
      expect(active[0]!.agentId).toBe('looma-2');
    });

    it('filters by agent ID when provided', () => {
      const manager = new FileOwnershipManager();
      manager.grantTemporaryLock('looma-1', ['a/**'], 60_000, 'loomi-1');
      manager.grantTemporaryLock('looma-2', ['b/**'], 60_000, 'loomi-1');

      expect(manager.getActiveLocks('looma-1')).toHaveLength(1);
      expect(manager.getActiveLocks('looma-2')).toHaveLength(1);
      expect(manager.getActiveLocks('looma-3')).toHaveLength(0);
    });

    it('returns all active locks when no agent ID provided', () => {
      const manager = new FileOwnershipManager();
      manager.grantTemporaryLock('looma-1', ['a/**'], 60_000, 'loomi-1');
      manager.grantTemporaryLock('looma-2', ['b/**'], 60_000, 'loomi-1');

      expect(manager.getActiveLocks()).toHaveLength(2);
    });
  });

  describe('pruneExpiredLocks', () => {
    it('removes expired locks and returns count', () => {
      const manager = new FileOwnershipManager();
      manager.grantTemporaryLock('looma-1', ['a/**'], 30_000, 'loomi-1');
      manager.grantTemporaryLock('looma-2', ['b/**'], 90_000, 'loomi-1');

      vi.advanceTimersByTime(60_000);

      const pruned = manager.pruneExpiredLocks();
      expect(pruned).toBe(1);
      expect(manager.getActiveLocks()).toHaveLength(1);
    });

    it('returns 0 when no locks are expired', () => {
      const manager = new FileOwnershipManager();
      manager.grantTemporaryLock('looma-1', ['a/**'], 60_000, 'loomi-1');
      expect(manager.pruneExpiredLocks()).toBe(0);
    });

    it('returns 0 when there are no locks', () => {
      const manager = new FileOwnershipManager();
      expect(manager.pruneExpiredLocks()).toBe(0);
    });
  });

  // =========================================================================
  // Combined Write Permission Check
  // =========================================================================

  describe('isWriteAllowed', () => {
    it('allows writes within permanent scope', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**/*.ts'],
      });
      expect(manager.isWriteAllowed('looma-1', 'src/utils/helper.ts')).toBe(true);
    });

    it('denies writes outside permanent scope', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**/*.ts'],
      });
      expect(manager.isWriteAllowed('looma-1', 'tests/foo.ts')).toBe(false);
    });

    it('denies writes for unknown agent', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**/*.ts'],
      });
      expect(manager.isWriteAllowed('unknown', 'src/foo.ts')).toBe(false);
    });

    it('allows writes via active temporary lock', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
      });
      manager.grantTemporaryLock('looma-1', ['config/*.json'], 60_000, 'loomi-1');

      expect(manager.isWriteAllowed('looma-1', 'config/settings.json')).toBe(true);
    });

    it('denies writes via expired temporary lock', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
      });
      manager.grantTemporaryLock('looma-1', ['config/*.json'], 30_000, 'loomi-1');

      vi.advanceTimersByTime(60_000);

      expect(manager.isWriteAllowed('looma-1', 'config/settings.json')).toBe(false);
    });

    it('does not grant lock to different agent', () => {
      const manager = new FileOwnershipManager();
      manager.grantTemporaryLock('looma-1', ['config/*.json'], 60_000, 'loomi-1');

      expect(manager.isWriteAllowed('looma-2', 'config/settings.json')).toBe(false);
    });

    it('checks permanent scope before locks (fast path)', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
      });
      // Even though there's a lock, permanent scope should match first
      manager.grantTemporaryLock('looma-1', ['src/**'], 60_000, 'loomi-1');
      expect(manager.isWriteAllowed('looma-1', 'src/foo.ts')).toBe(true);
    });

    it('denies write for agent with empty scope and no locks', () => {
      const manager = new FileOwnershipManager({
        'looma-1': [],
      });
      expect(manager.isWriteAllowed('looma-1', 'src/foo.ts')).toBe(false);
    });
  });

  // =========================================================================
  // Effective Scope
  // =========================================================================

  describe('getEffectiveScope', () => {
    it('returns permanent scope when no locks', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
      });
      expect(manager.getEffectiveScope('looma-1')).toEqual(['src/**']);
    });

    it('includes active lock patterns', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
      });
      manager.grantTemporaryLock('looma-1', ['config/*.json'], 60_000, 'loomi-1');
      expect(manager.getEffectiveScope('looma-1')).toEqual([
        'src/**',
        'config/*.json',
      ]);
    });

    it('excludes expired lock patterns', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
      });
      manager.grantTemporaryLock('looma-1', ['config/*.json'], 30_000, 'loomi-1');
      vi.advanceTimersByTime(60_000);

      expect(manager.getEffectiveScope('looma-1')).toEqual(['src/**']);
    });

    it('excludes locks from other agents', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
      });
      manager.grantTemporaryLock('looma-2', ['config/*.json'], 60_000, 'loomi-1');

      expect(manager.getEffectiveScope('looma-1')).toEqual(['src/**']);
    });

    it('returns empty for unknown agent', () => {
      const manager = new FileOwnershipManager();
      expect(manager.getEffectiveScope('unknown')).toEqual([]);
    });
  });

  // =========================================================================
  // Serialization
  // =========================================================================

  describe('toJSON / fromJSON', () => {
    it('round-trips empty state', () => {
      const manager = new FileOwnershipManager();
      const state = manager.toJSON();
      const restored = FileOwnershipManager.fromJSON(state);
      expect(restored.getAllScopes()).toEqual({});
      expect(restored.getActiveLocks()).toEqual([]);
    });

    it('round-trips scopes and locks', () => {
      const manager = new FileOwnershipManager({
        'looma-1': ['src/**'],
        'looma-2': ['tests/**'],
      });
      const lock = manager.grantTemporaryLock(
        'looma-1',
        ['config/*.json'],
        60_000,
        'loomi-1',
      );

      const state = manager.toJSON();
      const restored = FileOwnershipManager.fromJSON(state);

      expect(restored.getAllScopes()).toEqual({
        'looma-1': ['src/**'],
        'looma-2': ['tests/**'],
      });

      const restoredLocks = restored.getActiveLocks();
      expect(restoredLocks).toHaveLength(1);
      expect(restoredLocks[0]!.id).toBe(lock.id);
      expect(restoredLocks[0]!.agentId).toBe('looma-1');
      expect(restoredLocks[0]!.patterns).toEqual(['config/*.json']);
    });

    it('produces defensive copies in toJSON', () => {
      const manager = new FileOwnershipManager({ 'looma-1': ['src/**'] });
      const state = manager.toJSON();
      state.scopes['looma-1']!.push('hack/**');
      expect(manager.getScope('looma-1')).toEqual(['src/**']);
    });

    it('produces defensive copies in fromJSON', () => {
      const state: FileOwnershipState = {
        scopes: { 'looma-1': ['src/**'] },
        temporaryLocks: [],
      };
      const restored = FileOwnershipManager.fromJSON(state);
      state.scopes['looma-1']!.push('hack/**');
      expect(restored.getScope('looma-1')).toEqual(['src/**']);
    });

    it('preserves expired locks in toJSON', () => {
      const manager = new FileOwnershipManager();
      manager.grantTemporaryLock('looma-1', ['a/**'], 30_000, 'loomi-1');
      vi.advanceTimersByTime(60_000);

      const state = manager.toJSON();
      expect(state.temporaryLocks).toHaveLength(1);
    });
  });
});

// ===========================================================================
// Lock Protocol Helpers
// ===========================================================================

describe('Lock Protocol Helpers', () => {
  describe('isLockProtocolMessage', () => {
    it('returns true for valid lock protocol JSON', () => {
      expect(isLockProtocolMessage('{"protocol":"file_lock","action":"lock_request"}')).toBe(true);
    });

    it('returns false for non-JSON content', () => {
      expect(isLockProtocolMessage('hello world')).toBe(false);
    });

    it('returns false for JSON with wrong protocol', () => {
      expect(isLockProtocolMessage('{"protocol":"other","action":"lock_request"}')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isLockProtocolMessage('')).toBe(false);
    });
  });

  describe('parseLockProtocolMessage', () => {
    it('parses a lock_request message', () => {
      const content = createLockRequest('config/*.json', 'Need to update config');
      const parsed = parseLockProtocolMessage(content);
      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('lock_request');
      expect((parsed as LockRequestMessage).targetPattern).toBe('config/*.json');
      expect((parsed as LockRequestMessage).reason).toBe('Need to update config');
    });

    it('parses a lock_grant message', () => {
      const lock: TemporaryLock = {
        id: 'lock-123',
        agentId: 'looma-1',
        patterns: ['config/*.json'],
        grantedAt: '2026-03-28T12:00:00.000Z',
        expiresAt: '2026-03-28T12:01:00.000Z',
        grantedBy: 'loomi-1',
      };
      const content = createLockGrant(lock);
      const parsed = parseLockProtocolMessage(content);
      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('lock_grant');
      expect((parsed as LockGrantMessage).lockId).toBe('lock-123');
      expect((parsed as LockGrantMessage).patterns).toEqual(['config/*.json']);
    });

    it('parses a lock_denied message', () => {
      const content = createLockDenied('config/*.json', 'Another agent owns this');
      const parsed = parseLockProtocolMessage(content);
      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('lock_denied');
      expect((parsed as LockDeniedMessage).targetPattern).toBe('config/*.json');
      expect((parsed as LockDeniedMessage).reason).toBe('Another agent owns this');
    });

    it('parses a lock_release message', () => {
      const content = createLockRelease('lock-456');
      const parsed = parseLockProtocolMessage(content);
      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('lock_release');
      expect((parsed as LockReleaseMessage).lockId).toBe('lock-456');
    });

    it('returns null for non-JSON content', () => {
      expect(parseLockProtocolMessage('not json')).toBeNull();
    });

    it('returns null for wrong protocol', () => {
      expect(parseLockProtocolMessage('{"protocol":"other"}')).toBeNull();
    });

    it('returns null for unknown action', () => {
      expect(
        parseLockProtocolMessage('{"protocol":"file_lock","action":"unknown"}'),
      ).toBeNull();
    });
  });

  describe('createLockRequest', () => {
    it('creates valid JSON with correct fields', () => {
      const content = createLockRequest('src/shared.ts', 'Need shared config');
      const parsed = JSON.parse(content) as LockRequestMessage;
      expect(parsed.protocol).toBe('file_lock');
      expect(parsed.action).toBe('lock_request');
      expect(parsed.targetPattern).toBe('src/shared.ts');
      expect(parsed.reason).toBe('Need shared config');
    });
  });

  describe('createLockGrant', () => {
    it('creates valid JSON with correct fields', () => {
      const lock: TemporaryLock = {
        id: 'lock-abc',
        agentId: 'looma-1',
        patterns: ['a/**', 'b/**'],
        grantedAt: '2026-03-28T12:00:00.000Z',
        expiresAt: '2026-03-28T12:05:00.000Z',
        grantedBy: 'loomi-1',
      };
      const content = createLockGrant(lock);
      const parsed = JSON.parse(content) as LockGrantMessage;
      expect(parsed.protocol).toBe('file_lock');
      expect(parsed.action).toBe('lock_grant');
      expect(parsed.lockId).toBe('lock-abc');
      expect(parsed.patterns).toEqual(['a/**', 'b/**']);
      expect(parsed.expiresAt).toBe('2026-03-28T12:05:00.000Z');
    });
  });

  describe('createLockDenied', () => {
    it('creates valid JSON with correct fields', () => {
      const content = createLockDenied('x/**', 'Owned by looma-2');
      const parsed = JSON.parse(content) as LockDeniedMessage;
      expect(parsed.protocol).toBe('file_lock');
      expect(parsed.action).toBe('lock_denied');
      expect(parsed.targetPattern).toBe('x/**');
      expect(parsed.reason).toBe('Owned by looma-2');
    });
  });

  describe('createLockRelease', () => {
    it('creates valid JSON with correct fields', () => {
      const content = createLockRelease('lock-xyz');
      const parsed = JSON.parse(content) as LockReleaseMessage;
      expect(parsed.protocol).toBe('file_lock');
      expect(parsed.action).toBe('lock_release');
      expect(parsed.lockId).toBe('lock-xyz');
    });
  });
});

// ===========================================================================
// generateTestPaths
// ===========================================================================

describe('generateTestPaths', () => {
  it('replaces ** with a/b', () => {
    const paths = generateTestPaths(['src/**/index.ts']);
    expect(paths).toContain('src/a/b/index.ts');
  });

  it('replaces * with test.file', () => {
    const paths = generateTestPaths(['src/*.ts']);
    expect(paths).toContain('src/test.file.ts');
  });

  it('replaces brace expansion with first alternative', () => {
    const paths = generateTestPaths(['src/*.{ts,js}']);
    expect(paths).toContain('src/test.file.ts');
  });

  it('replaces ? with x', () => {
    const paths = generateTestPaths(['src/?.ts']);
    expect(paths).toContain('src/x.ts');
  });

  it('deduplicates identical patterns', () => {
    const paths = generateTestPaths(['src/**', 'src/**']);
    expect(paths).toHaveLength(1);
  });

  it('handles multiple patterns', () => {
    const paths = generateTestPaths(['src/**', 'tests/**']);
    expect(paths).toHaveLength(2);
    expect(paths).toContain('src/a/b');
    expect(paths).toContain('tests/a/b');
  });

  it('returns empty array for empty input', () => {
    expect(generateTestPaths([])).toEqual([]);
  });
});
