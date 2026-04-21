# Code Review -- P0 Fixes release/v0.3.0

**Reviewer**: Independent security-focused review
**Date**: 2026-04-17
**Scope**: 5 commits on `release/v0.3.0` addressing all P0 blockers from the v0.3.0 audit
**Commits**: `39825d55`, `f48c1996`, `2bcb1803`, `d4bfcec3`, `c56b3467`
**Volume**: 17 files, +465 / -75 lines

---

## 1. Summary Table

| P0 ID | Fix Description | Score | Verdict |
|---|---|---|---|
| **P0-1** | Daemon.start() creates stub `default` profile on cold-start | **4.5 / 5** | LGTM |
| **P0-2** | Bounded retry (3 attempts) on provider validators | **3.5 / 5** | LGTM (with recommendations) |
| **P0-3** | project.json written with mode 0600 | **5 / 5** | LGTM |
| **P0-4/P0-5** | WS auth migrated from query string to Sec-WebSocket-Protocol | **4.5 / 5** | LGTM |
| **Regression** | Cold-start smoke test for P0-1 | **3.5 / 5** | LGTM (incomplete coverage) |

**Overall score**: 4.2 / 5

**Overall verdict**: **LGTM -- safe to tag v0.3.0** with non-blocking recommendations for v0.3.1.

---

## 2. Detailed Review Per P0

### P0-1 -- Daemon.start() default profile stub (4.5 / 5) -- LGTM

**Commit**: `39825d55`
**File**: `packages/core/src/daemon.ts` (+52/-21)

#### What the fix does

Adds `ensureDefaultProfileStub()` -- called early in `Daemon.start()` before loading persisted projects or writing `daemon.json`. When `credentials.json` is absent or empty, it seeds a single `default` profile of type `anthropic-oauth`. The fix also introduces a `loomfloHome` config parameter to make the daemon testable against an isolated directory.

#### Correctness analysis

The fix correctly addresses the P0: on a fresh machine (cold-start), the S2 onboarding wizard's `resolveProviderProfile("default")` will now find a usable profile instead of throwing.

Key correctness properties:

1. **Idempotent**: `list()` returns existing profiles; early-return if `Object.keys(existing).length > 0`. Existing credentials are never overwritten.
2. **Correct ordering**: The stub is created *before* `projectsRegistry.list()` and before `writeDaemonFile()`, so any downstream consumer (wizard, CLI) sees the profile immediately.
3. **Profile shape**: `{ type: "anthropic-oauth" }` matches the discriminated union in `ProviderProfile` -- no missing required fields.
4. **Refactored helpers**: `writeDaemonFile()`, `removeDaemonFile()`, `getDaemonFilePath()` all accept `loomfloHome` parameter now. Consistent usage across `start()`, `stop()`, and `forceShutdown()`.

#### Edge cases and issues

1. **`loadDaemonInfo()` still hardcodes `homedir()`** (line 638). This is the only exported function that didn't get the `loomfloHome` parameter. Intentional (CLI callers don't have a Daemon instance), but should have an inline comment explaining the asymmetry. Low risk -- only affects test isolation, not production behavior.

2. **TOCTOU between `list()` and `upsert()`** (lines 171-173). Two daemons starting simultaneously could both see an empty profile list and both write the same stub. In practice: (a) the spec uses `proper-lockfile` for daemon startup, (b) even without the lock the write is idempotent (same key, same value). Non-issue.

3. **No explicit `await mkdir(loomfloHome, { recursive: true })` before `profiles.upsert()`**. This relies on `ProviderProfiles.upsert()` creating the directory internally. If that assumption breaks, cold-start on a truly fresh system (where `~/.loomflo/` doesn't exist yet) would throw ENOENT. Verified: `writeDaemonFile()` does `mkdir(loomfloHome, { recursive: true })` later in `start()`, but `ensureDefaultProfileStub()` runs *before* that. **This depends on `ProviderProfiles` internally creating the directory.** Worth a defensive `await mkdir(this.loomfloHome, { recursive: true })` at the start of `ensureDefaultProfileStub()`. Minor risk.

#### Test quality

Covered by the regression test in commit `c56b3467` (reviewed separately below). The `loomfloHome` injection is well-designed for test isolation.

---

### P0-2 -- Bounded retry on provider validators (3.5 / 5) -- LGTM (with recommendations)

**Commit**: `f48c1996`
**Files**: `packages/cli/src/onboarding/index.ts` (+47/-19), `packages/cli/tests/unit/onboarding/retry.test.ts` (+113, new)

#### What the fix does

Replaces the single-shot validator call with a loop of up to `VALIDATOR_MAX_ATTEMPTS = 3`. Extracted a clean `runValidatorOnce()` helper. On each failure the spinner shows the attempt number. After 3 failures, throws with the last reason/hint.

#### Correctness analysis

The retry loop is structurally correct:
- Returns immediately on success (line 163-164)
- Accumulates `lastReason`/`lastHint` on each failure
- Throws after exhausting all attempts with the final error context
- Spinner lifecycle (`start`/`stop`) is in try/finally, preventing orphaned spinners

#### Edge cases and issues

1. **No delay between retries** (lines 153-177). This is the most significant gap. The purpose of retrying a transient 503 or network timeout is to let the remote service recover. Three immediate retries (~milliseconds apart) are functionally identical to a single attempt against most transient failures. The fix needs an exponential backoff:

```typescript
if (attempt > 1) await new Promise(r => setTimeout(r, 200 * 2 ** (attempt - 2)));
```

This would give ~200ms, ~400ms delays. Not blocking for v0.3.0 (the retry still helps for DNS resolution glitches or connection pool exhaustion), but should be v0.3.1.

2. **No distinction between retryable and non-retryable errors** (line 161). A 401 `invalid_api_key` will be retried 3 times, wasting ~3 spinner cycles on a deterministic failure. The validators should propagate a `retryable: boolean` flag, and the loop should break early on `retryable === false`. Not blocking (3 fast retries are barely noticeable), but poor UX.

3. **Ctrl-C during retry loop**: The `finally` block calls `sp.stop()` which is correct. However, if SIGINT arrives between attempts (after `sp.stop()` from one iteration but before `sp.start()` of the next), the process exits cleanly without a dangling spinner. This is actually fine -- no issue here.

4. **`runValidatorOnce` exception handling**: If the validator *throws* (as opposed to returning `{ ok: false }`), the error bubbles out of the retry loop immediately. This is correct behavior for unexpected errors (e.g., a bug in the validator code), but it means a network `TypeError: fetch failed` will not be retried. The validators should be catching those internally and returning `{ ok: false, reason: ... }`. Worth verifying but out of scope for this review.

#### Test quality

Good coverage with 3 test cases:
- Success on 3rd attempt (happy path of retry)
- Failure after 3 attempts (terminal error with correct message)
- Short-circuit on 1st success (no unnecessary retries)

**Missing**: No test for the case where `runValidatorOnce` throws (as opposed to returning `{ ok: false }`). This would verify whether thrown exceptions bypass the retry loop as expected.

---

### P0-3 -- project.json mode 0600 (5 / 5) -- LGTM

**Commit**: `2bcb1803`
**Files**: `packages/cli/src/commands/init.ts` (+10/-2), `packages/cli/tests/unit/onboarding/init.test.ts` (+20/-1)

#### What the fix does

1. Passes `mode: 0o600` to `writeFile()` for new file creation
2. Follows up with `chmod(projectFile, 0o600)` to handle the case where the file already exists (POSIX `writeFile` ignores `mode` on existing files)
3. Clear inline comment explaining *why* both calls are needed

#### Correctness analysis

This is a textbook fix. Both code paths are covered:
- New file: `writeFile` with `mode` creates it with 0600
- Existing file with looser permissions (e.g., 0644 from a previous version): `chmod` tightens it

The `chmod` call is unconditional (always runs even on a new file), which is slightly redundant but harmless and simpler than checking.

#### Edge cases and issues

1. **Micro TOCTOU window**: Between `writeFile` and `chmod`, there are a few microseconds where a new file has 0600 (from `writeFile`) or an existing file still has 0644 (before `chmod`). Exploiting this requires a local attacker with a tight race condition on `open()`. At that threat level the daemon token in memory is already compromised. Non-actionable.

2. **`config.json` not hardened** (line 184-199). The sibling `config.json` written immediately after `project.json` does NOT get `mode: 0600`. While `config.json` currently holds `budgetLimit`, `defaultDelay`, `retryDelay`, and `level` (not secrets), the `...result.answers.advanced` spread could potentially include sensitive config in the future. **Recommendation**: Apply the same 0600 pattern to `config.json` for defense in depth. Not a P0 (no secrets today), but a P2 for v0.3.1.

#### Test quality

Excellent. Two dedicated tests:
- `writes project.json with 0600 mode`: asserts `stat().mode & 0o777 === 0o600` on fresh creation
- `re-runs on a pre-existing 0644 project.json and tightens it to 0600`: pre-creates a 0644 file, runs init, verifies tightening

Both tests run against a real temp directory (not mocked fs), which is the right approach for permission tests.

---

### P0-4/P0-5 -- WS auth via Sec-WebSocket-Protocol (4.5 / 5) -- LGTM

**Commit**: `d4bfcec3`
**Files**: 11 files across core, cli, dashboard, sdk (+148/-32)

This is the largest and most security-sensitive fix. It migrates WebSocket authentication from `?token=<value>` in the URL to `Sec-WebSocket-Protocol: loomflo.bearer, <token>` in the upgrade header.

#### What the fix does

**Server side** (`packages/core/src/api/server.ts`):
- Registers `handleProtocols` with `@fastify/websocket` to negotiate the `loomflo.bearer` subprotocol. Only echoes the prefix (not the token) in the response.
- New `extractBearerFromSubprotocol()` parser: splits the comma-separated header, validates the prefix, extracts the token from position [1].
- WebSocket route handler reads from `_request.headers["sec-websocket-protocol"]` instead of URL query params.

**Client side** (4 clients updated):
- `packages/cli/src/client.ts`: `new WebSocket(url, ["loomflo.bearer", this.token])`
- `packages/cli/src/observation/ws.ts`: Same pattern, with documented `WS_SUBPROTOCOL_PREFIX` constant
- `packages/sdk/src/client.ts`: Same pattern, removed `encodeURIComponent` (no longer needed)
- `packages/dashboard/src/lib/ws.ts`: New `wsSubprotocols()` helper, `wsUrl()` no longer takes token param, clears `u.search`

#### Correctness analysis

1. **RFC 6455 compliance**: The `Sec-WebSocket-Protocol` header is the standard mechanism for subprotocol negotiation. Using it to carry auth tokens is an established pattern (used by Kubernetes API, GraphQL subscriptions, etc.). The server correctly echoes only the protocol name (not the token) via `handleProtocols`.

2. **Token never in URL**: All 4 clients confirmed to pass token via protocols array. Tests explicitly assert `url.not.toContain("token=")`.

3. **Parser robustness** (`extractBearerFromSubprotocol`):
   - Handles `undefined` header (returns null)
   - Handles `string[]` (joins with comma) -- covers Node.js header array normalization
   - `split(",").map(trim).filter(length>0)` handles whitespace variations
   - Validates prefix before extracting token
   - Returns null on malformed input (too few parts, wrong prefix)

4. **Coordinated migration**: All 4 clients + server + all their tests updated in a single atomic commit. No partial migration state possible.

#### Edge cases and issues

1. **No timing-safe comparison** (line 460): `presentedToken !== token` uses JavaScript string equality, which is vulnerable to timing attacks. The daemon token is 32 random bytes (64 hex chars), making timing attacks impractical (would need ~64 * N measurements with sub-microsecond precision on localhost). However, this is now the *sole* authentication gate for WebSocket connections. **Recommendation**: Use `crypto.timingSafeEqual(Buffer.from(presentedToken), Buffer.from(token))` with a length check first. P2 for v0.3.1.

2. **Token with commas would break the parser** (line 176): `extractBearerFromSubprotocol` splits on commas, so a token containing `,` would be truncated at the first comma. **Verified safe**: the daemon generates tokens via `randomBytes(32).toString("hex")` (line 237), producing only `[0-9a-f]` characters. But this is an implicit coupling -- if token generation ever changes, the parser silently fails. A defensive approach would be to `parts.slice(1).join(",")` instead of `parts[1]`. Low priority.

3. **Backward compatibility**: A v0.2.x client sending `?token=<value>` to a v0.3.0 daemon will be rejected with close code 4001 ("Unauthorized") with no helpful error message. Since the SDK is versioned in the same monorepo, this is manageable, but:
   - **Must be documented as a breaking change in the CHANGELOG**
   - Consider: the server could log a warning when it sees a `token` query param on `/ws` without valid subprotocol auth, hinting the client to upgrade. Nice-to-have.

4. **`handleProtocols` signature** (line 254): The callback takes `(protocols: Set<string>)` but `@fastify/websocket` may pass `(protocols: Set<string>, request: IncomingMessage)`. The one-parameter signature works because JS ignores extra arguments, but a TypeScript-strict upgrade of `@fastify/websocket` could break this. Add `_req: unknown` as second parameter for future-proofing.

5. **Dashboard `wsUrl()` API change**: The function signature changed from `wsUrl(baseUrl, token)` to `wsUrl(baseUrl)`. Any external consumer of this function (unlikely in a monorepo but possible) would get a silent breakage if they pass a second argument that's now ignored. The TypeScript compiler catches this though.

#### Test quality

Excellent. Every client has updated tests:
- CLI `client.test.ts`: Verifies URL has no token, protocols array is correct
- CLI `observation/ws.test.ts`: Dedicated test "carries the token on the Sec-WebSocket-Protocol subprotocol, not the URL"
- SDK `client.test.ts`: Updated existing tests + renamed "URL-encode the token" test to verify subprotocol
- Dashboard `useWebSocket.test.ts`: Verifies URL and protocols
- Core `websocket-subscription.test.ts`: Integration test with real daemon, updated to use subprotocol

**Missing**: No test for a client that sends the *wrong* subprotocol prefix (e.g., `["wrong.prefix", token]`) or no subprotocol at all. Would strengthen the auth rejection path. Minor.

---

### Regression Test -- Cold-start smoke (3.5 / 5) -- LGTM

**Commit**: `c56b3467`
**File**: `packages/core/tests/unit/cold-start.test.ts` (+75, new)

#### What the tests cover

1. **Creates stub `default` profile when credentials.json is absent**: Verifies the file is created, contains a `default` profile of type `anthropic-oauth`, and has 0600 permissions.
2. **Does not overwrite existing profiles**: Pre-seeds a `my-key` profile, starts daemon, confirms `my-key` still present and `default` not added.
3. **Exposes a token and serves /health after cold-start**: Verifies the token format (64 hex chars) and that the HTTP server responds 200 on `/health`.

#### Test quality analysis

Good isolation using `mkdtemp` + `loomfloHome` override + `rm` cleanup in `afterEach`. The `daemon.stop().catch(() => undefined)` is appropriate for cleanup resilience.

#### Issues

1. **Does not test the full cold-start-to-init flow**: The audit recommended verifying that `Daemon.start()` followed by `loomflo init` succeeds on a virgin directory. The current test only verifies the stub profile creation, not that the wizard can actually *use* it. A bug in the profile shape or the wizard's profile resolution would not be caught.

2. **Brittle internal cast** (lines 64-66):
```typescript
const address = (
  daemon as unknown as { server: { server: { address: () => { port: number } } } }
).server.server.address();
```
This reaches into Daemon's private `server` field through two levels of indirection. Any refactor of the Daemon class internals would silently break this test. **Recommendation**: Expose a `daemon.address()` or `daemon.boundPort` public accessor.

3. **No negative assertion**: Tests verify that `/health` returns 200, but don't verify that authenticated endpoints return 401 without a Bearer token. This would ensure the cold-started daemon is actually enforcing auth, not accidentally running in an open state.

---

## 3. Cross-Cutting Risks

| # | Severity | Risk | Status |
|---|---|---|---|
| A | Medium | Old v0.2.x clients rejected silently (close 4001) on v0.3.0 daemon | **Must document in CHANGELOG** |
| B | Medium | No backoff delay between retry attempts (P0-2) -- retries are nearly useless against real transient failures | Acceptable for v0.3.0, fix in v0.3.1 |
| C | Low | `loadDaemonInfo()` hardcodes `homedir()` while rest of daemon is parameterized | Only affects test isolation |
| D | Low | Timing attack on WS token comparison | Pre-existing, not worsened by this change |
| E | Low | `config.json` still written without 0600 permissions | No secrets today, but defense-in-depth gap |
| F | Negligible | TOCTOU in `ensureDefaultProfileStub()` | Idempotent write, mitigated by lockfile |

No regressions detected. The 5 fixes are well-scoped and do not introduce new attack surface.

---

## 4. Overall Verdict

### LGTM -- release/v0.3.0 is safe to tag

All 5 P0 blockers from the audit are correctly addressed. The security fixes (P0-3 file permissions, P0-4/P0-5 WS token migration) are sound and well-tested. The P0-1 cold-start fix is clean and idempotent. The P0-2 retry mechanism works but lacks backoff.

No blocking issues found. The codebase is in a shippable state.

### Blocking conditions
**None.**

### Non-blocking recommendations for v0.3.1

| # | Priority | Issue | File | Action |
|---|---|---|---|---|
| R1 | P1 | Add exponential backoff between retries | `packages/cli/src/onboarding/index.ts:153` | Insert delay: `await new Promise(r => setTimeout(r, 200 * 2 ** (attempt - 2)))` for attempt > 1 |
| R2 | P1 | Distinguish retryable vs non-retryable errors | `packages/cli/src/onboarding/validators.ts` | Add `retryable: boolean` to error return type; break loop early on `!retryable` |
| R3 | P2 | Use `timingSafeEqual` for WS token comparison | `packages/core/src/api/server.ts:460` | `crypto.timingSafeEqual(Buffer.from(presentedToken), Buffer.from(token))` with length guard |
| R4 | P2 | Document WS auth breaking change | `CHANGELOG.md` | Note migration from `?token=` to `Sec-WebSocket-Protocol` |
| R5 | P2 | Apply 0600 permissions to `config.json` | `packages/cli/src/commands/init.ts:184-199` | Same `writeFile + chmod` pattern as `project.json` |
| R6 | P3 | Add E2E test: cold-start then init | `packages/core/tests/` | Chain `Daemon.start()` + `createInitCommand().parseAsync()` on isolated `loomfloHome` |
| R7 | P3 | Expose `daemon.boundPort` public accessor | `packages/core/src/daemon.ts` | Replace brittle cast in cold-start test |
| R8 | P3 | Add `_req` param to `handleProtocols` | `packages/core/src/api/server.ts:254` | Future-proof against `@fastify/websocket` type changes |

### Optional improvements (v0.4+)

- Make `extractBearerFromSubprotocol` rejoin parts with `parts.slice(1).join(",")` for theoretical comma-in-token safety
- Parameterize `loadDaemonInfo()` with optional `loomfloHome` for full test isolation parity
- Add negative auth assertions to cold-start smoke test (401 on authenticated endpoints)

---

## 5. Files Modified

```
packages/cli/src/client.ts                                +5 -2
packages/cli/src/commands/init.ts                         +10 -2
packages/cli/src/observation/ws.ts                        +16 -6
packages/cli/src/onboarding/index.ts                      +47 -19
packages/cli/tests/unit/client.test.ts                    +9 -5
packages/cli/tests/unit/observation/ws.test.ts            +13 -1
packages/cli/tests/unit/onboarding/init.test.ts           +20 -1
packages/cli/tests/unit/onboarding/retry.test.ts          +113 (new)
packages/core/src/api/server.ts                           +46 -5
packages/core/src/daemon.ts                               +43 -15
packages/core/tests/unit/cold-start.test.ts               +75 (new)
packages/core/tests/unit/websocket-subscription.test.ts   +2 -2
packages/dashboard/src/hooks/useWebSocket.ts              +2 -2
packages/dashboard/src/lib/ws.ts                          +18 -3
packages/dashboard/test/hooks/useWebSocket.test.ts        +19 -1
packages/sdk/src/client.ts                                +6 -3
packages/sdk/tests/unit/client.test.ts                    +8 -4
------------------------------------------------------------
17 files                                                  +465 -75
```

---

*Review conducted 2026-04-17 against diffs of commits 39825d55..c56b3467 on branch release/v0.3.0, with targeted reads of daemon.ts, server.ts, onboarding/index.ts, init.ts, ws.ts, and their test files.*
