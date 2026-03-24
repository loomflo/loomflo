# Pre-Implementation Checklist: Loomflo — AI Agent Orchestration Framework

**Purpose**: Full-coverage requirements quality review before implementation — catch gaps across all domains
**Created**: 2026-03-24
**Feature**: [spec.md](../spec.md)
**Depth**: Standard | **Audience**: Author (self-review) | **Coverage**: All domains

## Requirement Completeness

- [ ] CHK001 Are requirements defined for how Loomi decides the number and roles of Loomas to spawn for a node? The spec says Loomi "plans its team" but no criteria or heuristics are specified. [Gap, Spec §US2]
- [ ] CHK002 Is the maximum number of concurrent agents per node specified? The spec allows "N per node" for Loomas but defines no upper bound. [Gap, Spec §FR-046]
- [ ] CHK003 Are requirements defined for what the dashboard displays when no workflow exists? The spec covers active workflow states but not the idle/empty state. [Gap, Spec §FR-028]
- [ ] CHK004 Is the CLI output format specified for each command? The spec defines commands but not whether output is human-readable, JSON, or both. [Gap, Spec §US5/US7]
- [ ] CHK005 Are requirements defined for CLI behavior when the daemon is not running? Each command (chat, status, init, resume) needs a defined error path. [Gap]
- [ ] CHK006 Is a cost estimation requirement documented as a formal FR? The spec mentions estimated cost in workflow.json (US1) but no FR mandates pre-execution cost estimation. [Gap, Spec §US1 AS3]
- [ ] CHK007 Are requirements defined for what happens when the global config file (~/.loomflo/config.json) does not exist? The spec defines 3-level config but not the missing-file fallback. [Gap, Spec §FR-031]
- [ ] CHK008 Are requirements specified for events.jsonl growth management? The event log is append-only with no documented rotation, archival, or cleanup strategy. [Gap, Spec §FR-045a]

## Requirement Clarity

- [ ] CHK009 Is "adaptive" retry strategy defined with specific criteria for how the prompt changes on retry? The spec says "adapted prompts incorporating feedback" but does not define the adaptation mechanism. [Clarity, Spec §FR-017/FR-020]
- [ ] CHK010 Is "reasonable time" quantified for spec generation in US1 AS1? SC-001 says "single interactive session" but no time bound is given. [Clarity, Spec §US1 AS1]
- [ ] CHK011 Is the mechanism for mid-execution config changes clearly defined? FR-034 says changes "take effect for the next node" but does not specify whether config is polled, event-driven, or re-read at node activation. [Clarity, Spec §FR-034]
- [ ] CHK012 Is the "review" node status (visible in data model state machine) documented in the spec's node status list? The spec defines 6 statuses (pending, waiting, running, done, failed, blocked) but the data model adds a 7th ("review"). [Clarity, Spec §Clarifications vs data-model.md]
- [ ] CHK013 Are the criteria for Loom's routing decision (answer a question vs. take action vs. modify graph) specified? FR-025 says Loom "routes to appropriate action" but no decision criteria are defined. [Clarity, Spec §FR-025]

## Requirement Consistency

- [ ] CHK014 Is the agent taxonomy consistent between the constitution and the spec? The constitution lists "Loomas" (workers) and "Loomex" (lightweight/utility) with Haiku, but the spec defines "Loomex" as the Reviewer agent using Sonnet. [Conflict, Constitution §Tech Constraints vs Spec §Key Entities]
- [ ] CHK015 Is the Workflow status "failed" reachable in the state machine? The data model shows a transition from "done" to "failed" which contradicts "done" being a terminal success state. [Conflict, data-model.md §Workflow]
- [ ] CHK016 Are the shared memory file names consistent between the spec and the data model? The spec lists 7 files (DECISIONS, ERRORS, PROGRESS, PREFERENCES, ISSUES, INSIGHTS, ARCHITECTURE_CHANGES) — are these the same set referenced in the data model? [Consistency, Spec §Key Entities vs data-model.md]

## Scenario Coverage

- [ ] CHK017 Are requirements defined for Loom's post-completion behavior when the user says "start a new project"? FR-004b says Loom awaits instructions including "start a new project" but FR-004 says only one workflow per daemon. Is the old workflow discarded? [Gap, Spec §FR-004/FR-004b]
- [ ] CHK018 Are requirements defined for how the user confirms execution after reviewing the spec? The spec says the user "confirms" but no specific mechanism is documented (CLI command, dashboard button, chat message). [Gap, Spec §US1 AS5]
- [ ] CHK019 Are requirements defined for partial node re-execution? FR-004b mentions "rerun node 3" as a post-completion instruction — but no FR covers selective node re-execution. [Gap, Spec §FR-004b]
- [ ] CHK020 Is the Phase 1 → Phase 2 transition flow fully specified? The spec describes spec generation (Phase 1) and execution (Phase 2) but the transition — how the user confirms and the system switches — has no dedicated requirement. [Gap, Spec §US1 AS5]

## Edge Case & Failure Coverage

- [ ] CHK021 Are requirements defined for corrupted workflow.json detection on resume? The plan mentions "verify against events.jsonl" but no spec requirement covers this validation. [Gap, Spec §FR-003]
- [ ] CHK022 Is the behavior defined when disk space runs out during state persistence (workflow.json or events.jsonl write)? [Gap]
- [ ] CHK023 Are requirements defined for what happens when a Loomi assigns overlapping write scopes to two Loomas? FR-012 says scopes "MUST NOT overlap" but no requirement covers detection or prevention at assignment time. [Gap, Spec §FR-012]
- [ ] CHK024 Is the behavior defined when the LLM returns malformed output (invalid JSON for tool_use, empty response, unexpected format)? The spec covers tool errors and agent timeouts but not LLM response parsing failures. [Gap, Spec §FR-020a]
- [ ] CHK025 Are requirements defined for symlink handling in the shell sandbox? FR-042 covers path traversal but not symlink-based escapes (e.g., symlink pointing outside workspace). [Gap, Spec §FR-042]

## Non-Functional Requirements

- [ ] CHK026 Are model pricing tables specified as hardcoded or configurable? SC-008 requires 5% cost accuracy but doesn't specify how pricing data is maintained when providers change rates. [Gap, Spec §SC-008]
- [ ] CHK027 Are rate limits specified for the REST API itself (not just LLM calls)? The constitution mandates per-agent LLM rate limiting, but the daemon's REST API has no documented rate limiting. [Gap, Spec §FR-044]
- [ ] CHK028 Are observability requirements defined beyond the event log? The spec covers events.jsonl and shared memory but does not specify structured logging, error reporting, or health metrics for the daemon process itself. [Gap]
- [ ] CHK029 Is the dashboard explicitly defined as desktop-only or responsive? No requirement addresses mobile/tablet viewport behavior. [Gap, Spec §FR-027]
- [ ] CHK030 Are requirements defined for API versioning? The REST API contract has no version prefix (e.g., /v1/) and no requirement covers backward compatibility. [Gap, contracts/rest-api.md]

## Dependencies & Assumptions

- [ ] CHK031 Is the assumption "agents are ephemeral (destroyed per node)" validated against the post-completion behavior? FR-004b keeps Loom alive after completion for further instructions, but the Assumptions section says "agents are created and destroyed per node." [Assumption, Spec §Assumptions vs FR-004b]
- [ ] CHK032 Is the dependency on the Anthropic API's tool_use format documented as a constraint? The plan depends on tool_use support but no requirement covers what happens if the API format changes. [Dependency]

## Notes

- Items marked [Gap] indicate missing requirements that should be addressed in the spec before implementation.
- Items marked [Conflict] indicate contradictions between artifacts that must be resolved.
- Items marked [Clarity] indicate requirements that exist but need sharpening.
- Priority for resolution: Conflicts (CHK014, CHK015) > Gaps in core domain (CHK001, CHK017-CHK020, CHK023) > Clarity items > Nice-to-have gaps.
