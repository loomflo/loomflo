# User Story — OAuth Token Refresh & Retry Resilience

**ID**: US-002  
**Branch cible**: `002-oauth-token-refresh`  
**Date**: 2026-04-02  
**Statut**: 🟡 À implémenter

---

## Contexte

LoomFlo utilise un token OAuth Claude (`sk-ant-oat01-...`) pour appeler l'API Anthropic.  
Ce token expire après ~7h. Quand l'API retourne un 529 (overloaded), le Loomi attend `retryDelay: 2h` avant de respawner les workers — mais si ce délai dépasse la durée de vie du token, le worker suivant obtient un 401, qui est actuellement un **hard-fail sans retry possible**.

Le résultat : un workflow peut mourir silencieusement à cause d'un token expiré, même si `retryDelay` était censé le protéger.

---

## User Story

**En tant qu'** utilisateur de LoomFlo avec un token OAuth,  
**Je veux que** le système relis toujours le token depuis `~/.claude/.credentials.json` avant chaque appel API,  
**Afin que** mes workflows ne meurent pas à cause d'un token expiré en pleine exécution.

---

## Critères d'acceptation

- [x] Le token OAuth est lu dynamiquement avant chaque appel (plus de stockage statique à l'init)
- [x] Un 401 en mode OAuth ne cause pas de hard-fail immédiat — il déclenche un retry normal via Loomi
- [x] Un 401 en mode API key standard conserve son comportement actuel (hard-fail)
- [x] Les tests existants passent sans régression
- [x] Nouveaux tests unitaires pour chaque cas modifié

---

## Tâches

### T1 — Lecture dynamique du token OAuth dans AnthropicProvider

**Fichier** : `packages/core/src/providers/anthropic.ts`  
**Fichier credentials** : `packages/core/src/providers/credentials.ts`

**Changements :**
1. Dans `ProviderConfig` (`base.ts`), changer `oauthToken?: string` en `oauthToken?: string | (() => string | Promise<string>)`
2. Dans `AnthropicProvider`, stocker le getter/string comme `private readonly oauthTokenSource`
3. Créer une méthode privée `getOAuthToken(): Promise<string>` qui :
   - Si `oauthTokenSource` est une string → la retourne directement
   - Si c'est une fonction → l'appelle à chaque invocation
4. Remplacer l'usage statique du token dans le constructeur par un appel dynamique dans `complete()`
5. Mettre à jour le `Anthropic` client pour accepter le token fraîchement lu à chaque appel (via `authToken` ou reconstruction légère du client)

**Note technique** : Le SDK Anthropic instancie le client avec le token dans le constructeur. Deux options :
- **Option A** (simple) : Re-créer le client à chaque `complete()` si le token a changé (comparer hash)
- **Option B** (propre) : Passer le token via un header custom à chaque requête en overridant `defaultHeaders`

Privilégier **Option B** : mettre à jour `defaultHeaders.authorization` dynamiquement avant chaque appel.

---

### T2 — 401 retriable en mode OAuth dans base-agent.ts

**Fichier** : `packages/core/src/agents/base-agent.ts`

**Changements :**
1. Le `AgentConfig` (ou les paramètres du loop) doit recevoir un flag `isOAuthMode: boolean`
2. Dans le catch du `provider.complete()` :
   - Si `isOAuthMode === false` ET erreur 401 → conserver le hard-fail actuel
   - Si `isOAuthMode === true` ET erreur 401 → retourner `{ status: "failed", error: "OAuth token expired — retry after token refresh" }` (pas de hard-fail spécial, Loomi peut retry)
3. S'assurer que le message d'erreur contient un indicateur clair (ex: `"token_expired"`) pour les logs

---

### T3 — TTL check du token avant retry dans Loomi (optionnel mais recommandé)

**Fichier** : `packages/core/src/agents/loomi.ts`  
**Fichier credentials** : `packages/core/src/providers/credentials.ts`

**Changements :**
1. Créer une fonction `isOAuthTokenValid(): Promise<boolean>` dans `credentials.ts` :
   - Lit `~/.claude/.credentials.json`
   - Parse `claudeAiOauth.expiresAt` (timestamp Unix ms)
   - Retourne `true` si `expiresAt > Date.now() + 5min_buffer`
2. Dans Loomi, après le `retryDelay` wait et avant de respawner les workers :
   - Si mode OAuth ET `!isOAuthTokenValid()` → log clair `"Token expiré — refresh avec 'claude --print' puis relancer"` et retourner `status: "failed"` avec ce message explicite
   - Sinon → continuer normalement

---

### T4 — Tests unitaires

**Fichiers** :
- `packages/core/tests/unit/providers/anthropic.test.ts`
- `packages/core/tests/unit/agents/base-agent.test.ts`

**Cas à couvrir :**
- T4.1 : Token getter en fonction → appelé à chaque `complete()`
- T4.2 : Token getter en string → comportement inchangé
- T4.3 : 401 en mode API key → hard-fail (régression)
- T4.4 : 401 en mode OAuth → `status: "failed"` retriable (pas de hard-fail)
- T4.5 : `isOAuthTokenValid()` → token valide retourne `true`
- T4.6 : `isOAuthTokenValid()` → token expiré retourne `false`

---

## Ordre d'implémentation recommandé

```
T4 (écrire les tests en premier, TDD) → T1 → T2 → T3 → vérifier T4 passe
```

---

## Fichiers impactés (résumé)

| Fichier | Type de changement |
|---|---|
| `packages/core/src/providers/base.ts` | Interface `ProviderConfig` — type `oauthToken` |
| `packages/core/src/providers/anthropic.ts` | Lecture dynamique token, headers dynamiques |
| `packages/core/src/providers/credentials.ts` | Nouvelle fonction `isOAuthTokenValid()` |
| `packages/core/src/agents/base-agent.ts` | Logique 401 OAuth vs API key |
| `packages/core/src/agents/loomi.ts` | TTL check avant retry |
| `packages/core/tests/unit/providers/anthropic.test.ts` | Tests T4.1, T4.2 |
| `packages/core/tests/unit/agents/base-agent.test.ts` | Tests T4.3, T4.4 |
| `packages/core/tests/unit/providers/credentials.test.ts` | Tests T4.5, T4.6 |
