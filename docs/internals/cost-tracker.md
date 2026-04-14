# Cost Tracking & Budget Enforcement

## What
Per-call token tracking with aggregation by agent and node, built-in pricing tables, and configurable budget limits that can pause the workflow.

## Why
Multi-agent workflows can burn through API credits fast. The tracker gives visibility into where tokens go and stops execution before exceeding a budget.

## How
Every LLM call is recorded via `tracker.recordCall()`:
```ts
{ model, inputTokens, outputTokens, agentId, nodeId, timestamp }
```

Cost calculation: `tokens × pricePerMToken / 1_000_000`

Default pricing (built-in):
- `claude-opus-4-6`: $15/M input, $75/M output
- `claude-sonnet-4-6`: $3/M input, $15/M output

Aggregation: two `Map<string, number>` — one keyed by nodeId, one by agentId.

Budget enforcement: `isBudgetExceeded()` checks cumulative cost against `config.budgetLimit`. The execution engine calls this before activating each node. If `pauseOnBudgetReached` is true, workflow pauses instead of failing.

Exposed via REST API at `/costs` with per-node breakdown.

An `OnRecordCallback` hook fires after each call — used for real-time WebSocket cost events.

## Files
- `packages/core/src/costs/tracker.ts` — Main tracker class
- `packages/core/src/costs/budget-error.ts` — BudgetExceededError
- `packages/core/src/costs/rate-limiter.ts` — Request rate limiting

## Gotchas
- Pricing is in-memory only — custom pricing merges with defaults but doesn't persist.
- The tracker doesn't actively pause the workflow; it reports status and the engine decides.
- `cache_read` tokens (from prompt caching) are not separately tracked yet.
