# Message Bus (Intra-Node Communication)

## What
In-memory message routing between agents within the same node, with a special protocol for file lock negotiation.

## Why
Loomas within a node sometimes need to coordinate — request file locks, share intermediate findings, or signal blockers. The bus provides structured messaging without shared mutable state.

## How

### Architecture
- Per-node queues: `Map<nodeId, Map<agentId, Message[]>>`
- Agents register on spawn, deregister on completion
- Messages are point-to-point (from → to) within a single node

### Message Format
```ts
{
  id: UUID,
  from: "looma-auth-1",
  to: "loomi-node-3",
  nodeId: "node-3",
  content: string,    // free-text or JSON protocol
  timestamp: ISO-8601
}
```

### File Lock Protocol
Special JSON messages for lock negotiation:
```
→ {"protocol":"file_lock","action":"lock_request","targetPattern":"src/utils.ts","reason":"..."}
← {"protocol":"file_lock","action":"lock_granted","lockId":"...","patterns":["src/utils.ts"],"expiresAt":"..."}
```
Loomi acts as the arbiter — receives requests, checks ownership, grants or denies.

### Delivery
`send_message` tool enqueues to the recipient's inbox. Messages accumulate until the recipient's next LLM call reads them as tool results.

## Files
- `packages/core/src/agents/message-bus.ts` — Bus implementation
- `packages/core/src/tools/send-message.ts` — Send tool (injected dependency)

## Gotchas
- **Not persistent** — messages are in-memory only, lost on daemon restart.
- **Node-scoped** — agents in different nodes cannot message each other (use shared memory).
- No broadcast — messages are always 1:1.
- No message ordering guarantees beyond insertion order per queue.
