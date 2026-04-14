# Review Cycle (Loomex Verdict & Retry)

## What
After workers complete a node, an optional read-only reviewer (Loomex) evaluates the output and returns a structured verdict that drives retry or escalation.

## Why
Workers can produce code that compiles but doesn't meet spec. A separate reviewer with no write access gives an unbiased quality check without being able to "fix" its own review.

## How

### Review Phase
After all Loomas in a node report complete, Loomi spawns Loomex with:
- Read-only tools (read_file, list_files, search_files, read_memory)
- The node's task list and acceptance criteria
- Full shared memory context

Loomex returns a structured `ReviewReport`:
```ts
{
  verdict: "PASS" | "FAIL" | "BLOCKED",
  tasksVerified: [{ taskId, status: "pass"|"fail", details }],
  details: string,
  recommendation: string,
  createdAt: ISO-8601
}
```

### Verdict Processing (in Loomi)
- **PASS** → node marked `done`, proceed to dependents
- **FAIL** → increment retry counter, write failure to ERRORS.md shared memory, then:
  - If `retryStrategy === "adaptive"`: call `adaptPlansForRetry()` — an LLM call that rewrites worker plans using the review feedback
  - If `retryStrategy === "same"`: rerun workers with original plans
  - Re-spawn Loomas with `retryContext` injected into system prompt
- **BLOCKED** → escalate to Loom for graph modification

### Retry Limits
`maxRetriesPerNode` (default: 3) caps total retries per node. After exhaustion, node is marked `failed` and escalated.

## Files
- `packages/core/src/agents/loomex.ts` — Reviewer agent
- `packages/core/src/agents/loomi.ts:955-1195` — Retry logic after FAIL verdict

## Gotchas
- Loomex has zero write tools — it cannot modify code, only judge it.
- `recommendation` field is free-text from the LLM; Loomi uses it as context but doesn't parse it.
- Each retry cycle re-reads shared memory (which now includes the failure), inflating input tokens.
