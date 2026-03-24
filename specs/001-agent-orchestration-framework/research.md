# Research: Loomflo — AI Agent Orchestration Framework

**Date**: 2026-03-24
**Status**: Complete — all decisions resolved

## Technology Decisions

### 1. HTTP Framework: Fastify 5.x

**Decision**: Fastify 5.x with @fastify/websocket
**Rationale**: Fastest Node.js HTTP framework with native TypeScript support. Built-in JSON schema validation aligns with our zod approach. @fastify/websocket provides WebSocket support on the same server instance — no need for a separate ws server.
**Alternatives considered**:
- Express: Slower, weaker TypeScript support, no built-in validation
- Hono: Newer, less ecosystem maturity for WebSocket + file serving
- Koa: Smaller ecosystem, no built-in WebSocket

### 2. CLI Framework: commander

**Decision**: commander
**Rationale**: Most widely used Node.js CLI framework. Simple API for subcommands (loomflo start, loomflo init, etc.). TypeScript support via @types/commander. The CLI is a thin client — complex CLI framework features (interactive prompts, wizards) are unnecessary.
**Alternatives considered**:
- oclif: Overly complex for a thin client that delegates to a daemon API
- yargs: Comparable, but commander has cleaner subcommand syntax
- citty/unbuild: Less mature

### 3. Build Tool (core/cli/sdk): tsup

**Decision**: tsup for core, cli, and sdk packages
**Rationale**: Zero-config TypeScript bundler built on esbuild. Produces ESM output, handles declaration files, fast build times. Ideal for library/CLI packages.
**Alternatives considered**:
- tsc only: Slower, no bundling (multiple output files)
- esbuild directly: Requires manual dts generation
- Rollup: More configuration overhead for simple packages

### 4. Dashboard Build: Vite 6.x + React 19

**Decision**: Vite 6.x + React 19 + TailwindCSS 4.x
**Rationale**: Vite is the standard React build tool. React 19's concurrent features align with our real-time dashboard needs. TailwindCSS 4.x provides utility-first CSS with zero runtime overhead.
**Alternatives considered**:
- Next.js: SSR unnecessary for a localhost-only dashboard
- Svelte: Smaller ecosystem for graph visualization libraries
- Vue: React Flow (@xyflow/react) is React-specific

### 5. Graph Visualization: @xyflow/react (React Flow v12)

**Decision**: @xyflow/react v12
**Rationale**: The de facto React library for interactive node-based graphs. Supports custom node components (for our NodeCard with status badges, agent counts, costs), edge styling, automatic layout, and programmatic updates. MIT licensed.
**Alternatives considered**:
- D3.js: Lower-level, would require building node/edge interaction from scratch
- vis-network: Less React-native, fewer customization options
- Cytoscape.js: More academic graph analysis than interactive UI

### 6. Runtime Validation: zod

**Decision**: zod for all runtime validation
**Rationale**: TypeScript-first schema validation with automatic type inference. Used for: configuration schemas (3-level config), API request/response validation, tool input schemas, event type schemas. Eliminates the gap between runtime validation and TypeScript types.
**Alternatives considered**:
- io-ts: More verbose, functional programming style
- ajv + JSON Schema: No TypeScript type inference
- valibot: Newer, less ecosystem adoption

### 7. Glob Matching for File Scopes: picomatch

**Decision**: picomatch for file ownership scope matching
**Rationale**: Fast, lightweight glob matching used by many Node.js tools. Supports the glob patterns we need for file scopes (e.g., "src/auth/**", "tests/**/*.test.ts"). No external dependencies.
**Alternatives considered**:
- micromatch: Superset of picomatch with extra features we don't need
- minimatch: Slower, heavier
- globby: For file system globbing, not pattern matching

### 8. Async Mutex for Shared Memory: async-mutex

**Decision**: async-mutex package for serializing shared memory writes
**Rationale**: Simple, well-tested async mutex implementation for Node.js. Ensures that concurrent write_memory tool calls from multiple agents are serialized. Single dependency, no native bindings.
**Alternatives considered**:
- Custom implementation: Unnecessary complexity for a well-solved problem
- File locking (flock): OS-dependent, harder to test
- Queue-based: async-mutex is effectively a queue with simpler API

### 9. Markdown Rendering (Dashboard): react-markdown

**Decision**: react-markdown for spec/memory file rendering in dashboard
**Rationale**: Standard React markdown renderer with safe HTML output by default. Supports remark/rehype plugins for syntax highlighting (rehype-highlight), tables, and task lists. Used for rendering spec artifacts and shared memory files.
**Alternatives considered**:
- marked + raw HTML injection: XSS risk with untrusted markdown content
- MDX: Overkill for read-only rendering

### 10. Process Management for `loomflo start`

**Decision**: The CLI `start` command spawns the daemon as a detached child process (child_process.spawn with detached: true, stdio: 'ignore'). Connection info (port, auth token) is written to ~/.loomflo/daemon.json. All subsequent CLI commands read this file to connect.
**Rationale**: Simple, portable, no external process manager dependency. The daemon is a standard Node.js process that can be monitored via its health endpoint.
**Alternatives considered**:
- pm2: External dependency, overkill for a single-process daemon
- systemd: Linux-only, complex setup
- In-process (no daemon): Would block the terminal, breaking the CLI thin-client model

## Architecture Decisions

### Agent Loop Design

**Decision**: Single-threaded async agents running in the Node.js event loop, not separate processes or worker threads.
**Rationale**: LLM API calls are I/O-bound, not CPU-bound. Node.js's event loop handles concurrent I/O efficiently. Promise.all for parallel Loomas within a node. No IPC overhead, shared memory is in-process.
**Risk**: A CPU-intensive tool (e.g., large file search) could block the event loop. Mitigation: use async file operations and limit search scope.

### State Persistence Strategy

**Decision**: Write workflow.json after every state change. Append to events.jsonl for every event. Both are filesystem operations.
**Rationale**: Ensures resume correctness — workflow.json is always the latest snapshot. events.jsonl provides an audit trail and can be used to verify workflow.json consistency on restart.
**Risk**: Frequent filesystem writes for large workflows. Mitigation: workflow.json writes are debounced (coalesce rapid state changes within a 100ms window).

### Dashboard Serving

**Decision**: The daemon (Fastify) serves the built dashboard as static files in production. In development, Vite dev server proxies API calls to the daemon.
**Rationale**: Single process serves both API and dashboard. No separate dashboard server to manage. `loomflo dashboard` command opens the browser pointing at the daemon's port.
**Alternative rejected**: Separate dashboard server — adds operational complexity for no benefit in a localhost-only tool.
