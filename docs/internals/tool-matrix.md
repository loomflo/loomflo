# Tool Ecosystem & Agent Matrix

## What
11 tools with Zod-validated input, write-scope enforcement, and strict per-agent access control. Tools never throw — all errors return as strings.

## Why
Giving every agent every tool is dangerous (a reviewer shouldn't write code) and wasteful (tool definitions inflate the prompt). Each role gets exactly the tools it needs.

## How

### Tool Inventory
| Tool | Description |
|------|-------------|
| `read_file` | Read file content |
| `write_file` | Create or overwrite a file |
| `edit_file` | Line-range replacement in existing file |
| `list_files` | Directory listing with glob support |
| `search_files` | Grep-like regex search across files |
| `exec_command` | Run shell command (sandboxed to workspace) |
| `read_memory` | Read a shared memory file |
| `write_memory` | Append to a shared memory file |
| `send_message` | Send message via MessageBus |
| `report_complete` | Signal task completion (ends agent loop) |
| `escalate` | Request escalation to Loom |

### Agent × Tool Matrix
| Tool | Loom | Loomi | Looma | Loomex |
|------|:----:|:-----:|:-----:|:------:|
| read_file | x | x | x | x |
| write_file | | | x | |
| edit_file | | | x | |
| list_files | x | x | x | x |
| search_files | x | x | x | x |
| exec_command | | | x | |
| read_memory | x | x | x | x |
| write_memory | x | x | x | |
| send_message | x | x | x | |
| report_complete | | | x | |
| escalate | | x | | |

### Write Scope Enforcement
`write_file` and `edit_file` check the calling agent's glob patterns via `picomatch` before allowing the operation. Scope is assigned by Loomi at team planning time.

### Tool Contract
- `inputSchema`: Zod schema — validated before execution
- `execute()`: returns `string`, **never throws** — errors are returned as descriptive strings
- Factory pattern for injected tools: `send_message`, `report_complete`, `escalate` are constructed with node-specific dependencies

## Files
- `packages/core/src/tools/base.ts` — Tool interface + `toToolDefinition()` helper
- `packages/core/src/tools/file-*.ts` — Filesystem tools (5 files)
- `packages/core/src/tools/shell-exec.ts` — Command execution
- `packages/core/src/tools/memory-*.ts` — Memory tools (2 files)
- `packages/core/src/tools/send-message.ts` — MessageBus send
- `packages/core/src/tools/report-complete.ts` — Completion signal
- `packages/core/src/tools/escalate.ts` — Escalation request

## Gotchas
- Tool definitions are included in every agent's prompt — 11 tools adds ~2K tokens.
- `exec_command` is sandboxed to the workspace root but doesn't restrict which binaries can run.
- `report_complete` immediately ends the agent loop — any tool calls in the same turn after it are ignored.
