# Plan technique — LoomFlo Bug Fixes

**Référence :** [USER-STORY.md](./USER-STORY.md)  
**Repo :** `/home/borled/projects/loomflo`  
**Branch cible :** `fix/bug-trio-logs-delay-config`

---

## Architecture des changements

### Bug 1 — `loomflo logs` (daemon.ts + server.ts)

**Cause racine :** Dans `daemon.ts`, `createServer()` est appelé avec :
```ts
getEventLog: () => ({
  append: async () => {},
  query: async () => [],  // ← TOUJOURS VIDE
})
```
Et l'option `events` n'est pas fournie à `createServer()` → le plugin `eventsRoutes` n'est jamais enregistré → 404.

**Fix :**
1. Dans `daemon.ts` : câbler `queryEvents(projectPath, filters)` depuis `persistence/events.ts`
2. Dans `daemon.ts` : passer l'option `events: { getProjectPath: () => projectPath }` à `createServer()`
3. Vérifier que `queryEvents` lit bien `events.jsonl` dans le `projectPath` actif

### Bug 2 — Délai entre nodes (spec-engine.ts + init.ts)

**Cause racine :** `createNodeFromDefinition()` dans `spec-engine.ts` hardcode `delay: "0"`.

**Fix :**
1. Dans `spec-engine.ts` : passer le `defaultDelay` de la config comme paramètre à la phase `graph`
2. Dans `createNodeFromDefinition()` : utiliser ce paramètre (sauf pour node-1 : pas de delay)
3. Dans `init.ts` : ajouter option `--delay <duration>` qui override `config.defaultDelay`
4. Dans `init.ts` : lire `config.defaultDelay` comme fallback si `--delay` non spécifié

### Bug 3 — `config get` (config.ts CLI)

**Cause racine :** `readConfigFile()` retourne `{}` si le fichier n'existe pas. Le merge `deepMerge({}, {})` donne `{}`. `resolveKeyPath({}, "provider")` → `undefined`.

**Fix :**
1. Dans `commands/config.ts` : après le merge, appliquer `ConfigSchema.parse(merged)` pour injecter les defaults Zod
2. Gérer les erreurs de validation Zod (config corrompue → message clair)
3. Le `formatValue()` existant gère déjà null/string/number → pas de changement nécessaire

---

## Ordre d'exécution recommandé

Bug 3 est le plus simple (1 ligne de code). Bug 1 est le plus impactant. Bug 2 est le plus étendu.

Ordre conseillé : 3 → 1 → 2 (simple vers complexe)
