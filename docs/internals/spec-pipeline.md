# Spec Pipeline (6-Phase Generation)

## What
Deterministic 6-step pipeline that transforms a user prompt into a validated execution graph.

## Why
Jumping from a user idea to code produces inconsistent results. The pipeline forces structured thinking: principles first, then scope, then architecture, then plan, then validation, then task graph.

## How
Each phase runs as a single LLM call through Loom (Architect), with the output of each phase fed as context to the next:

1. **Loomprint (Constitution)** — Non-negotiable principles, delivery standards, tech constraints
2. **Loomscope (Functional Spec)** — Features, user stories, acceptance criteria
3. **Loomcraft (Technical Spec)** — Architecture, APIs, data models, dependencies
4. **Loompath (Plan)** — Phased delivery, milestones, risk mitigation
5. **Loomscan (Coherence Analysis)** — Cross-spec validation, gap/contradiction detection
6. **Loomkit (Graph Building)** — Task breakdown → nodes + edges, topology classification

Output artifacts are stored in `.loomflo/specs/`:
`constitution.md`, `spec.md`, `technical.md`, `plan.md`, `analysis.md`, `graph.json`

The pipeline emits WebSocket events (`spec_step_started`, `spec_step_completed`) for real-time dashboard updates.

If the LLM detects ambiguity, it inserts `[CLARIFICATION_NEEDED]` markers which trigger a user callback to resolve before continuing.

## Files
- `packages/core/src/spec/spec-engine.ts` — Pipeline orchestration
- `packages/core/src/spec/prompts.ts` — All 6 phase prompts

## Gotchas
- Pipeline is strictly linear — phase N cannot start until phase N-1 completes.
- Graph building (phase 6) outputs JSON, not markdown. Parsing failures halt the pipeline.
- The graph includes topology classification: `linear`, `divergent`, `convergent`, `tree`, `mixed`.
