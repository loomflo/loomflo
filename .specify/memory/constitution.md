<!--
Sync Impact Report
===================
Version change: 0.0.0 (template) → 1.0.0
Modified principles: N/A (initial creation from template)
Added sections:
  - Core Principles: I through VI (6 principles)
  - Delivery Standards (Section 2)
  - Technology Constraints & Conventions (Section 3)
  - Governance rules
Removed sections: None (template placeholders replaced)
Templates requiring updates:
  - .specify/templates/plan-template.md: ✅ Compatible (Constitution Check is generic)
  - .specify/templates/spec-template.md: ✅ Compatible (no constitution-specific refs)
  - .specify/templates/tasks-template.md: ✅ Compatible (no constitution-specific refs)
  - .specify/templates/commands/*.md: ✅ No command files exist
  - README.md: ✅ Does not exist yet (will be created during implementation)
Follow-up TODOs: None
-->
# Loomflo Constitution

## Core Principles

### I. Type Safety & Code Quality (NON-NEGOTIABLE)

- TypeScript strict mode MUST be enabled (`strict: true` in tsconfig.json)
  across all packages.
- All functions MUST have explicit return types and parameter types.
  No implicit `any`.
- ESLint and Prettier MUST be enforced on every file. Zero warnings
  policy: the CI build MUST fail on any ESLint warning or Prettier diff.
- Zero `TODO` comments and zero hardcoded mock data in main (non-test)
  code. TODOs are tracked in issues, not in source.
- All public functions, classes, and interfaces MUST have JSDoc
  documentation describing purpose, parameters, and return values.
- Vitest is the test framework. Minimum 60% code coverage enforced in CI.
- Error handling MUST be graceful everywhere: an agent failure MUST NOT
  crash the workflow; a node failure MUST trigger retry or escalation —
  never an unhandled exception.

### II. Async-First Architecture

- All I/O operations (LLM calls, file operations, HTTP requests,
  scheduling) MUST use `async`/`await` with non-blocking I/O.
  Synchronous blocking calls are prohibited in hot paths.
- The project is a monorepo managed by pnpm workspaces and Turborepo,
  containing four packages:
  - `packages/core` — engine, agents, tools, scheduler, memory, providers
  - `packages/cli` — command-line interface
  - `packages/dashboard` — web-based monitoring UI
  - `packages/sdk` — public SDK for external integrations
- The daemon holds workflow state in memory, persists to JSON/JSONL on
  disk, and serves clients via its API. No external database is required
  or permitted for core functionality.
- Graph topology is data-driven: nodes and edges are described in
  `workflow.json`, never hardcoded. The engine MUST support linear,
  divergent, convergent, tree, and mixed topologies from the same
  execution logic.

### III. Decoupled, Testable Components

- Every component (agents, tools, scheduler, memory, providers) MUST be
  independently testable. All inter-component boundaries are defined by
  TypeScript interfaces, not concrete implementations.
- Tools are isolated: a tool failure MUST return a structured error
  string to the agent. A tool MUST NEVER throw an exception into the
  agent loop.
- Agent communication within a node is exclusively via the in-process
  `MessageBus`. No direct object references between agents are permitted.
- Shared memory files (`.md`) are the source of truth for cross-node
  state. All writes go through the daemon, which serializes access — no
  concurrent writes, no race conditions.

### IV. Provider Abstraction (NON-NEGOTIABLE)

- `LLMProvider` is an abstract TypeScript interface with a single core
  method: `complete(messages, system, tools, config) → LLMResponse`.
- The codebase MUST NEVER import a specific provider SDK (e.g.,
  `@anthropic-ai/sdk`, `openai`) outside of the provider implementation
  files in the providers directory. All agent code calls the abstract
  interface.
- System prompt format and tool definitions are provider-normalized:
  each provider implementation translates to/from its API's specific
  format.
- Anthropic Claude is the default and best-supported provider:
  `claude-sonnet-4-6` for Loomas, `claude-opus-4-6` for Loom.
- Per-agent model configuration is supported: different agents within a
  workflow MAY use different models and providers.
- Swapping a provider MUST require only a configuration change — zero
  code modifications.
- Built-in providers for v1: Anthropic. Planned: OpenAI, Ollama (local).

### V. Agent Isolation & Communication

- Each agent operates within a defined scope. Agent-to-agent
  communication within a node MUST go through the `MessageBus`.
- Cross-node state sharing MUST use shared memory files managed by the
  daemon.
- The daemon serializes all shared memory writes to prevent race
  conditions.
- Agent file writes are enforced by the daemon: each agent has an
  assigned write scope (glob patterns). Write attempts outside the scope
  MUST be rejected before reaching the filesystem.
- Rate limiting on LLM API calls: configurable max calls per minute per
  agent to prevent infinite loops or runaway costs.
- Budget hard limit: if configured, the daemon MUST pause the workflow
  when the cost threshold is reached.

### VI. Security by Default (NON-NEGOTIABLE)

- **Workspace isolation**: Each project runs in its own directory under
  the daemon's workspace root. Agents MUST NOT access files outside
  their project workspace.
- **Shell sandbox**: The shell exec tool is sandboxed to the project
  workspace. Path traversal attempts MUST be detected and rejected.
- **Secret management**: LLM API keys are loaded from environment
  variables only (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.). Keys
  MUST NEVER be hardcoded, logged, or written to any file.
- **Network binding**: The daemon MUST listen on `127.0.0.1` only. API
  access is protected by an auto-generated token created at daemon
  start, stored in `~/.loomflo/daemon.json`.
- **Write scope enforcement**: Each agent's write permissions are defined
  as glob patterns. The daemon MUST reject writes outside the agent's
  scope before any filesystem operation occurs.

## Delivery Standards

- `pnpm install && pnpm build` MUST work from a clean clone with zero
  manual steps.
- GitHub Actions CI runs ESLint + TypeScript type-check + Vitest on
  every push.
- README MUST include an architecture diagram, a quick-start guide
  (3 commands max), and a real end-to-end usage example.
- Every build phase MUST end with a clean, passing git commit.
- Docker is optional (not required for basic usage), but a
  `docker-compose.yml` MUST be provided for convenience.
- The CLI is distributed via npm: `npm install -g loomflo`.

## Technology Constraints & Conventions

- **Runtime**: Node.js (LTS). TypeScript compiled to ESM.
- **Package manager**: pnpm with workspaces. Turborepo for build
  orchestration.
- **Test framework**: Vitest. Minimum 60% coverage enforced in CI.
- **Linting**: ESLint with strict TypeScript rules. Prettier for
  formatting. Both enforced in CI with zero-tolerance policy.
- **State persistence**: JSON/JSONL files on disk. No external database
  for core functionality.
- **Workspace structure**: Monorepo with `packages/core`, `packages/cli`,
  `packages/dashboard`, `packages/sdk`.
- **Agent taxonomy**:
  - **Loom**: Architect agent (uses `claude-opus-4-6` by default)
  - **Loomi**: Orchestrator agent (uses `claude-sonnet-4-6` by default)
  - **Looma**: Worker agent (uses `claude-sonnet-4-6` by default)
  - **Loomex**: Reviewer agent (uses `claude-sonnet-4-6` by default)

## Governance

- This constitution is the highest-authority document for the Loomflo
  project. All code, PRs, and architectural decisions MUST comply with
  its principles.
- Amendments require: (1) a written proposal documenting the change and
  rationale, (2) review and approval, (3) a migration plan for any
  existing code that violates the new principle.
- The constitution follows semantic versioning:
  - **MAJOR**: Backward-incompatible principle removals or redefinitions.
  - **MINOR**: New principle or section added, or materially expanded
    guidance.
  - **PATCH**: Clarifications, wording fixes, non-semantic refinements.
- All PRs MUST be verified for constitution compliance before merge.
- Complexity beyond what the constitution permits MUST be justified in
  writing with a rationale for why the simpler alternative is
  insufficient.

**Version**: 1.0.1 | **Ratified**: 2026-03-24 | **Last Amended**: 2026-03-24
