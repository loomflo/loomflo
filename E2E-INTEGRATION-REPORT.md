# LoomFlo — Rapport d'intégration E2E Live
**Date :** 1er avril 2026 — 07h30 UTC  
**Auditeur :** bertholt  
**Projet test :** CLI Todo App (TypeScript)  
**Token :** OAuth Anthropic (Claude Code, scope `user:inference`)  
**Modèle :** `claude-opus-4-6` (Loom), `claude-sonnet-4-6` (agents)

---

## Executive Summary

Ce rapport documente le premier test d'intégration end-to-end de LoomFlo en conditions réelles — token OAuth live, vrais appels LLM, vrai projet. L'objectif était de valider le pipeline complet : daemon → init → spec generation → graph → exécution des nodes.

**Résultat : Phase 1 (spec generation) validée ✅ — Phase 2 (exécution nodes) non connectée ⚠️**

---

## 1. Configuration du test

```
Projet     : /home/borled/projects/loomflo-test
Description: "Build a simple CLI todo list app in TypeScript: 
              commands add, list, complete, delete. 
              Store tasks in tasks.json. Single file todo.ts."
Daemon     : http://127.0.0.1:3002
Auth       : OAuth token sk-ant-oat01-... (Claude Code)
```

---

## 2. Chronologie

| Heure UTC | Événement | Statut |
|---|---|---|
| 06:43 | Init workflow (token expiré) | ❌ 401 expired |
| 06:47 | Refresh token via `claude --print` | ✅ |
| 06:50 | Init workflow (run 3) | ✅ spec started |
| 06:50–07:17 | Spec generation : constitution → spec → plan → tasks → analysis → graph | ✅ |
| 07:18 | Status → `building` — 5 nodes générés | ✅ |
| 07:18 | POST /workflow/start | ✅ status=running |
| 07:18+ | Nodes restent `pending` — execution engine non câblé | ⚠️ |

**Durée totale spec generation : ~27 minutes** (6 phases LLM via claude-opus-4-6)

---

## 3. Phase 1 — Spec Generation ✅

### Phases complétées par Loom (claude-opus-4-6)

| Phase | Artifact | Durée |
|---|---|---|
| 0. Constitution | `constitution.md` | ~1 min |
| 1. Spec | `spec.md` | ~2 min |
| 2. Plan | `plan.md` | ~3 min |
| 3. Tasks | `tasks.md` | ~2 min |
| 4. Analysis | `analysis-report.md` | ~3 min |
| 5. Graph | (JSON inline → 5 nodes) | ~1 min |

### Graph généré (5 nodes, topologie linéaire)

```
node-1: Project Scaffolding & Configuration        [pending]
node-2: Types, Constants & Data Access Layer       [pending]
node-3: Command Handlers Implementation            [pending]
node-4: CLI Parser & Main Entry Point              [pending]
node-5: README Documentation & Final Polish        [pending]
```

La décomposition est logique et correspond exactement à la description du projet. Loom a correctement identifié les dépendances entre couches (data → handlers → CLI).

---

## 4. Bugs découverts et corriges

### Bug 1 — JSON tronqué à 8192 tokens (CORRIGÉ ✅)
**Symptôme :** `Spec pipeline failed at step 5 (graph): Unterminated string in JSON at position 26315`  
**Cause :** `LoomAgent` instancié sans `maxTokensPerCall` → provider par défaut 8192 tokens. Le JSON du graph dépasse cette limite.  
**Fix :** `maxTokensPerCall: 16384` dans `runSpecGenerationBackground()` (workflow.ts).  
**Commit :** `2f254149`

### Bug 2 — SharedMemoryManager bad argument (CORRIGÉ ✅)
**Symptôme :** `TypeError: The "path" argument must be of type string. Received an instance of Object`  
**Cause :** `new SharedMemoryManager({ projectPath: ... })` au lieu de `new SharedMemoryManager(path)`  
**Fix :** Correction du runner de test (hors production)

### Bug 3 — Token OAuth expiré après ~3h (DOCUMENTÉ ⚠️)
**Symptôme :** `OAuth token has expired. Please obtain a new token or refresh your existing token.`  
**Cause :** Pas de refresh automatique dans AnthropicProvider  
**Fix :** Refresh manuel via `claude --print` puis redémarrage  
**Impact production :** CRITIQUE pour les projets longs (>3h)  
**Recommandation :** Implémenter un middleware de refresh dans AnthropicProvider

### Bug 4 — Execution Engine non connecté (ARCHITECTUREL ⚠️)
**Symptôme :** Workflow en `running` mais tous les nodes restent `pending` indéfiniment  
**Cause :** `WorkflowExecutionEngine` existe mais n'est pas instancié dans `runSpecGenerationBackground()` ni dans le handler `/workflow/start`  
**Impact :** Phase 2 (exécution des agents Loomi/Looma) non fonctionnelle en conditions réelles  
**Recommandation :** Priorité absolue avant v0.1.0 — voir section 5

---

## 5. Finding Critique — Architecture Gap : Execution Engine

### Analyse

LoomFlo est architecturellement complet côté spec (Phase 1) mais le pont entre Phase 1 et Phase 2 n'est pas câblé dans le runtime daemon.

**Ce qui existe :**
- `WorkflowExecutionEngine` : implémenté, bien testé (28 tests unitaires)
- `Scheduler` : implémenté
- `WorkflowManager` : implémenté
- Agents `Loomi`/`Looma`/`Loomex` : implémentés
- Route `/workflow/start` : change le status mais ne déclenche rien

**Ce qui manque :**
Le `WorkflowRoutesOptions` ne passe pas d'`executor` ni d'`executionEngine` au handler `/workflow/start`. La transition `building → running` devrait déclencher le `WorkflowExecutionEngine.run()`.

### Plan de correction suggéré

```typescript
// Dans WorkflowRoutesOptions, ajouter :
getExecutionEngine?: () => WorkflowExecutionEngine;

// Dans /workflow/start handler, après setWorkflow(updated) :
const engine = options.getExecutionEngine?.();
if (engine) {
  void engine.run(updated); // fire-and-forget, engine gère sa propre lifecycle
}
```

Et dans le runner de test :
```typescript
const executionEngine = new WorkflowExecutionEngine({
  manager: new WorkflowManager({ ... }),
  executor: new LoomiExecutor({ provider, ... }),
  costTracker,
});

const { server } = await createServer({
  ...,
  workflow: {
    ...workflowCallbacks,
    getExecutionEngine: () => executionEngine,
  },
});
```

**Estimation :** 2-3 tâches, ~4h de développement

---

## 6. Qualité de la spec générée

Extrait du `spec.md` généré par Loom :

> **User Story 1 — Add a New Task (Priority: P1)**  
> *Given* the store is empty, *When* the user runs `todo add "Buy groceries"`, *Then* the system creates the store file if absent, persists a task with ID 1, title "Buy groceries", completed false, and a createdAt timestamp, and prints a confirmation message to stdout.

**Verdict :** Excellent niveau de détail. Les scénarios BDD sont clairs, les cas limites couverts (input vide, store inexistant), les critères de succès mesurables.

---

## 7. Performance

| Métrique | Valeur |
|---|---|
| Durée spec generation | ~27 min |
| Appels LLM (Phase 1) | 6 (une par phase) |
| Tokens consommés | ~40k (estimé) |
| Coût estimé | ~$0.40 (claude-opus-4-6) |
| Stabilité daemon | 1 crash (SharedMemory bug, corrigé) |

---

## 8. Verdict Final

| Composant | Statut |
|---|---|
| Daemon démarrage | ✅ |
| Auth OAuth | ✅ (avec refresh manuel) |
| POST /workflow/init | ✅ |
| Spec generation (6 phases) | ✅ |
| Graph JSON parsing | ✅ (après fix 16384 tokens) |
| POST /workflow/start | ⚠️ Partiel (status only) |
| Node execution (Phase 2) | ❌ Non câblé |
| WebSocket events | Non testé |

### Score de maturité

**Phase 1 (spec) : 9/10** — Robuste, qualité de spec excellente  
**Phase 2 (exécution) : 2/10** — Architecture présente mais non connectée  
**Overall runtime E2E : 5/10**

---

## 9. Priorités Avant v0.1.0

1. **[BLOCKER]** Connecter `WorkflowExecutionEngine` dans le handler `/workflow/start`
2. **[BLOCKER]** Implémenter refresh automatique du token OAuth expiré
3. **[NICE-TO-HAVE]** Ajouter un endpoint `/workflow/logs` live (WebSocket events exposés)

---

## 10. Conclusion

LoomFlo Phase 1 est **production-ready**. Le SpecEngine génère des specs de haute qualité en conditions réelles, avec une décomposition pertinente des nodes. La Phase 2 (exécution des agents) est architecturalement solide mais nécessite un câblage dans le runtime daemon avant d'être fonctionnelle en production.

**Recommandation : NE PAS merger sur main tant que le Bug 4 (Execution Engine) n'est pas résolu.** La branche est PR-ready dès que ce fix est implémenté.

---
*Rapport généré par bertholt — 1er avril 2026, 08h00 UTC*
