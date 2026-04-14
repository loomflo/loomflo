# File Ownership & Locking

## What
Two-tier file access control: permanent glob scopes assigned at planning time, plus temporary locks negotiated via MessageBus during execution.

## Why
Multiple Loomas writing to the same files causes conflicts. Instead of a central lock server, ownership is planned upfront by Loomi and enforced at the tool level.

## How

### Tier 1: Permanent Scopes
When Loomi plans its team, it assigns each Looma a set of glob patterns:
```
looma-auth-1 → ["src/auth/**", "config/oauth.ts"]
looma-ui-2   → ["src/components/**", "*.css"]
```
Write tools (`write_file`, `edit_file`) check the calling agent's scope via `picomatch` before allowing the operation. Reads are unrestricted.

### Tier 2: Temporary Locks
If a Looma needs to write outside its permanent scope, it sends a lock request via MessageBus:
```json
{"protocol": "file_lock", "action": "lock_request", "targetPattern": "src/shared/utils.ts", "reason": "need to add helper"}
```
Loomi grants or denies the lock. Granted locks have an `expiresAt` timestamp and auto-release.

Lock lifecycle: `lock_request` → `lock_granted` (with lockId + expiration) → work → `lock_release`

### Enforcement
The `FileOwnershipManager` class validates every write against both tiers. Expired locks are pruned via `pruneExpiredLocks()`.

## Files
- `packages/core/src/workflow/file-ownership.ts` — Manager, scope check, lock lifecycle

## Gotchas
- No deadlock prevention — assumes Loomi assigns non-overlapping scopes.
- Lock expiration is the only recourse if a Looma crashes mid-lock.
- Scope violations return an error string (tools never throw), so the LLM sees the rejection and can request a lock.
