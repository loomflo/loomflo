# Escalation System (Loomi → Loom)

## What

When a node fails beyond retries or hits a blocker, Loomi escalates to Loom (Architect) which can mutate the workflow graph mid-execution.

## Why

Static plans break when reality diverges from the spec. Rather than failing the entire workflow, Loom can restructure the remaining graph — add helper nodes, skip blocked ones, or modify instructions.

## How

### Trigger

Loomi sends an escalation via the `escalate` tool:

```ts
{
  reason: "Auth module needs a database migration node that wasn't in the spec",
  nodeId: "node-3",
  agentId: "loomi-node-3",
  suggestedAction: "add_node",
  details: "Workers failed 3 times because the schema doesn't exist yet"
}
```

### Loom Response

Loom receives the escalation, reviews the graph and shared memory, and decides on a `GraphModification`:

| Action        | Effect                                                    |
| ------------- | --------------------------------------------------------- |
| `add_node`    | New node inserted with `insertAfter`/`insertBefore` edges |
| `modify_node` | Update existing node's instructions in place              |
| `remove_node` | Delete node, reconnect predecessors → successors          |
| `skip_node`   | Mark as `done` without execution                          |
| `no_action`   | Deliberate no-op (logged with rationale)                  |

Every modification is logged to `ARCHITECTURE_CHANGES.md` in shared memory and emitted as a WebSocket event.

The execution engine picks up the modified graph on its next wake-up cycle.

## Files

- `packages/core/src/agents/escalation.ts` — Escalation types and processing
- `packages/core/src/tools/escalate.ts` — Escalate tool (Loomi only)

## Gotchas

- Graph mutations are not validated for cycles — Loom is trusted to maintain DAG property.
- `add_node` requires edge definitions; orphan nodes would never activate.
- Escalations are one-shot — if Loom's modification also fails, the node stays `failed`.
