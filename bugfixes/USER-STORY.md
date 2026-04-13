# User Story — LoomFlo Bug Fixes (3 bugs)

**Date :** 2026-04-02  
**Source :** Diagnostic E2E (`/home/borled/loomflo-e2e-test/DIAGNOSTIC-REPORT.md`)

---

## US-1 : `loomflo logs` ne retourne aucun événement

**En tant que** développeur utilisant LoomFlo,  
**Je veux** que `loomflo logs` affiche les événements du workflow en cours,  
**Afin de** suivre l'exécution en temps réel sans lire manuellement les fichiers.

**Problème actuel :**  
`loomflo logs` retourne systématiquement `Failed to fetch events: Not found`.  
La route `/events` est bien enregistrée dans le serveur, mais dans `daemon.ts` l'option `events`
n'est pas passée à `createServer()` — le callback `getEventLog.query` retourne toujours `[]`.

**Fichiers concernés :**

- `packages/core/src/daemon.ts` — `getEventLog: () => ({ query: async () => [] })`
- `packages/core/src/api/server.ts` — l'option `events` n'est pas passée → routes `/events` jamais enregistrées
- `packages/core/src/persistence/events.ts` — `queryEvents()` fonctionne correctement (à utiliser)

**Critères d'acceptance :**

- `loomflo logs` retourne les N derniers événements du workflow actif (depuis `events.jsonl`)
- `loomflo logs --type spec_phase_started` filtre par type
- `loomflo logs --limit 10` pagine correctement
- Sans workflow actif : message clair "No active workflow"
- Tests unitaires mis à jour

---

## US-2 : Délai entre nodes non configurable

**En tant que** développeur configurant un workflow,  
**Je veux** pouvoir définir un délai minimum entre l'activation de chaque node,  
**Afin de** simuler des gates de review ou des pauses de déploiement.

**Problème actuel :**  
Tous les nodes sont créés avec `delay: "0"`. Il n'existe pas de flag CLI `--delay` sur `loomflo init`,
et `defaultDelay` dans la config est ignoré lors de la création des nodes dans `spec-engine.ts`.

**Fichiers concernés :**

- `packages/core/src/spec/spec-engine.ts` — `createNodeFromDefinition()` : `delay` hardcodé à `"0"` (ligne 658)
- `packages/cli/src/commands/init.ts` — pas de flag `--delay`
- `packages/core/src/config.ts` — `defaultDelay` existe (type string) mais n'est pas consommé

**Critères d'acceptance :**

- `loomflo init --delay 10m "description"` → tous les nodes (sauf le premier) ont `delay: "10m"`
- Si `--delay` non passé, la valeur `config.defaultDelay` est utilisée comme fallback
- `loomflo config set defaultDelay 5m` → persiste et est utilisé par les prochains `init`
- Format accepté : `"0"`, `"10m"`, `"1h"`, `"2h"`, `"1d"` (cohérent avec le type `string` existant)
- Tests unitaires pour `createNodeFromDefinition` avec delay non nul

---

## US-3 : `loomflo config get` ne reconnaît pas les clés valides

**En tant que** développeur,  
**Je veux** que `loomflo config get provider` et `loomflo config get models.loom` fonctionnent,  
**Afin de** lire la configuration active sans ouvrir les fichiers manuellement.

**Problème actuel :**  
`loomflo config get provider` → `Error: unknown config key "provider"`.  
La commande lit les fichiers de config (`~/.loomflo/config.json` et `.loomflo/config.json`),
mais ces fichiers sont généralement vides au premier usage — le merged config résout à `{}`,
et `resolveKeyPath({}, "provider")` retourne `undefined` → erreur.  
Le bug est que les **valeurs par défaut du schema Zod** ne sont pas appliquées au merge.

**Fichiers concernés :**

- `packages/cli/src/commands/config.ts` — lecture via `readConfigFile()` sans parse Zod → pas de defaults
- `packages/core/src/config.ts` — `ConfigSchema.parse({})` retourne toutes les valeurs par défaut

**Critères d'acceptance :**

- `loomflo config get provider` → `"anthropic"`
- `loomflo config get models.loom` → `"claude-opus-4-6"`
- `loomflo config get defaultDelay` → `"0"`
- `loomflo config get budgetLimit` → `null`
- `loomflo config` (sans argument) affiche la config complète avec les defaults
- Tests unitaires pour la commande `config get` avec config vide
