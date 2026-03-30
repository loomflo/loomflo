/**
 * File Ownership System for workflow nodes.
 *
 * Manages permanent write scope assignments (agent ID → glob patterns),
 * temporary lock grants for cross-scope writes, and combined write
 * permission checks. Provides serializable state for persistence and
 * a MessageBus-based lock request/grant protocol.
 */

import { randomUUID } from 'node:crypto';
import picomatch from 'picomatch';

// ============================================================================
// Temporary Lock
// ============================================================================

/**
 * A temporary file lock granting an agent write access to glob patterns
 * outside its permanent scope.
 *
 * Temporary locks are granted by the orchestrator (Loomi) when a worker
 * discovers it needs to write outside its assigned scope. Each lock has
 * a finite duration after which it expires automatically.
 */
export interface TemporaryLock {
  /** Unique lock identifier. */
  readonly id: string;
  /** Agent that holds the lock. */
  readonly agentId: string;
  /** Glob patterns this lock grants write access to. */
  readonly patterns: readonly string[];
  /** ISO 8601 timestamp when the lock was granted. */
  readonly grantedAt: string;
  /** ISO 8601 timestamp when the lock expires. */
  readonly expiresAt: string;
  /** ID of the agent that granted the lock (typically Loomi). */
  readonly grantedBy: string;
}

// ============================================================================
// Serializable State
// ============================================================================

/**
 * Serializable snapshot of the file ownership system.
 *
 * Used for persisting ownership state across daemon restarts.
 */
export interface FileOwnershipState {
  /** Permanent scope assignments: agent ID → glob patterns. */
  scopes: Record<string, string[]>;
  /** Active temporary locks (may include expired entries). */
  temporaryLocks: TemporaryLock[];
}

// ============================================================================
// Lock Protocol Message Types
// ============================================================================

/**
 * A request from an agent to write outside its permanent scope.
 *
 * Sent as JSON-encoded content via MessageBus to the orchestrator (Loomi).
 * The orchestrator decides whether to grant or deny the request.
 */
export interface LockRequestMessage {
  /** Protocol discriminator — always `'file_lock'`. */
  readonly protocol: 'file_lock';
  /** Action discriminator. */
  readonly action: 'lock_request';
  /** File path or glob pattern the agent needs write access to. */
  readonly targetPattern: string;
  /** Human-readable reason the agent needs this access. */
  readonly reason: string;
}

/**
 * A grant response from the orchestrator.
 *
 * Sent as JSON-encoded content via MessageBus back to the requesting agent.
 */
export interface LockGrantMessage {
  /** Protocol discriminator — always `'file_lock'`. */
  readonly protocol: 'file_lock';
  /** Action discriminator. */
  readonly action: 'lock_grant';
  /** ID of the granted lock (matches {@link TemporaryLock.id}). */
  readonly lockId: string;
  /** Glob patterns the lock covers. */
  readonly patterns: readonly string[];
  /** ISO 8601 timestamp when the lock expires. */
  readonly expiresAt: string;
}

/**
 * A denial response from the orchestrator.
 *
 * Sent as JSON-encoded content via MessageBus back to the requesting agent.
 */
export interface LockDeniedMessage {
  /** Protocol discriminator — always `'file_lock'`. */
  readonly protocol: 'file_lock';
  /** Action discriminator. */
  readonly action: 'lock_denied';
  /** The pattern that was denied. */
  readonly targetPattern: string;
  /** Reason the lock was denied. */
  readonly reason: string;
}

/**
 * A release notification when a temporary lock is explicitly released.
 *
 * Sent as JSON-encoded content via MessageBus (broadcast or targeted).
 */
export interface LockReleaseMessage {
  /** Protocol discriminator — always `'file_lock'`. */
  readonly protocol: 'file_lock';
  /** Action discriminator. */
  readonly action: 'lock_release';
  /** ID of the released lock. */
  readonly lockId: string;
}

/** Union of all lock protocol message types. */
export type LockProtocolMessage =
  | LockRequestMessage
  | LockGrantMessage
  | LockDeniedMessage
  | LockReleaseMessage;

// ============================================================================
// Lock Protocol Helpers
// ============================================================================

/**
 * Checks whether a message content string is a file-lock protocol message.
 *
 * @param content - Raw message content string.
 * @returns `true` if the content parses as a lock protocol message.
 */
export function isLockProtocolMessage(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return parsed['protocol'] === 'file_lock';
  } catch {
    return false;
  }
}

/**
 * Parses a lock protocol message from a raw content string.
 *
 * @param content - Raw message content string (JSON).
 * @returns The parsed message, or `null` if the content is not a valid
 *   lock protocol message.
 */
export function parseLockProtocolMessage(content: string): LockProtocolMessage | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed['protocol'] !== 'file_lock') return null;

    const action = parsed['action'];
    if (
      action !== 'lock_request' &&
      action !== 'lock_grant' &&
      action !== 'lock_denied' &&
      action !== 'lock_release'
    ) {
      return null;
    }

    return parsed as unknown as LockProtocolMessage;
  } catch {
    return null;
  }
}

/**
 * Creates a JSON-encoded lock request message body.
 *
 * @param targetPattern - The file path or glob pattern the agent needs.
 * @param reason - Why the agent needs this access.
 * @returns JSON string suitable for MessageBus content.
 */
export function createLockRequest(targetPattern: string, reason: string): string {
  const msg: LockRequestMessage = {
    protocol: 'file_lock',
    action: 'lock_request',
    targetPattern,
    reason,
  };
  return JSON.stringify(msg);
}

/**
 * Creates a JSON-encoded lock grant message body from a {@link TemporaryLock}.
 *
 * @param lock - The temporary lock that was granted.
 * @returns JSON string suitable for MessageBus content.
 */
export function createLockGrant(lock: TemporaryLock): string {
  const msg: LockGrantMessage = {
    protocol: 'file_lock',
    action: 'lock_grant',
    lockId: lock.id,
    patterns: [...lock.patterns],
    expiresAt: lock.expiresAt,
  };
  return JSON.stringify(msg);
}

/**
 * Creates a JSON-encoded lock denied message body.
 *
 * @param targetPattern - The pattern that was denied.
 * @param reason - Why the lock was denied.
 * @returns JSON string suitable for MessageBus content.
 */
export function createLockDenied(targetPattern: string, reason: string): string {
  const msg: LockDeniedMessage = {
    protocol: 'file_lock',
    action: 'lock_denied',
    targetPattern,
    reason,
  };
  return JSON.stringify(msg);
}

/**
 * Creates a JSON-encoded lock release message body.
 *
 * @param lockId - ID of the lock to release.
 * @returns JSON string suitable for MessageBus content.
 */
export function createLockRelease(lockId: string): string {
  const msg: LockReleaseMessage = {
    protocol: 'file_lock',
    action: 'lock_release',
    lockId,
  };
  return JSON.stringify(msg);
}

// ============================================================================
// FileOwnershipManager
// ============================================================================

/** Default temporary lock duration: 5 minutes. */
const DEFAULT_LOCK_DURATION_MS = 5 * 60 * 1000;

/**
 * Manages the complete file ownership system for a workflow node.
 *
 * Combines permanent write scope assignments with temporary lock grants
 * to provide a single authority for write permission checks. Permanent
 * scopes are assigned by the orchestrator when the node starts; temporary
 * locks are granted on-demand when agents need cross-scope access.
 *
 * Write scopes MUST NOT overlap between agents. The {@link validateNoOverlap}
 * method checks this invariant and should be called after any scope change.
 *
 * @example
 * ```ts
 * const manager = new FileOwnershipManager({
 *   'looma-auth': ['src/auth/**'],
 *   'looma-api': ['src/api/**'],
 * });
 *
 * // Check permanent scope
 * manager.isWriteAllowed('looma-auth', 'src/auth/login.ts'); // true
 * manager.isWriteAllowed('looma-auth', 'src/api/routes.ts'); // false
 *
 * // Grant temporary lock
 * const lock = manager.grantTemporaryLock(
 *   'looma-auth', ['src/api/auth-routes.ts'], 60000, 'loomi-1'
 * );
 * manager.isWriteAllowed('looma-auth', 'src/api/auth-routes.ts'); // true
 * ```
 */
export class FileOwnershipManager {
  /** Permanent scope assignments: agent ID → mutable glob pattern array. */
  private readonly scopes: Map<string, string[]>;

  /** Active temporary locks keyed by lock ID. */
  private readonly locks: Map<string, TemporaryLock>;

  /**
   * Creates a FileOwnershipManager with initial permanent scope assignments.
   *
   * @param scopes - Initial scope map (agent ID → glob patterns). Defaults to empty.
   */
  constructor(scopes: Record<string, string[]> = {}) {
    this.scopes = new Map(
      Object.entries(scopes).map(([k, v]) => [k, [...v]]),
    );
    this.locks = new Map();
  }

  // ==========================================================================
  // Scope Management
  // ==========================================================================

  /**
   * Assigns permanent write scope patterns to an agent.
   *
   * Replaces any existing scope for the agent. Call {@link validateNoOverlap}
   * after modifying scopes to verify the non-overlap invariant.
   *
   * @param agentId - Agent to assign the scope to.
   * @param patterns - Glob patterns defining the agent's write scope.
   */
  setScope(agentId: string, patterns: string[]): void {
    this.scopes.set(agentId, [...patterns]);
  }

  /**
   * Returns the permanent write scope patterns for an agent.
   *
   * @param agentId - Agent whose scope to retrieve.
   * @returns Read-only array of glob patterns (empty if no scope assigned).
   */
  getScope(agentId: string): readonly string[] {
    return this.scopes.get(agentId) ?? [];
  }

  /**
   * Removes the permanent write scope for an agent.
   *
   * Does not affect any active temporary locks held by the agent.
   *
   * @param agentId - Agent whose scope to remove.
   */
  removeScope(agentId: string): void {
    this.scopes.delete(agentId);
  }

  /**
   * Returns all permanent scope assignments as a plain record.
   *
   * @returns A defensive copy of all scope assignments.
   */
  getAllScopes(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [k, v] of this.scopes) {
      result[k] = [...v];
    }
    return result;
  }

  // ==========================================================================
  // Non-Overlap Validation
  // ==========================================================================

  /**
   * Validates that no two agents have overlapping permanent write scopes.
   *
   * Tests each agent's patterns against every other agent's patterns using
   * representative test paths derived from the patterns themselves. This
   * catches common overlaps like `src/**` vs `src/utils/**`.
   *
   * @returns An object with `valid` boolean and an array of `overlaps`
   *   describing each conflict found.
   */
  validateNoOverlap(): { valid: boolean; overlaps: string[] } {
    const overlaps: string[] = [];
    const entries = Array.from(this.scopes.entries());

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const entryA = entries[i];
        const entryB = entries[j];
        if (!entryA || !entryB) continue;
        const [idA, patternsA] = entryA;
        const [idB, patternsB] = entryB;

        if (patternsA.length === 0 || patternsB.length === 0) continue;

        const matcherA = picomatch(patternsA);
        const matcherB = picomatch(patternsB);

        const testPaths = generateTestPaths([...patternsA, ...patternsB]);

        for (const testPath of testPaths) {
          if (matcherA(testPath) && matcherB(testPath)) {
            overlaps.push(
              `Agents "${idA}" and "${idB}" both match "${testPath}"`,
            );
            break;
          }
        }
      }
    }

    return { valid: overlaps.length === 0, overlaps };
  }

  // ==========================================================================
  // Temporary Locks
  // ==========================================================================

  /**
   * Grants a temporary write lock to an agent for the specified patterns.
   *
   * The lock expires after `durationMs` milliseconds. Expired locks are
   * ignored by {@link isWriteAllowed} and can be cleaned up with
   * {@link pruneExpiredLocks}.
   *
   * @param agentId - Agent receiving the lock.
   * @param patterns - Glob patterns to grant access to.
   * @param durationMs - Lock duration in milliseconds. Defaults to 5 minutes.
   * @param grantedBy - ID of the agent granting the lock (typically Loomi).
   * @returns The created {@link TemporaryLock}.
   */
  grantTemporaryLock(
    agentId: string,
    patterns: string[],
    durationMs: number = DEFAULT_LOCK_DURATION_MS,
    grantedBy: string,
  ): TemporaryLock {
    const now = new Date();
    const lock: TemporaryLock = {
      id: randomUUID(),
      agentId,
      patterns: [...patterns],
      grantedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + durationMs).toISOString(),
      grantedBy,
    };
    this.locks.set(lock.id, lock);
    return lock;
  }

  /**
   * Explicitly releases a temporary lock before its expiry.
   *
   * @param lockId - ID of the lock to release.
   * @returns `true` if the lock existed and was removed, `false` otherwise.
   */
  releaseTemporaryLock(lockId: string): boolean {
    return this.locks.delete(lockId);
  }

  /**
   * Returns all active (non-expired) temporary locks, optionally filtered
   * by agent ID.
   *
   * @param agentId - If provided, only return locks for this agent.
   * @returns Read-only array of active temporary locks.
   */
  getActiveLocks(agentId?: string): readonly TemporaryLock[] {
    const now = Date.now();
    const active: TemporaryLock[] = [];

    for (const lock of this.locks.values()) {
      if (new Date(lock.expiresAt).getTime() > now) {
        if (agentId === undefined || lock.agentId === agentId) {
          active.push(lock);
        }
      }
    }

    return active;
  }

  /**
   * Removes all expired temporary locks from the internal store.
   *
   * @returns The number of locks pruned.
   */
  pruneExpiredLocks(): number {
    const now = Date.now();
    let count = 0;

    for (const [id, lock] of this.locks) {
      if (new Date(lock.expiresAt).getTime() <= now) {
        this.locks.delete(id);
        count++;
      }
    }

    return count;
  }

  // ==========================================================================
  // Combined Write Permission Check
  // ==========================================================================

  /**
   * Checks whether an agent is allowed to write to a file path.
   *
   * Checks permanent scope first, then falls back to active temporary
   * locks. Returns `true` if the path matches any permanent scope pattern
   * or any non-expired temporary lock pattern held by the agent.
   *
   * @param agentId - Agent requesting write access.
   * @param filePath - Relative file path to check.
   * @returns `true` if the write is permitted, `false` otherwise.
   */
  isWriteAllowed(agentId: string, filePath: string): boolean {
    // Check permanent scope
    const scope = this.scopes.get(agentId);
    if (scope && scope.length > 0 && picomatch.isMatch(filePath, scope)) {
      return true;
    }

    // Check active temporary locks
    const now = Date.now();
    for (const lock of this.locks.values()) {
      if (
        lock.agentId === agentId &&
        new Date(lock.expiresAt).getTime() > now &&
        picomatch.isMatch(filePath, [...lock.patterns])
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Returns the effective write scope for an agent: permanent patterns
   * plus patterns from all active temporary locks.
   *
   * Useful for constructing a {@link ToolContext} that includes temporary
   * lock grants alongside permanent scope.
   *
   * @param agentId - Agent whose effective scope to compute.
   * @returns Array of all currently valid glob patterns for the agent.
   */
  getEffectiveScope(agentId: string): string[] {
    const patterns: string[] = [];

    const scope = this.scopes.get(agentId);
    if (scope) {
      patterns.push(...scope);
    }

    const now = Date.now();
    for (const lock of this.locks.values()) {
      if (
        lock.agentId === agentId &&
        new Date(lock.expiresAt).getTime() > now
      ) {
        patterns.push(...lock.patterns);
      }
    }

    return patterns;
  }

  // ==========================================================================
  // Serialization
  // ==========================================================================

  /**
   * Serializes the ownership state to a plain object for persistence.
   *
   * Includes all temporary locks (even expired ones) so the caller can
   * decide whether to prune before persisting.
   *
   * @returns A defensive copy of the ownership state.
   */
  toJSON(): FileOwnershipState {
    return {
      scopes: this.getAllScopes(),
      temporaryLocks: Array.from(this.locks.values()).map((l) => ({
        ...l,
        patterns: [...l.patterns],
      })),
    };
  }

  /**
   * Restores a FileOwnershipManager from a persisted state snapshot.
   *
   * @param state - The serialized state to restore from.
   * @returns A new FileOwnershipManager with the restored state.
   */
  static fromJSON(state: FileOwnershipState): FileOwnershipManager {
    const manager = new FileOwnershipManager(state.scopes);
    for (const lock of state.temporaryLocks) {
      manager.locks.set(lock.id, {
        ...lock,
        patterns: [...lock.patterns],
      });
    }
    return manager;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generates representative file paths from glob patterns for overlap testing.
 *
 * Converts glob patterns into concrete paths by replacing wildcard segments
 * with literal placeholders, producing paths that the original glob would match.
 *
 * @param patterns - Glob patterns to derive test paths from.
 * @returns Array of concrete test paths.
 */
export function generateTestPaths(patterns: string[]): string[] {
  const paths = new Set<string>();

  for (const pattern of patterns) {
    // Replace ** with a representative deep path segment
    let path = pattern.replace(/\*\*/g, 'a/b');
    // Replace remaining * with a representative filename
    path = path.replace(/\*/g, 'test.file');
    // Replace brace expansions with first alternative
    path = path.replace(/\{([^}]+)\}/g, (_match, group: string) => {
      const first = group.split(',')[0];
      return first ?? 'x';
    });
    // Replace ? with a single character
    path = path.replace(/\?/g, 'x');
    paths.add(path);
  }

  return Array.from(paths);
}
