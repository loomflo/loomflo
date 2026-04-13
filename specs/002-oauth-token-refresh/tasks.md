# Tasks: US-002 — OAuth Token Refresh & Retry Resilience

**Spec** : [user-story.md](./user-story.md)  
**Plan** : [plan.md](./plan.md)  
**Branch** : `002-oauth-token-refresh` (créer depuis `001-agent-orchestration-framework`)  
**Prerequisites** : `specs/001-agent-orchestration-framework/tasks.md` 100% complet (✅)

**Tests** : TDD — écrire les tests avant l'implémentation (T201→T204 avant T205→T209).

---

## Format : `[ID] [P?] Description`

- **[P]** : Peut tourner en parallèle (fichiers différents, pas de dépendance)
- Les tâches sans [P] sont séquentielles dans leur phase

---

## Phase 0 : Setup de la branch

- [x] T200 Créer la branch `002-oauth-token-refresh` depuis `001-agent-orchestration-framework` : `git checkout 001-agent-orchestration-framework && git pull && git checkout -b 002-oauth-token-refresh && git push -u origin 002-oauth-token-refresh`

---

## Phase 1 : Tests (TDD — écrire AVANT l'implémentation)

**WARNING** : Ne pas implémenter T205–T209 avant que T201–T204 soient écrits.

- [x] T201 Écrire les tests T4.1 et T4.2 dans `packages/core/tests/unit/providers/anthropic.test.ts` — cas : token getter appelé à chaque complete(), token string statique inchangé
- [x] T202 Écrire les tests T4.3 et T4.4 dans `packages/core/tests/unit/agents/base-agent.test.ts` — cas : 401 API key = hard-fail, 401 OAuth = retriable failed
- [x] T203 Créer `packages/core/tests/unit/providers/credentials.test.ts` et écrire T4.5 et T4.6 — cas : token valide retourne true, token expiré retourne false
- [x] T204 Vérifier que les nouveaux tests compilent mais ÉCHOUENT (expected — implémentation manquante) : `pnpm test 2>&1 | tail -20`

---

## Phase 2 : Implémentation

- [x] T205 Modifier `packages/core/src/providers/base.ts` — changer `oauthToken?: string` en `oauthToken?: string | (() => string | Promise<string>)` dans l'interface `ProviderConfig`
- [x] T206 Modifier `packages/core/src/providers/anthropic.ts` — stocker `oauthTokenSource`, ajouter méthode privée `resolveOAuthToken()`, mettre à jour le header `Authorization` dynamiquement avant chaque appel dans `complete()` (Option B : header dynamique sur `defaultHeaders`)
- [x] T207 Modifier `packages/core/src/providers/anthropic.ts` — exposer `public readonly isOAuthMode: boolean` (rendre la propriété publique)
- [x] T208 Modifier `packages/core/src/agents/base-agent.ts` — dans le catch du `provider.complete()`, distinguer 401 API key (hard-fail) vs 401 OAuth (retriable failed avec message `"token_expired: OAuth token expired — refresh with 'claude --print'"`)
- [x] T209 Ajouter `isOAuthTokenValid()` dans `packages/core/src/providers/credentials.ts` — lit `~/.claude/.credentials.json`, parse `claudeAiOauth.expiresAt`, retourne `true` si expires dans plus de 5 min
- [x] T210 Modifier `packages/core/src/agents/loomi.ts` — aux deux points de retryDelay (~ligne 1158 et ~1236), après le sleep, vérifier `isOAuthTokenValid()` si mode OAuth et retourner failed explicite si token expiré

---

## Phase 3 : Vérification

- [x] T211 Lancer `pnpm test` — vérifier 0 failing, T4.1–T4.6 tous verts
- [x] T212 Lancer `pnpm build` — vérifier 0 erreurs de compilation
- [x] T213 [P] Lancer `pnpm lint` — vérifier 0 warnings
- [x] T214 [P] Lancer `pnpm typecheck` — vérifier 0 erreurs TypeScript

---

## Phase 4 : Commit final

- [x] T215 Commit conventionnel avec toutes les modifications (voir plan.md Phase 6 pour le message exact) et push sur `002-oauth-token-refresh`

---

## Checkpoint final

Avant de reporter "done", vérifier :
- [x] 0 `TODO` dans les fichiers modifiés
- [x] Toutes les checkboxes de `user-story.md` cochées
- [x] Branch `002-oauth-token-refresh` pushée sur origin
- [x] **NE PAS merger sur `main` ou `001-agent-orchestration-framework` — attendre validation Adrien**
