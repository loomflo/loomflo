# loomflo v0.3.0 Implementation Tracker

**Last updated**: 2026-04-15
**Scope**: S1 finalisation + S2 + S3 + S4 + S5 (everything in the CLI+daemon overview except post-v0.3 items).

## Status at a glance

| Sub-project | Branch | Plan | Status |
|---|---|---|---|
| S1 — Multi-project daemon | `004-multi-project-daemon` | `plans/2026-04-14-s1-multi-project-daemon.md` | Implementation complete; **PR pending** |
| S3 — Visual CLI theme | `006-cli-theme` | `plans/2026-04-15-s3-cli-theme.md` | **Complete** — T1–T9 done, PR pending |
| S2 — Onboarding wizard | `005-onboarding-wizard` | `plans/2026-04-15-s2-onboarding-wizard.md` | **Complete** — T1–T13 done, PR pending |
| S4 — Observation CLI | `007-observation-cli` | `plans/2026-04-15-s4-observation-cli.md` | Not started (depends on S1+S3) |
| S5 — Multi-project dashboard | `008-multiproject-dashboard` | `plans/2026-04-15-s5-multiproject-dashboard.md` | Not started (depends on S1+S3) |

**Recommended execution order**: finish S3 → S2 → S4 → S5 → S1 PR merge → v0.3.0 release PR.
S2 and S4 can run in parallel once S3 lands. S5 is independent of S2/S4 but also needs S3 (Tailwind tokens reuse) + S1 (scoped routes).

## How to use this file

- Check off a task as soon as its plan checklist section is fully green (tests passing, committed).
- Each entry points at the plan file with the full TDD steps — this tracker is not a substitute, it is a dashboard.
- Keep this file up to date in the branch currently being worked on; merge conflicts are trivial (checkboxes only).

---

## S1 — Multi-project daemon (finalisation)

**Plan**: `docs/superpowers/plans/2026-04-14-s1-multi-project-daemon.md` — Final verification section.

- [ ] Run full suite: `pnpm test && pnpm -r lint && pnpm -r typecheck && pnpm build`
- [ ] Manual smoke — two projects in parallel, `daemon stop` clean
- [ ] Self-review against `specs/2026-04-14-s1-multi-project-daemon.md`
- [ ] `gh pr create` — title `S1: multi-project daemon + auto-start (v0.2.0)`

---

## S3 — Visual CLI theme

**Plan**: `docs/superpowers/plans/2026-04-15-s3-cli-theme.md`
**Branch**: `006-cli-theme`

- [x] T1 — Add dependencies (chalk + ora + cli-table3)
- [x] T2 — Palette tokens module (`packages/cli/src/theme/palette.ts`)
- [x] T3 — Theme module (`theme.ts` + `index.ts` semantic API)
- [x] T4 — Output helpers (`output.ts` — `withJsonSupport` / `writeJson` / `writeError`)
- [x] T5 — Theme preview script (`scripts/theme-preview.ts`)
- [x] T6 — Migrate `init`, `start`, `status`, `resume` to `theme.*`
- [x] T7 — Migrate `stop`, `chat`, `logs`, `daemon`, `project`, `config`, `dashboard`
- [x] T8 — Migrate `client.ts` errors + ESLint `no-console` rule on `src/commands/**`
- [x] T9 — Full verification + README + CHANGELOG + PR

---

## S2 — Onboarding wizard + provider profiles

**Plan**: `docs/superpowers/plans/2026-04-15-s2-onboarding-wizard.md`
**Branch**: `005-onboarding-wizard`
**Blocked by**: S3 merged.

- [x] T1 — Add `@inquirer/prompts` dependency
- [x] T2 — Wizard types + zod `WizardFlagsSchema`
- [x] T3 — Presets (level → config defaults)
- [x] T4 — Provider validators (anthropic-oauth / apiKey / openai-compat)
- [x] T5 — Prompt backend abstraction + inquirer impl + fake-for-tests
- [x] T6 — Summary renderer (heading + kv + advanced section)
- [x] T7 — Wizard orchestrator (`runWizard()`)
- [x] T8 — Refactor `init.ts` to call `runWizard()` + write `project.json` + `config.json`
- [x] T9 — `start` delegates to `init` when `project.json` is missing
- [x] T10 — Non-interactive flag (implicit on `!isTTY` / `CI=true`, fast-fail with actionable error)
- [x] T11 — Re-run semantics (one-line recap + `[Y/n]` on configured projects)
- [x] T12 — Wizard integration test (real FS, real `ProviderProfiles`)
- [x] T13 — Full verification + README + CHANGELOG + PR

---

## S4 — Observation CLI

**Plan**: `docs/superpowers/plans/2026-04-15-s4-observation-cli.md`
**Branch**: `007-observation-cli`
**Blocked by**: S1 merged + S3 merged.

- [ ] T1 — `observation/api.ts` + `observation/ws.ts` (cross-project fetch + subscribe helper)
- [ ] T2 — `loomflo ps` — cross-project runtime table
- [ ] T3 — `loomflo nodes [--project <id>] [--all]`
- [ ] T4 — `loomflo inspect <nodeId>` — detail view
- [ ] T5 — `loomflo tree [--project <id>]` — ASCII DAG
- [ ] T6 — `loomflo watch [projectId]` — live refresh via WS
- [ ] T7 — `loomflo logs -f` — unblock WS subscribe
- [ ] T8 — Extend E2E smoke (`LOOMFLO_E2E=1`) with `ps` / `nodes` / `tree`
- [ ] T9 — Full verification + README + CHANGELOG + PR

---

## S5 — Multi-project dashboard + injection fix

**Plan**: `docs/superpowers/plans/2026-04-15-s5-multiproject-dashboard.md`
**Branch**: `008-multiproject-dashboard`
**Blocked by**: S1 merged + S3 merged.

- [ ] T1 — Tailwind palette CSS variables (`@theme` block)
- [ ] T2 — Token parsing (URL fragment → sessionStorage; strip `#token=` from URL)
- [ ] T3 — `lib/api.ts` rewrite — scoped `/projects/:id/*`; surface 410 as `DashboardOutdatedError`
- [ ] T4 — `ProjectContext` — `{ token, projectId, allProjects, client }` + missing-token gate
- [ ] T5 — `useWebSocket` — subscribe protocol `{ all | projectIds }`
- [ ] T6 — Route tree — `/` landing + `/projects/:projectId/*` guarded children + `NotFound`
- [ ] T7 — Landing page — project cards + solo auto-redirect + empty state
- [ ] T8 — `TopBar` + `ProjectSwitcher` + `Layout`
- [ ] T9 — Migrate hooks + pages to consume `projectId` from `useParams`
- [ ] T10 — `loomflo dashboard` passes daemon token via URL fragment `#token=…`
- [ ] T11 — Routing integration test (`/`, `/projects/:id`, unknown id → redirect)
- [ ] T12 — Extend E2E smoke with dashboard SPA + scoped workflow route
- [ ] T13 — Full verification + README + CHANGELOG + PR

---

## v0.3.0 release checklist

After all four sub-project PRs land on `main`:

- [ ] Version bump across workspace (`0.2.0` → `0.3.0`) in `package.json`, `packages/*/package.json`, and any `VERSION` constant
- [ ] Consolidated CHANGELOG entry `## 0.3.0 — 2026-??-??`
- [ ] Release PR from `main` with a summary of the four merged PRs
- [ ] Tag `v0.3.0`
- [ ] Known regression: none — the dashboard bug introduced by S1 is fixed by S5 as part of this same release

---

## Cross-cutting reminders

- **Branches are numbered in overview**: 004 (S1), 005 (S2), 006 (S3), 007 (S4), 008 (S5). Do not merge them as one; each sub-project ships its own PR.
- **Dependencies are documented in each plan's header** — do not start a plan whose dependencies are still open.
- **Tests are TDD by design in every task**: write failing test → run to confirm failure → implement → run to confirm pass → commit. Deviating breaks the plan's structure.
- **Commit scope** follows the existing repo pattern: `feat(cli): … (T<n>)`, `refactor(dashboard): … (T<n>)`, `test(cli): … (T<n>)`, `docs(…): … (T<n>)`.
- **`docs/superpowers/` is now tracked** (see commit `321ed960` for the `.gitignore` fix that unblocks `docs/superpowers/specs/`).
