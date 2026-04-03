# Tasks - LoomFlo Bug Fixes

**Référence plan :** [PLAN.md](./PLAN.md)
**User stories :** [USER-STORY.md](./USER-STORY.md)
**Repo :** `/home/borled/projects/loomflo`

---

## BUG-3 : `loomflo config get` - defaults manquants

### T3-1 - Appliquer les defaults Zod dans `config get` et `config` (affichage) [DONE 2026-04-03]
**Fichier :** `packages/cli/src/commands/config.ts`
**Changement :** Après `deepMerge(global, project)`, appliquer `ConfigSchema.parse(merged)` pour obtenir les valeurs par défaut. Gérer l'erreur ZodError avec un message lisible.
**Complexité :** XS (2-3 lignes)

### T3-2 - Appliquer les defaults dans `config set` (cohérence) [DONE 2026-04-03]
**Fichier :** `packages/cli/src/commands/config.ts`
**Changement :** Dans la branche `set`, après lecture du fichier existant, ne pas parser avec Zod (on écrit une valeur partielle) - mais valider que la clé existe dans le schema avant d'écrire.
**Complexité :** S

### T3-3 - Tests unitaires `config get` avec config vide [DONE 2026-04-03]
**Fichier :** `packages/cli/tests/unit/config.test.ts`
**Changement :** Test : `config get provider` sur config vide → `"anthropic"`. Test : `config get models.loom` → `"claude-opus-4-6"`. Test : `config get models` → objet complet.
**Complexité :** S

---

## BUG-1 : `loomflo logs` - 404 systématique

### T1-1 - Câbler `queryEvents` dans `daemon.ts` [DONE 2026-04-03]
**Fichier :** `packages/core/src/daemon.ts`
**Changement :** Remplacer `getEventLog: () => ({ query: async () => [] })` par une implémentation qui appelle `queryEvents(projectPath, filters)` depuis `persistence/events.ts`. Vérifier les imports.
**Complexité :** S

### T1-2 - Enregistrer les routes `/events` dans `createServer()` [DONE 2026-04-03]
**Fichier :** `packages/core/src/daemon.ts`
**Changement :** Passer `events: { getProjectPath: () => projectPath }` dans les options de `createServer()`. Vérifier que le plugin `eventsRoutes` s'enregistre bien sur `/events`.
**Complexité :** XS

### T1-3 - Vérifier `queryEvents` avec `projectPath` dynamique [DONE 2026-04-03]
**Fichier :** `packages/core/src/persistence/events.ts`
**Changement :** S'assurer que `queryEvents(projectPath, filters)` lit `<projectPath>/.loomflo/events.jsonl`. Pas de changement si déjà correct - juste vérification + ajout test.
**Complexité :** XS

### T1-4 - Test d'intégration : `loomflo logs` retourne des events [DONE 2026-04-03]
**Fichiers :** tests existants ou nouveaux dans `packages/core/tests/integration/events-routes.test.ts`
**Changement :** Test : démarrer le serveur avec un `events.jsonl` pré-rempli → `GET /events` retourne les événements. Test : `GET /events?type=node_started` filtre correctement.
**Complexité :** M

---

## BUG-2 : Délai entre nodes non configurable

### T2-1 - Propager `defaultDelay` dans `spec-engine.ts` [DONE 2026-04-03]
**Fichier :** `packages/core/src/spec/spec-engine.ts`
**Changement :** La méthode `runPipeline()` reçoit déjà la `config`. Modifier `buildGraph()` (phase graph) pour passer `config.defaultDelay` à `createNodeFromDefinition()`. Dans cette fonction, appliquer `delay: index > 0 ? config.defaultDelay : "0"` (le premier node n'a pas de délai).
**Complexité :** S

### T2-2 - Ajouter flag `--delay <duration>` à `loomflo init` [DONE 2026-04-03]
**Fichier :** `packages/cli/src/commands/init.ts`
**Changement :** Ajouter `.option('--delay <duration>', 'Delay before each node activation (e.g. 10m, 1h)')`. Passer cette valeur dans le payload POST `/workflow/init` envoyé au daemon via config.defaultDelay.
**Complexité :** S

### T2-3 — Gérer `delay` dans le endpoint `/workflow/init` du daemon [DONE 2026-04-03]
**Fichier :** `packages/core/src/api/routes/workflow.ts` + `packages/core/src/agents/loom.ts`  
**Changement :** Propager `workflow.config.defaultDelay` → LoomAgent → SpecEngine via LoomConfig.defaultDelay et SpecEngineConfig.defaultDelay.  
**Complexité :** S

### T2-4 - Tests unitaires `createNodeFromDefinition` avec delay [DONE 2026-04-03]
**Fichiers :** tests spec-engine existants
**Changement :** Test : avec `defaultDelay: "10m"` → node-1 a `delay: "0"`, node-2+ ont `delay: "10m"`. Test : avec `defaultDelay: "0"` → comportement inchangé.
**Complexité :** S

### T2-5 - Build, lint, typecheck global + mise à jour DIAGNOSTIC-REPORT [DONE 2026-04-03]
**Commandes :** `cd /home/borled/projects/loomflo && pnpm build && pnpm lint && pnpm typecheck`
**Changement :** S'assurer que le build est propre sur tous les packages. Mettre à jour `DIAGNOSTIC-REPORT.md` et `MEMORY.md` avec les bugs résolus.
**Complexité :** XS

---

## Résumé

| Task | Bug | Complexité | Priorité | Statut |
|------|-----|-----------|----------|--------|
| T3-1 | Bug-3 config defaults | XS | 1 | DONE 2026-04-03 |
| T3-2 | Bug-3 config set validation | S | 2 | DONE 2026-04-03 |
| T3-3 | Bug-3 tests | S | 3 | DONE 2026-04-03 |
| T1-1 | Bug-1 queryEvents câblage | S | 4 | DONE 2026-04-03 |
| T1-2 | Bug-1 routes events | XS | 5 | DONE 2026-04-03 |
| T1-3 | Bug-1 queryEvents vérif | XS | 6 | DONE 2026-04-03 |
| T1-4 | Bug-1 test intégration | M | 7 | DONE 2026-04-03 |
| T2-1 | Bug-2 defaultDelay spec-engine | S | 8 | DONE 2026-04-03 |
| T2-2 | Bug-2 --delay flag init | S | 9 | DONE 2026-04-03 |
| T2-3 | Bug-2 endpoint init | S | 10 | DONE 2026-04-03 |
| T2-4 | Bug-2 tests | S | 11 | DONE 2026-04-03 |
| T2-5 | Build + lint final | XS | 12 | DONE 2026-04-03 |

**Ordre d'exécution pour le cron : 5 tasks par batch**
- Batch 1 : T3-1, T3-2, T3-3, T1-1, T1-2
- Batch 2 : T1-3, T1-4, T2-1, T2-2, T2-3
- Batch 3 : T2-4, T2-5
