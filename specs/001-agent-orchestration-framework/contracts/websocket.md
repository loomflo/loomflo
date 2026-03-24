# WebSocket Contract: Loomflo Daemon

**Endpoint**: `ws://127.0.0.1:{port}/ws`
**Auth**: Token passed as query parameter: `ws://127.0.0.1:3000/ws?token={token}`

## Connection

On connect, the server sends a welcome message:

```json
{ "type": "connected", "version": "0.1.0" }
```

The client does not send messages over WebSocket (use REST API for actions). WebSocket is a one-way event stream from daemon to clients.

## Event Types

### node_status

Sent when a node's status changes.

```json
{
  "type": "node_status",
  "nodeId": "node-2",
  "status": "running",
  "title": "Authentication Module",
  "timestamp": "2026-03-24T10:15:00Z"
}
```

### agent_status

Sent when an agent's status changes (created, running, completed, failed).

```json
{
  "type": "agent_status",
  "nodeId": "node-2",
  "agentId": "looma-auth-1",
  "role": "looma",
  "status": "running",
  "task": "Implement JWT auth middleware",
  "timestamp": "2026-03-24T10:15:05Z"
}
```

### agent_message

Sent when an agent sends a message to another agent via MessageBus.

```json
{
  "type": "agent_message",
  "nodeId": "node-2",
  "from": "looma-auth-1",
  "to": "looma-db-1",
  "summary": "Need the User model schema for auth middleware",
  "timestamp": "2026-03-24T10:16:00Z"
}
```

### review_verdict

Sent when Loomex produces a verdict.

```json
{
  "type": "review_verdict",
  "nodeId": "node-2",
  "verdict": "PASS",
  "summary": "All 3 tasks verified. Authentication middleware, password hashing, and JWT token generation all working correctly.",
  "timestamp": "2026-03-24T10:25:00Z"
}
```

### graph_modified

Sent when Loom modifies the graph during execution.

```json
{
  "type": "graph_modified",
  "action": "insert_node",
  "details": {
    "nodeId": "node-9",
    "title": "Documentation",
    "insertedAfter": "node-8",
    "reason": "User requested documentation node"
  },
  "timestamp": "2026-03-24T10:30:00Z"
}
```

Actions: `insert_node`, `remove_node`, `modify_node`, `change_delay`, `add_edge`, `remove_edge`

### cost_update

Sent after every LLM API call completes.

```json
{
  "type": "cost_update",
  "nodeId": "node-2",
  "agentId": "looma-auth-1",
  "callCost": 0.02,
  "nodeCost": 0.18,
  "totalCost": 1.45,
  "budgetRemaining": 18.55,
  "timestamp": "2026-03-24T10:16:30Z"
}
```

### memory_updated

Sent when a shared memory file is written to.

```json
{
  "type": "memory_updated",
  "file": "DECISIONS.md",
  "agentId": "loomi-2",
  "summary": "Added decision: Use bcrypt for password hashing (user preference)",
  "timestamp": "2026-03-24T10:17:00Z"
}
```

### spec_artifact_ready

Sent during Phase 1 as each spec artifact is generated.

```json
{
  "type": "spec_artifact_ready",
  "name": "spec.md",
  "path": ".loomflo/specs/spec.md",
  "timestamp": "2026-03-24T10:05:00Z"
}
```

### chat_response

Sent when Loom responds to a user chat message (for dashboard real-time update).

```json
{
  "type": "chat_response",
  "message": "Authentication is being handled in node-2. The auth middleware uses JWT tokens...",
  "action": null,
  "timestamp": "2026-03-24T10:30:05Z"
}
```

### workflow_status

Sent when the overall workflow status changes.

```json
{
  "type": "workflow_status",
  "status": "paused",
  "reason": "Budget limit reached ($20.00)",
  "timestamp": "2026-03-24T11:00:00Z"
}
```

## Reconnection

If the WebSocket connection drops, the client should reconnect with exponential backoff. On reconnect, the client should fetch current state via REST API (GET /workflow, GET /nodes) to catch up on missed events.

## Event Ordering

Events are sent in the order they occur. Each event has a `timestamp` field for ordering. The server does not buffer or batch events — they are sent immediately as they occur.
