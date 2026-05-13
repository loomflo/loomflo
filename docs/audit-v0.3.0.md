# Audit technique — LoomFlo v0.3.0

**Auditeur** : Revue senior automatisée (5 agents parallèles, 1 synthèse)
**Date** : 2026-04-16
**Branche auditée** : `release/v0.3.0` (HEAD `f987860d`)
**Périmètre** : S1 multi-project daemon, S2 onboarding wizard, S3 CLI theme, S4 observation CLI, S5 multi-project dashboard
**Méthode** : lecture croisée spec ↔ code ↔ tests, par sous-projet, puis consolidation des risques

---

## 1. Verdict global

**Score global v0.3.0 : 7.3 / 10** — *release candidate avec blocages limités*

| Catégorie | Évaluation |
|---|---|
| Conformité fonctionnelle | 80 % des FRs couverts; 3 manques critiques (cf. P0) |
| Qualité du code | Correcte, bien structurée; race conditions sur le registry |
| Couverture de tests | Bonne en surface (208/208 verts) mais trous en concurrence, reconnect WS, width adaptative |
| Sécurité | **Risque principal** : tokens dans query string WS côté CLI + dashboard |
| Robustesse | Shutdown gracieux OK; reconnect WS manquant; TTY width non gérée |

**Recommandation** : merger les correctifs P0 listés en §5 avant de tagger `v0.3.0`. Les P1 peuvent être traités en `v0.3.1` patch release.

---

## 2. Tableau récapitulatif

| Sous-projet | Score | Conformité spec | Risque principal | Statut release |
|---|---|---|---|---|
| **S1** Multi-project daemon | **6.5 / 10** | ~80 % | FR-9 (stub `default` profile) manquant → wizard cassé en cold-start | 🟠 **à corriger** avant tag |
| **S2** Onboarding wizard | **7.2 / 10** | ~70 % | Pas de retry (3 tentatives) sur validator; `env:ephemeral` non résolu | 🟠 **à corriger** (P0 + P1) |
| **S3** CLI theme | **9.0 / 10** | ~95 % | Aucun blocage; qques détails unicode/exit codes | 🟢 **ship** |
| **S4** Observation CLI | **7.0 / 10** | ~75 % | Token dans query string WS; pas de reconnect/backoff | 🟠 **à corriger** (P0 sécu) |
| **S5** Dashboard multi-project | **7.1 / 10** | ~85 % | Token WS en query (même problème); titre « injection fix » trompeur | 🟠 **à corriger** (P0 sécu) |

**Score global pondéré** : moyenne simple = **7.36** ; pondérée par criticité (S1 & sécurité x1.3) = **7.1**.

---

## 3. Détail par sous-projet

### S1 — Multi-project daemon (6.5 / 10)

**Conformité spec**
- ✅ FR-1 Registry `projects.json` (atomic writes, 0600, recovery)
- ✅ FR-2 CRUD `/projects` avec Bearer auth
- ✅ FR-3 Routes scoped `/projects/:id/*` + preValidation hook
- ✅ FR-4 WebSocket multiplexé avec envelope `{ projectId, … }`
- ✅ FR-5 Auto-start via `proper-lockfile` (double-check dans section critique)
- ✅ FR-6 CLI `daemon {start|stop|restart|status}` + `project {list|remove|prune}`
- ⚠️ FR-7 Log « ⚙ Projet existant détecté… » via `console.warn` (sans theme S3)
- ⚠️ FR-8 Graceful shutdown : hooks présents mais non testés sous N projects actifs
- ❌ **FR-9 Profile stub `default`** : absent. `Daemon.start()` ne crée pas `{ profiles: { default: …oauth… } }` quand `credentials.json` est vide → wizard S2 échoue en cold-start
- ❌ **Orphan projects** (spec §313) : aucune détection d'un `projectPath` disparu au reload

**Issues code clés**
| # | Sévérité | Fichier:ligne | Description |
|---|---|---|---|
| 1 | **P0** | `packages/core/src/daemon.ts::start()` | Pas de création du stub profile `default` au démarrage |
| 2 | **P1** | `packages/core/src/persistence/projects.ts:42-48` | Race `upsert()` (read-then-write sans verrou) |
| 3 | **P1** | `packages/core/src/persistence/projects.ts:50-54` | Même race sur `remove()` |
| 4 | **P1** | `packages/cli/src/daemon-control.ts:49-56` | `getRunningDaemon()` ne check pas la mtime du PID file → faux positif possible en cas de PID reuse OS |
| 5 | **P2** | `packages/core/src/api/server.ts:264-275` | Parsing Bearer : pas de validation stricte longueur 64 hex |

**Sécurité**
- ✅ Tokens `randomBytes(32)` hex, fichiers 0600, pas de path traversal (regex `/^proj_[0-9a-f]{8}$/`)
- ⚠️ Pas de rotation / révocation des tokens (post-v1 selon spec)
- ⚠️ WebSocket `{ all: true }` accessible à tout porteur du token (design, mais à documenter)

**Tests manquants**
- Pas de test concurrent `POST /projects` simultanés
- Pas de test de corruption `projects.json` sous charge
- Pas de test de stale daemon PID (reuse OS)
- Pas de test de WebSocket auth bypass
- Le E2E « croit » qu'un profile existe (l'absence de stub est masquée)

---

### S2 — Onboarding wizard (7.2 / 10)

**Conformité spec**
- ✅ Matrix de flags, presets L1/L2/L3/custom, providers (anthropic-oauth, anthropic apiKey, openai, moonshot, nvidia)
- ✅ Non-interactive : détection TTY + `CI=true` → fast-fail
- ✅ Re-run : recap + `[Y/n]` sur projet déjà configuré
- ❌ **Retry borné 3 tentatives** sur validator (spec L112) : `runExistingValidator()` throw à la 1ère erreur, pas de boucle
- ❌ **Re-run avec provider manquant** : pas de check `identity.providerProfileId ∈ profiles` avant de déléguer au daemon → erreur silencieuse remontée depuis le daemon au lieu d'un prompt « choisir un autre profile »
- ⚠️ `env:ephemeral` : retourné comme `providerProfileId` mais jamais résolu en credentials côté core

**Issues code clés**
| # | Sévérité | Fichier:ligne | Description |
|---|---|---|---|
| 1 | **P0** | `packages/cli/src/onboarding/index.ts:133-154` | Pas de retry loop (spec : 3 tentatives) |
| 2 | **P0** | `packages/cli/src/commands/init.ts:173` | `writeFile(project.json)` sans `mode: 0600` alors qu'il contient `providerProfileId` — incohérent avec `credentials.json` |
| 3 | **P1** | `packages/cli/src/commands/init.ts:128-155` | Re-run ne vérifie pas que le profile référencé existe |
| 4 | **P1** | `packages/cli/src/onboarding/index.ts:122-197` | `createNewProfile()` : échec validation = saisie perdue, pas de retry |
| 5 | **P1** | `packages/cli/src/onboarding/index.ts:125` | `env:ephemeral` non résolu downstream |

**Sécurité**
- ⚠️ `validators.ts:34,36,65` : les messages d'erreur concatènent le body HTTP → peut leaker un fragment de clé en cas de 401 verbeux
- ⚠️ `project.json` en 0644 (vs 0600 sur credentials) → incohérence
- ⚠️ Ctrl-C mid-write : pas de cleanup, dossier `.loomflo/` partiel mais next-run reprompte (acceptable)

**Tests manquants**
- Retry validator (impossible à tester — n'existe pas)
- Re-run avec profile manquant
- Scenario SIGINT
- Flow `env:ephemeral` bout-en-bout
- Snapshot sur valeurs presets

---

### S3 — CLI theme (9.0 / 10)

**Conformité spec** — ~95 %
- ✅ API sémantique (`heading`, `kv`, `line`, `table`, `spinner`, `success/warn/err/info`)
- ✅ `--json` via `withJsonSupport()` (39 usages, tous les commands migrés)
- ✅ `NO_COLOR` + `FORCE_COLOR=0` + `!isTTY` respectés (chalk level)
- ✅ ESLint `no-console: error` sur `src/commands/**` — zéro fuite `console.*`
- ✅ Palette Mint 5 tokens (distance euclidienne 32.80 — bonne différenciation deutéranopie)
- ✅ Stdout/stderr discipline propre (erreurs → stderr, JSON → stdout, spinner → stderr)

**Issues code** — que du cosmétique
| # | Sévérité | Fichier:ligne | Description |
|---|---|---|---|
| 1 | P2 | `packages/cli/src/theme/theme.ts:50-54` | `headingFn()` calcule underline sur `text.length` (OK ASCII, KO combining/emoji) |
| 2 | P2 | `packages/cli/src/theme/theme.ts:56-59` | `kvFn()` applique tone uniquement sur la clé (intentionnel mais à documenter) |
| 3 | P2 | tests | Pas d'assertion `process.exitCode === 1` dans les tests de commandes |
| 4 | P2 | `theme.table<T>()` | Pas de type-check strict des accessors (cli-table3 coerce en string) |

**Sécurité**
- ⚠️ Injection ANSI théorique si un nom de projet contient des séquences d'échappement. **En pratique** : les noms viennent du daemon (validé côté API) ou d'inquirer (sanitizé), donc risque résiduel très faible. À documenter.

**Tests** — 208/208 OK, 50 fichiers dont 11 `.theme.test.ts`. Gaps : pas de snapshot multi-couleur, pas d'assertion exit code.

---

### S4 — Observation CLI (7.0 / 10)

**Conformité spec**
- ✅ `ps`, `nodes`, `inspect`, `tree`, `watch`, `logs -f` implémentés
- ✅ `--json` partout, résolution `--project <id>` avec fallback cwd
- ✅ Cycle-guard ajouté dans `tree` (commit `eb708b10`)
- ✅ NaN-safe sur `-n` interval
- ❌ **Terminal width degradation** (spec : drop colonnes si `< 60`) : absent, tables fixe-width
- ❌ **WS reconnect + backoff 30s max** (spec) : absent sur `logs -f` ET `watch` → daemon restart = commande hang

**Issues code clés**
| # | Sévérité | Fichier:ligne | Description |
|---|---|---|---|
| 1 | **P0** | `packages/cli/src/observation/ws.ts:49` | **Token dans query string** `?token=<value>` sans encoding ni usage de l'header Authorization → leak via logs daemon / proxies |
| 2 | **P1** | `packages/cli/src/observation/ws.ts:74-95` | Pas de validation de schema sur les frames WS — `JSON.parse` catch silencieux |
| 3 | **P1** | `ws.ts:47+`, `logs.ts:93-95` | Pas de reconnect WS — daemon restart = hang indéterminé |
| 4 | **P2** | `ps.ts:101-111`, `nodes.ts:132-142`, `watch.ts:57-68` | Pas d'adaptation terminal étroit |
| 5 | **P2** | `api.ts:112-113` | Uptime float non arrondi → flicker visuel en live view |

**Sécurité**
1. **P0** — Token en query string WS (logs daemon, proxies, history). Fix : subprotocol `Sec-WebSocket-Protocol: bearer,<token>` ou header Authorization après upgrade.
2. **P2** — Enumeration cross-project via `ps` / `--all` : assumé gated par le token daemon-side, mais aucun test explicite le vérifie.
3. **P2** — Aucune validation de shape sur la réponse daemon (TypeScript triché à l'I/O).

**Tests manquants** : snapshot width variable, WS reconnect lifecycle, malformed JSON frame, E2E `watch` interactif, validation exit code « project not found ».

---

### S5 — Dashboard multi-project (7.1 / 10)

**Conformité spec**
- ✅ Landing page cards + solo auto-redirect + empty state
- ✅ Route tree `/` + `/projects/:projectId/*` + NotFound
- ✅ `ProjectContext` fournissant `{ projectId, token, allProjects }`
- ✅ Client API scoped `/projects/:id/*`, 410 → `DashboardOutdatedError`
- ✅ Token parsing `#token=` → sessionStorage + `history.replaceState()` clear du hash
- ✅ Tailwind 4 `@theme` avec tokens Mint
- ✅ CLI `dashboard` passe le token via fragment
- ✅ Correctif commit `398eae55` — conditional hooks éliminés, route `/workflow` → `/graph`

**Issues code clés**
| # | Sévérité | Fichier:ligne | Description |
|---|---|---|---|
| 1 | **P0** | `packages/dashboard/src/lib/ws.ts:7` | **Token en query string WS** — même problème que S4 côté navigateur (proxies, DevTools, logs) |
| 2 | **P1** | `Landing.tsx:51`, `TopBar.tsx:19`, `ProjectSwitcher.tsx:40` | Project names rendus en JSX (React escape OK) mais **aucun test XSS de régression** |
| 3 | **P2** | `packages/dashboard/src/lib/token.ts:9-13` | sessionStorage persiste au reload → si device compromis entre sessions, token réutilisable (pas d'expiry côté client) |
| 4 | **P2** | `App.tsx:29` | `ProjectGuard` check uniquement la liste locale `allProjects` — repose intégralement sur l'auth daemon-side pour denied |
| 5 | **INFO** | — | Titre « injection fix » **trompeur** : il n'y avait pas d'injection, il s'agit d'un refactor de routing (legacy 410 → scoped `/projects/:id/*`) |

**Sécurité**
1. **P0** — Token WS en query string (voir S4). Visible dans DevTools Network, potentiellement dans l'historique navigateur et les logs serveur/proxy. `wss://` masque sur le fil mais pas sur les endpoints.
2. **P1** — sessionStorage survie au reload du tab ; pas de logout ; pas d'expiry daemon-side documenté.
3. **P2** — Pas de protection CSRF explicite mais Bearer header bloque de facto les attaques form-based.

**Tests manquants** : synchronicité du clear hash avant 1er render ; multi-tabs même token ; recovery après daemon restart ; XSS snapshot ; subscription replace quand `projectId` change.

---

## 4. Liste consolidée des issues par sévérité

### 🔴 P0 — Bloquants release

| # | Sous-projet | Issue | Fichier |
|---|---|---|---|
| P0-1 | S1 | **Stub profile `default` non créé** au démarrage du daemon quand `credentials.json` vide → wizard S2 échoue en cold-start | `packages/core/src/daemon.ts::start()` |
| P0-2 | S2 | Pas de retry (3 tentatives) sur validator provider — UX dégradée | `packages/cli/src/onboarding/index.ts:133-154` |
| P0-3 | S2 | `project.json` écrit sans `mode: 0600` alors qu'il contient un id de profile | `packages/cli/src/commands/init.ts:173` |
| P0-4 | S4 | **Token Bearer dans query string WebSocket** — leak via logs/proxies | `packages/cli/src/observation/ws.ts:49` |
| P0-5 | S5 | **Idem côté dashboard** — token WS dans query string | `packages/dashboard/src/lib/ws.ts:7` |

### 🟠 P1 — Importants (corrigibles en v0.3.1)

| # | Sous-projet | Issue | Fichier |
|---|---|---|---|
| P1-1 | S1 | Race `ProjectsRegistry.upsert()` (read-then-write sans verrou) | `packages/core/src/persistence/projects.ts:42-48` |
| P1-2 | S1 | Race `ProjectsRegistry.remove()` — même pattern | `packages/core/src/persistence/projects.ts:50-54` |
| P1-3 | S1 | Stale PID reuse non détecté (pas de check mtime du daemon.json) | `packages/cli/src/daemon-control.ts:49-56` |
| P1-4 | S2 | Re-run ne détecte pas un `providerProfileId` orphelin | `packages/cli/src/commands/init.ts:128-155` |
| P1-5 | S2 | `env:ephemeral` retourné mais non résolvable côté core | `packages/cli/src/onboarding/index.ts:125` |
| P1-6 | S2 | Fuites potentielles de clé dans les messages d'erreur validator | `packages/cli/src/onboarding/validators.ts:34,36,65` |
| P1-7 | S4 | Pas de reconnect WS + backoff sur `logs -f` et `watch` | `packages/cli/src/observation/ws.ts` |
| P1-8 | S4 | Pas de validation de schema sur les frames WS | `packages/cli/src/observation/ws.ts:74-95` |
| P1-9 | S5 | Pas de test XSS regression sur project names | `packages/dashboard/test/` |

### 🟡 P2 — Mineurs / nice-to-have

- S1 : validation stricte 64-hex du Bearer token (`api/server.ts:264-275`)
- S1 : détection des projets orphelins (`projectPath` disparu)
- S2 : cleanup `.loomflo/` partiel sur SIGINT
- S2 : snapshots sur valeurs presets
- S3 : heading underline multi-byte / emoji
- S3 : assertions `process.exitCode` dans les tests
- S4 : terminal width adaptative (spec `< 60 cols`)
- S4 : uptime arrondi pour éviter le flicker
- S4 : exit code `project not found` (spec = 3, code = 1)
- S5 : sessionStorage → mémoire-seulement (post v1 : expiry daemon-side)
- Docs : renommer « S5 injection fix » en « S5 route scoping fix » (terme trompeur)

### ⚪ Tests manquants transverses

- Concurrence registry (S1) : POST/DELETE simultanés
- WS auth bypass (S1) : token erroné en query
- Reconnect WS (S4/S5) : daemon restart
- Snapshot width variable (S4)
- XSS regression (S5) : noms avec `<script>`, `onerror=…`
- E2E cold-start sans `credentials.json` (S1 + S2)
- Ctrl-C mid-wizard (S2)

---

## 5. Recommandations avant release

### Obligatoire — à merger dans `release/v0.3.0` avant le tag

1. **Créer le stub profile `default`** dans `Daemon.start()` quand `credentials.json` est absent ou vide. Le wizard S2 en dépend (P0-1).
2. **Corriger `init.ts` pour écrire `project.json` en 0600** (cohérence avec credentials) (P0-3).
3. **Migrer le token WebSocket en subprotocol `Sec-WebSocket-Protocol`** côté daemon, puis mettre à jour CLI (ws.ts:49) et dashboard (ws.ts:7). Ce fix résout P0-4 et P0-5 en une modification coordonnée.
4. **Ajouter retry borné (3 tentatives) sur les validators S2** (P0-2) — quick-win UX.
5. **Ajouter un smoke test cold-start** : daemon démarré sur répertoire vierge → `init` doit réussir. Garde anti-régression pour P0-1.

### Recommandé — patch v0.3.1 (sous 2 semaines)

6. Verrou fichier sur `ProjectsRegistry.{upsert,remove}` via `proper-lockfile` (P1-1, P1-2).
7. Check mtime du daemon.json dans `getRunningDaemon()` (P1-3).
8. Reconnect WS exponentiel (max 30 s) dans `packages/cli/src/observation/ws.ts` — réutilisable côté dashboard (P1-7).
9. Validation zod sur les frames WS reçues (P1-8).
10. Sanitize/mask des bodies de réponse dans `validators.ts` avant log (P1-6).
11. Ajouter snapshot tests XSS dans dashboard (P1-9).
12. Renommer « S5 injection fix » → « S5 route scoping fix » dans CHANGELOG / PR title (le terme « injection » est trompeur).

### Nice-to-have — v0.4

- Rotation/expiry des tokens daemon-side (SAAS-ready)
- Width adaptative des tables (S4)
- Détection orphan projects au reload (S1)
- Retry + persistance partielle de la saisie wizard en cas d'échec validator

---

## 6. Sign-off

**Verdict** : v0.3.0 est **proche du ship** mais pas prête. La release est bloquée par **5 P0** dont 2 sont le même bug sécu WS présent des deux côtés.

Une fois les 5 P0 traités (estimation : 1–2 jours de dev + tests), le score monterait mécaniquement à **~8.0 / 10** et la branche serait tag-compatible.

Les P1 ne sont pas des bloquants mais constituent une dette technique à traiter sur v0.3.1 pour ne pas s'empiler avant v0.4.

---

*Rapport généré par audit multi-agents (5 auditeurs S1–S5 en parallèle + 1 synthèse). Sources : specs `docs/superpowers/specs/`, plans `docs/superpowers/plans/`, code sur HEAD `f987860d`.*
