# LoomFlo — Plan d'intégration Provider Alternatif

## Provider recommandé: Moonshot AI — moonshot-v1-8k
## Justification:
- Adrien l'a mentionné en premier; API 100% OpenAI-compatible (même SDK, baseUrl différente)
- Prix: moonshot-v1-8k ≈ $0.012/1K tokens (vs Claude Sonnet ≈ $0.003 input/$0.015 output — comparable pour de gros volumes)
- En cas d'absence de clé Moonshot, Nvidia NIM est le fallback (NVIDIA_API_KEY → baseUrl `https://integrate.api.nvidia.com/v1`)
- Aucune clé trouvée dans l'environnement actuel → Adrien devra setter MOONSHOT_API_KEY ou NVIDIA_API_KEY

## Contexte technique
- `packages/core/src/config.ts` a déjà un champ `provider: z.string().default("anthropic")` — le champ existe, le daemon l'ignore
- `packages/core/src/providers/openai.ts` est un stub vide (throw Error)
- `openai` npm package n'est PAS installé — il faut l'ajouter
- `daemon.ts` ligne 186-192: hardcode `AnthropicProvider`, ignore `config.provider`

---

## Step 1: Installer openai SDK + Implémenter OpenAIProvider complet

### Fichiers à modifier
- `packages/core/package.json` — ajouter dépendance openai
- `packages/core/src/providers/openai.ts` — remplacer le stub par l'implémentation complète

### Actions exactes

**1a. Installer le package openai dans packages/core:**
```bash
cd /home/borled/projects/loomflo/packages/core && npm install openai
```

**1b. Remplacer intégralement `packages/core/src/providers/openai.ts`:**

```typescript
/**
 * OpenAI-compatible LLM provider implementation.
 *
 * Works with any OpenAI-compatible API:
 * - OpenAI: baseUrl omitted (default), apiKey = OPENAI_API_KEY
 * - Moonshot/Kimi: baseUrl = "https://api.moonshot.cn/v1", apiKey = MOONSHOT_API_KEY
 * - Nvidia NIM: baseUrl = "https://integrate.api.nvidia.com/v1", apiKey = NVIDIA_API_KEY
 *
 * @module providers/openai
 */

import OpenAI from "openai";
import type { LLMProvider, ProviderConfig, CompletionParams, LLMMessage } from "./base.js";
import type { ContentBlock, LLMResponse, ToolDefinition } from "../types.js";

/** Default maximum tokens when not specified. */
const DEFAULT_MAX_TOKENS = 8192;

/** Default model — can be overridden via ProviderConfig.defaultModel. */
const DEFAULT_MODEL = "moonshot-v1-8k";

/**
 * Translate our ToolDefinition[] to OpenAI chat tool format.
 */
function toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object" as const,
        ...tool.inputSchema,
      },
    },
  }));
}

/**
 * Translate our LLMMessage[] to OpenAI ChatCompletionMessageParam[].
 */
function toOpenAIMessages(
  messages: LLMMessage[],
  system: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // ContentBlock[] — serialize tool_use and tool_result
    if (msg.role === "assistant") {
      const textBlocks = msg.content.filter((b) => b.type === "text");
      const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");

      const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolUseBlocks.map((b) => {
        if (b.type !== "tool_use") throw new Error("Expected tool_use block");
        return {
          id: b.id,
          type: "function" as const,
          function: {
            name: b.name,
            arguments: JSON.stringify(b.input),
          },
        };
      });

      result.push({
        role: "assistant",
        content: textBlocks.map((b) => (b.type === "text" ? b.text : "")).join("") || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      } as OpenAI.Chat.ChatCompletionAssistantMessageParam);
    } else {
      // user role — may contain tool_result blocks
      const toolResultBlocks = msg.content.filter((b) => b.type === "tool_result");
      const textBlocks = msg.content.filter((b) => b.type === "text");

      if (toolResultBlocks.length > 0) {
        for (const b of toolResultBlocks) {
          if (b.type !== "tool_result") continue;
          result.push({
            role: "tool",
            tool_call_id: b.toolUseId,
            content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
          });
        }
      }

      if (textBlocks.length > 0) {
        result.push({
          role: "user",
          content: textBlocks.map((b) => (b.type === "text" ? b.text : "")).join(""),
        });
      }
    }
  }

  return result;
}

/**
 * Translate OpenAI response content to our ContentBlock[].
 */
function fromOpenAIContent(choice: OpenAI.Chat.ChatCompletion.Choice): ContentBlock[] {
  const result: ContentBlock[] = [];
  const message = choice.message;

  if (message.content) {
    result.push({ type: "text", text: message.content });
  }

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      result.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      });
    }
  }

  return result;
}

/**
 * Map OpenAI finish_reason to our normalized stopReason.
 */
function fromOpenAIFinishReason(reason: string | null): "end_turn" | "tool_use" {
  if (reason === "tool_calls") return "tool_use";
  return "end_turn";
}

/**
 * LLM provider for any OpenAI-compatible API.
 * Configure baseUrl and apiKey in ProviderConfig to target Moonshot, Nvidia NIM, etc.
 */
export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;

  /** Retryable HTTP status codes. */
  private readonly RETRYABLE_STATUSES: readonly number[] = [429, 500, 503];

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey ?? "",
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    this.defaultModel = config.defaultModel ?? DEFAULT_MODEL;
    this.defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(params: CompletionParams): Promise<LLMResponse> {
    const model = params.model || this.defaultModel;
    const maxTokens = params.maxTokens ?? this.defaultMaxTokens;
    const maxRetries = 5;

    const messages = toOpenAIMessages(params.messages, params.system);

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      messages,
      ...(params.tools?.length ? { tools: toOpenAITools(params.tools) } : {}),
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create(requestParams);
        const choice = response.choices[0];
        if (!choice) throw new Error("OpenAI API returned no choices");

        return {
          content: fromOpenAIContent(choice),
          stopReason: fromOpenAIFinishReason(choice.finish_reason),
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
          },
          model: response.model,
        };
      } catch (error: unknown) {
        const status =
          error instanceof OpenAI.APIError ? Number(error.status) : null;

        if (status && this.RETRYABLE_STATUSES.includes(status) && attempt < maxRetries) {
          const BASE_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
          const delay = (BASE_DELAYS_MS[attempt] ?? 16000) + Math.random() * 500;
          console.error(
            `OpenAIProvider: retry ${String(attempt + 1)}/5 after status ${String(status)} — waiting ${String(Math.round(delay))}ms`,
          );
          await new Promise<void>((r) => setTimeout(r, delay));
          continue;
        }

        if (error instanceof OpenAI.APIError) {
          throw new Error(`OpenAI-compat API error (${String(error.status)}): ${error.message}`);
        }
        throw error;
      }
    }

    throw new Error("OpenAI-compat API: max retries exhausted");
  }
}
```

**1c. Vérifier que TypeScript compile:**
```bash
cd /home/borled/projects/loomflo && npm run build --workspace=packages/core 2>&1 | tail -20
```
Si erreur de type sur `tool_result` ou `toolUseId`, vérifie la définition dans `types.ts` et adapte.

---

## Step 2: Intégration daemon + credentials — lire config.provider

### Fichiers à modifier
- `packages/core/src/providers/credentials.ts` — ajouter résolution pour clés non-Anthropic
- `packages/core/src/daemon.ts` — utiliser config.provider au lieu de hardcoder AnthropicProvider

### Actions exactes

**2a. Ajouter dans `packages/core/src/providers/credentials.ts`**

Après la fonction `tryResolveCredentials`, ajouter:

```typescript
// ============================================================================
// OpenAI-compatible Credential Resolution
// ============================================================================

/** Base URLs for known OpenAI-compatible providers. */
export const OPENAI_COMPAT_BASE_URLS: Record<string, string> = {
  moonshot: "https://api.moonshot.cn/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  openai: "", // default OpenAI endpoint
};

/** Default models for known OpenAI-compatible providers. */
export const OPENAI_COMPAT_DEFAULT_MODELS: Record<string, string> = {
  moonshot: "moonshot-v1-8k",
  nvidia: "meta/llama-3.1-8b-instruct",
  openai: "gpt-4o-mini",
};

export interface OpenAICompatCredentials {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  providerName: string;
}

/**
 * Resolve credentials for OpenAI-compatible providers.
 * Checks env vars in order: MOONSHOT_API_KEY, NVIDIA_API_KEY, OPENAI_API_KEY, OPENAI_COMPAT_API_KEY.
 * Also reads OPENAI_BASE_URL and OPENAI_COMPAT_MODEL if set.
 */
export async function resolveOpenAICompatCredentials(options?: {
  env?: Record<string, string | undefined>;
}): Promise<OpenAICompatCredentials> {
  const env = options?.env ?? process.env;

  const moonshotKey = env["MOONSHOT_API_KEY"];
  if (moonshotKey) {
    return {
      apiKey: moonshotKey,
      baseUrl: env["OPENAI_BASE_URL"] ?? OPENAI_COMPAT_BASE_URLS.moonshot,
      defaultModel: env["OPENAI_COMPAT_MODEL"] ?? OPENAI_COMPAT_DEFAULT_MODELS.moonshot,
      providerName: "moonshot",
    };
  }

  const nvidiaKey = env["NVIDIA_API_KEY"];
  if (nvidiaKey) {
    return {
      apiKey: nvidiaKey,
      baseUrl: env["OPENAI_BASE_URL"] ?? OPENAI_COMPAT_BASE_URLS.nvidia,
      defaultModel: env["OPENAI_COMPAT_MODEL"] ?? OPENAI_COMPAT_DEFAULT_MODELS.nvidia,
      providerName: "nvidia",
    };
  }

  const openaiKey = env["OPENAI_API_KEY"] ?? env["OPENAI_COMPAT_API_KEY"];
  if (openaiKey) {
    return {
      apiKey: openaiKey,
      baseUrl: env["OPENAI_BASE_URL"],
      defaultModel: env["OPENAI_COMPAT_MODEL"] ?? OPENAI_COMPAT_DEFAULT_MODELS.openai,
      providerName: "openai",
    };
  }

  throw new Error(
    "No OpenAI-compatible credentials found. Set one of:\n" +
      "  - MOONSHOT_API_KEY (Moonshot/Kimi)\n" +
      "  - NVIDIA_API_KEY (Nvidia NIM)\n" +
      "  - OPENAI_API_KEY (OpenAI)",
  );
}
```

**2b. Modifier `packages/core/src/daemon.ts`**

Remplacer les imports actuels (lignes 14-15):
```typescript
import { AnthropicProvider } from "./providers/anthropic.js";
import { resolveCredentials } from "./providers/credentials.js";
```
Par:
```typescript
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { resolveCredentials, resolveOpenAICompatCredentials } from "./providers/credentials.js";
import type { LLMProvider } from "./providers/base.js";
```

Remplacer le bloc de résolution du provider (lignes ~185-192):
```typescript
    // Resolve credentials and build provider — optional, only needed for agent execution
    let provider: AnthropicProvider | null = null;
    try {
      const credentials = await resolveCredentials();
      provider = new AnthropicProvider(credentials.config);
    } catch {
      // No credentials found — spec-only mode (no agent execution)
    }
```
Par:
```typescript
    // Resolve credentials and build provider — optional, only needed for agent execution
    // config.provider: "anthropic" (default) | "openai" | "moonshot" | "nvidia" | any OpenAI-compat
    const providerType = (await loadConfig({ projectPath: this.projectPath })).provider;
    let provider: LLMProvider | null = null;
    try {
      if (providerType === "anthropic") {
        const credentials = await resolveCredentials();
        provider = new AnthropicProvider(credentials.config);
      } else {
        const creds = await resolveOpenAICompatCredentials();
        provider = new OpenAIProvider({
          apiKey: creds.apiKey,
          baseUrl: creds.baseUrl,
          defaultModel: creds.defaultModel,
        });
        console.log(`LoomFlo: using OpenAI-compat provider "${creds.providerName}" (${creds.defaultModel ?? "default model"})`);
      }
    } catch {
      // No credentials found — spec-only mode (no agent execution)
    }
```

Également changer la déclaration du type de `provider` dans `createNodeExecutor` pour utiliser `LLMProvider` au lieu de `AnthropicProvider` (ligne ~212). Si daemon.ts passe `provider` à `runLoomi`, vérifier que `runLoomi` accepte `LLMProvider` et pas `AnthropicProvider` spécifiquement — si non, mettre à jour la signature.

**2c. Build pour vérifier:**
```bash
cd /home/borled/projects/loomflo && npm run build --workspace=packages/core 2>&1 | tail -30
```

---

## Step 3: Tests + configuration Adrien + commit

### Actions exactes

**3a. Lancer les tests:**
```bash
cd /home/borled/projects/loomflo && npm test --workspace=packages/core 2>&1 | tail -40
```

**3b. Vérifier que le config provider fonctionne:**
Créer un test rapide dans `/tmp/test-openai-provider.ts`:
```bash
# Test de base: vérifier que l'import compile et que la classe s'instancie
cd /home/borled/projects/loomflo && node -e "
const { OpenAIProvider } = await import('./packages/core/dist/index.js');
const p = new OpenAIProvider({ apiKey: 'test-key', baseUrl: 'https://api.moonshot.cn/v1' });
console.log('OpenAIProvider instantiated OK:', typeof p.complete);
" --input-type=module 2>&1
```

**3c. Documenter la configuration pour Adrien:**
Créer `/home/borled/projects/loomflo/PROVIDER_SETUP.md`:
```
# Configurer un provider alternatif dans LoomFlo

## Option 1: Moonshot/Kimi (recommandé)
export MOONSHOT_API_KEY="sk-..."
# Dans .loomflo/config.json du projet:
# { "provider": "moonshot" }

## Option 2: Nvidia NIM (Llama, Qwen open source)
export NVIDIA_API_KEY="nvapi-..."
# { "provider": "nvidia" }

## Option 3: OpenAI standard
export OPENAI_API_KEY="sk-..."
# { "provider": "openai" }

## Changer de modèle
export OPENAI_COMPAT_MODEL="moonshot-v1-32k"
# ou via OPENAI_BASE_URL pour un endpoint custom
```

**3d. git commit:**
```bash
cd /home/borled/projects/loomflo
git add packages/core/src/providers/openai.ts packages/core/src/providers/credentials.ts packages/core/src/daemon.ts packages/core/package.json PROVIDER_SETUP.md
git commit -m "feat: add OpenAI-compatible provider (Moonshot/Kimi, Nvidia NIM, OpenAI)

Implements OpenAIProvider as a full LLMProvider using the openai SDK.
Wires config.provider field into daemon to select the active provider.
Supports MOONSHOT_API_KEY, NVIDIA_API_KEY, OPENAI_API_KEY auto-detection.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

**3e. Notification à Adrien (via le channel telegram disponible):**
Envoie un message: "✅ LoomFlo — provider alternatif opérationnel. Moonshot/Kimi, Nvidia NIM et OpenAI sont maintenant supportés. Ajoute MOONSHOT_API_KEY ou NVIDIA_API_KEY dans ton env, puis mets provider: 'moonshot' dans .loomflo/config.json pour l'activer."
