# REST API Contract: Loomflo Daemon

**Base URL**: `http://127.0.0.1:{port}` (default port: 3000)
**Auth**: All endpoints (except GET /health) require `Authorization: Bearer {token}` header. Token is auto-generated at daemon start and stored in `~/.loomflo/daemon.json`.

## Health

### GET /health

No auth required. Returns daemon status.

**Response 200**:
```json
{
  "status": "ok",
  "uptime": 3600,
  "version": "0.1.0",
  "workflow": {
    "id": "abc-123",
    "status": "running",
    "nodeCount": 8,
    "activeNodes": ["node-3"]
  }
}
```

**Response 200 (no workflow)**:
```json
{
  "status": "ok",
  "uptime": 3600,
  "version": "0.1.0",
  "workflow": null
}
```

## Workflow

### GET /workflow

Returns current workflow state.

**Response 200**:
```json
{
  "id": "abc-123",
  "status": "running",
  "description": "Build a REST API with auth",
  "projectPath": "/home/user/projects/my-api",
  "totalCost": 1.45,
  "createdAt": "2026-03-24T10:00:00Z",
  "updatedAt": "2026-03-24T10:30:00Z",
  "graph": {
    "nodes": [...],
    "edges": [...],
    "topology": "mixed"
  }
}
```

**Response 404**: `{ "error": "No active workflow" }`

### POST /workflow/init

Start Phase 1 (spec generation) from a natural language prompt.

**Request**:
```json
{
  "description": "Build a REST API with auth and PostgreSQL",
  "projectPath": "/home/user/projects/my-api",
  "config": {
    "budgetLimit": 20,
    "reviewerEnabled": true
  }
}
```

**Response 201**:
```json
{
  "id": "abc-123",
  "status": "spec",
  "description": "Build a REST API with auth and PostgreSQL"
}
```

**Response 409**: `{ "error": "A workflow is already active" }`

### POST /workflow/start

Confirm spec and begin Phase 2 execution.

**Response 200**: `{ "status": "running" }`
**Response 400**: `{ "error": "Workflow not in 'building' state" }`

### POST /workflow/pause

Pause the running workflow. Active agent calls finish, no new calls dispatched.

**Response 200**: `{ "status": "paused" }`
**Response 400**: `{ "error": "Workflow not running" }`

### POST /workflow/resume

Resume a paused or interrupted workflow.

**Response 200**: `{ "status": "running", "resumingFrom": "node-3" }`
**Response 400**: `{ "error": "Nothing to resume" }`

## Nodes

### GET /nodes

List all nodes in the graph.

**Response 200**:
```json
{
  "nodes": [
    {
      "id": "node-1",
      "title": "Project Setup",
      "status": "done",
      "agentCount": 2,
      "cost": 0.32,
      "retryCount": 0
    },
    {
      "id": "node-2",
      "title": "Authentication Module",
      "status": "running",
      "agentCount": 3,
      "cost": 0.18,
      "retryCount": 0
    }
  ]
}
```

### GET /nodes/:id

Node detail with agents and activity.

**Response 200**:
```json
{
  "id": "node-2",
  "title": "Authentication Module",
  "status": "running",
  "instructions": "# Authentication Module\n\nImplement...",
  "delay": "0",
  "retryCount": 0,
  "maxRetries": 3,
  "cost": 0.18,
  "startedAt": "2026-03-24T10:15:00Z",
  "agents": [
    {
      "id": "looma-auth-1",
      "role": "looma",
      "status": "running",
      "taskDescription": "Implement JWT auth middleware",
      "writeScope": ["src/auth/**", "tests/auth/**"],
      "tokenUsage": { "input": 5000, "output": 2000 },
      "cost": 0.08
    }
  ],
  "fileOwnership": {
    "looma-auth-1": ["src/auth/**", "tests/auth/**"],
    "looma-db-1": ["src/db/**", "tests/db/**"]
  }
}
```

### GET /nodes/:id/review

Get Loomex review report for a completed node.

**Response 200**:
```json
{
  "verdict": "PASS",
  "tasksVerified": [
    { "taskId": "auth-jwt", "status": "pass", "details": "JWT middleware working correctly" },
    { "taskId": "auth-hash", "status": "pass", "details": "Password hashing with bcrypt" }
  ],
  "details": "All authentication tasks completed successfully...",
  "recommendation": "None — proceed to next node",
  "createdAt": "2026-03-24T10:25:00Z"
}
```

**Response 404**: `{ "error": "No review report for this node" }`

## Specs

### GET /specs

List available spec artifacts.

**Response 200**:
```json
{
  "artifacts": [
    { "name": "constitution.md", "path": ".loomflo/specs/constitution.md", "size": 2048 },
    { "name": "spec.md", "path": ".loomflo/specs/spec.md", "size": 8192 },
    { "name": "plan.md", "path": ".loomflo/specs/plan.md", "size": 6144 },
    { "name": "tasks.md", "path": ".loomflo/specs/tasks.md", "size": 4096 },
    { "name": "analysis-report.md", "path": ".loomflo/specs/analysis-report.md", "size": 3072 }
  ]
}
```

### GET /specs/:name

Read a specific spec artifact (returns raw markdown).

**Response 200**: `Content-Type: text/markdown` — raw file content
**Response 404**: `{ "error": "Artifact not found" }`

## Shared Memory

### GET /memory

List shared memory files.

**Response 200**:
```json
{
  "files": [
    { "name": "DECISIONS.md", "lastModifiedBy": "loomi-1", "lastModifiedAt": "2026-03-24T10:20:00Z" },
    { "name": "PROGRESS.md", "lastModifiedBy": "loomi-1", "lastModifiedAt": "2026-03-24T10:25:00Z" }
  ]
}
```

### GET /memory/:name

Read a specific shared memory file (returns raw markdown).

**Response 200**: `Content-Type: text/markdown` — raw file content
**Response 404**: `{ "error": "Memory file not found" }`

## Chat

### POST /chat

Send a message to Loom. Response is streamed if the client accepts `text/event-stream`, otherwise returned as JSON.

**Request**:
```json
{
  "message": "How is authentication being implemented?"
}
```

**Response 200 (JSON)**:
```json
{
  "response": "Authentication is being handled in node-2...",
  "action": null
}
```

**Response 200 (action taken)**:
```json
{
  "response": "I've added a documentation node at the end of the graph.",
  "action": {
    "type": "graph_modified",
    "details": { "action": "insert_node", "nodeId": "node-9", "title": "Documentation" }
  }
}
```

### GET /chat/history

Returns full chat history.

**Response 200**:
```json
{
  "messages": [
    { "role": "user", "content": "How is auth implemented?", "timestamp": "2026-03-24T10:30:00Z" },
    { "role": "assistant", "content": "Authentication is...", "timestamp": "2026-03-24T10:30:05Z" }
  ]
}
```

## Configuration

### GET /config

Returns current merged configuration.

**Response 200**:
```json
{
  "defaultDelay": "0",
  "reviewerEnabled": true,
  "models": { "loom": "claude-opus-4-6", "loomi": "claude-sonnet-4-6", "looma": "claude-sonnet-4-6", "loomex": "claude-sonnet-4-6" },
  "budgetLimit": 20,
  "maxRetriesPerNode": 3,
  "dashboardPort": 3000
}
```

### PUT /config

Update configuration. Changes take effect for the next node activation.

**Request**:
```json
{
  "reviewerEnabled": false,
  "budgetLimit": 50
}
```

**Response 200**: Updated config object (same shape as GET /config)
**Response 400**: `{ "error": "Invalid config", "details": [...] }` (zod validation errors)

## Costs

### GET /costs

Cost summary for the workflow.

**Response 200**:
```json
{
  "total": 1.45,
  "budgetLimit": 20,
  "budgetRemaining": 18.55,
  "nodes": [
    { "id": "node-1", "title": "Setup", "cost": 0.32, "retries": 0 },
    { "id": "node-2", "title": "Auth", "cost": 0.18, "retries": 0 }
  ],
  "loomCost": 0.95
}
```

## Events

### GET /events

Query the event log. Supports filtering.

**Query params**: `?type=node_started&nodeId=node-2&limit=50&offset=0`

**Response 200**:
```json
{
  "events": [
    {
      "ts": "2026-03-24T10:15:00Z",
      "type": "node_started",
      "nodeId": "node-2",
      "agentId": null,
      "details": { "title": "Authentication Module" }
    }
  ],
  "total": 142
}
```

## Error Format

All error responses follow:

```json
{
  "error": "Human-readable error message",
  "details": {}
}
```

HTTP status codes: 400 (bad request), 401 (unauthorized), 404 (not found), 409 (conflict), 500 (internal error).
