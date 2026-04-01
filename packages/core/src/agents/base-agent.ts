import type { LLMProvider, CompletionParams, LLMMessage } from "../providers/base.js";
import type { Tool, ToolContext } from "../tools/base.js";
import { toToolDefinition } from "../tools/base.js";
import type { ContentBlock, ToolDefinition } from "../types.js";

// ============================================================================
// AgentLoopConfig
// ============================================================================

/**
 * Configuration for a single agent loop execution.
 *
 * Defines everything the loop needs: the LLM provider, tools, constraints
 * (timeout, token budget), and identity context for tool execution.
 */
export interface AgentLoopConfig {
  /** System prompt providing instructions and context for the agent. */
  systemPrompt: string;
  /** Tools available to the agent during execution. */
  tools: Tool[];
  /** LLM provider used for completion calls. */
  provider: LLMProvider;
  /** Model identifier to use (e.g., "claude-sonnet-4-6"). */
  model: string;
  /** Maximum tokens the LLM may generate per individual completion call. */
  maxTokens?: number;
  /** Wall-clock timeout in milliseconds. The loop aborts if exceeded. */
  timeout: number;
  /** Cumulative token limit (input + output) across all LLM calls. The loop aborts if exceeded. null = no limit. */
  tokenLimit: number | null;
  /** Unique agent identifier for tool context and logging. */
  agentId: string;
  /** Node identifier the agent belongs to. */
  nodeId: string;
  /** Absolute path to the project workspace root. */
  workspacePath: string;
  /** Glob patterns defining which files the agent may write. */
  writeScope: string[];
}

// ============================================================================
// AgentLoopResult
// ============================================================================

/** Completion status of an agent loop execution. */
export type AgentLoopStatus = "completed" | "failed" | "timeout" | "token_limit";

/**
 * Result returned by {@link runAgentLoop} after execution completes.
 *
 * The loop never throws — all outcomes (success, failure, timeout, budget
 * exhaustion) are represented as structured results with an appropriate status.
 */
export interface AgentLoopResult {
  /** Final text output from the agent, or empty string if none. */
  output: string;
  /** Cumulative token usage across all LLM calls in this loop. */
  tokenUsage: { input: number; output: number };
  /** How the loop terminated. */
  status: AgentLoopStatus;
  /** Error description when status is 'failed', 'timeout', or 'token_limit'. */
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of LLM call iterations to prevent runaway loops. */
const MAX_ITERATIONS = 100;

// ============================================================================
// runAgentLoop
// ============================================================================

/**
 * Execute an agent loop: repeatedly call the LLM and process tool invocations
 * until the agent signals completion or a limit is reached.
 *
 * The loop:
 * 1. Sends the conversation to the LLM via the provider.
 * 2. If the LLM responds with tool_use blocks, executes each tool sequentially,
 *    appends the results, and loops back.
 * 3. If the LLM responds with end_turn, extracts the final text and returns.
 * 4. Enforces wall-clock timeout and cumulative token budget before each call.
 * 5. Caps iterations at {@link MAX_ITERATIONS} as a safety net.
 *
 * This function never throws. All error conditions produce an {@link AgentLoopResult}
 * with an appropriate status and error message.
 *
 * @param config - Agent loop configuration including provider, tools, and limits.
 * @param initialMessages - Optional conversation history to seed the loop with.
 * @returns Structured result with output text, token usage, and termination status.
 */
export async function runAgentLoop(
  config: AgentLoopConfig,
  initialMessages?: LLMMessage[],
): Promise<AgentLoopResult> {
  const startTime = Date.now();
  const tokenUsage = { input: 0, output: 0 };
  const messages: LLMMessage[] = initialMessages ? [...initialMessages] : [];
  const toolDefinitions: ToolDefinition[] = config.tools.map(toToolDefinition);
  const toolMap = new Map<string, Tool>(config.tools.map((t) => [t.name, t]));
  const toolContext: ToolContext = {
    workspacePath: config.workspacePath,
    agentId: config.agentId,
    nodeId: config.nodeId,
    writeScope: config.writeScope,
  };

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Check wall-clock timeout before each LLM call
    const elapsed = Date.now() - startTime;
    if (elapsed >= config.timeout) {
      return {
        output: extractTextOutput(messages),
        tokenUsage,
        status: "timeout",
        error: `Agent exceeded wall-clock timeout of ${String(config.timeout)}ms (elapsed: ${String(elapsed)}ms)`,
      };
    }

    // Check cumulative token budget before each LLM call (null = unlimited)
    if (config.tokenLimit !== null) {
      const totalTokens = tokenUsage.input + tokenUsage.output;
      if (totalTokens >= config.tokenLimit) {
        return {
          output: extractTextOutput(messages),
          tokenUsage,
          status: "token_limit",
          error: `Agent exceeded token limit of ${String(config.tokenLimit)} (used: ${String(totalTokens)})`,
        };
      }
    }

    // Build completion params
    const params: CompletionParams = {
      messages,
      system: config.systemPrompt,
      model: config.model,
      ...(toolDefinitions.length > 0 && { tools: toolDefinitions }),
      ...(config.maxTokens !== undefined && { maxTokens: config.maxTokens }),
    };

    // Call the LLM
    let response;
    try {
      response = await config.provider.complete(params);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // 401 means the API key is invalid/expired — retrying won't help
      if (errorMessage.includes("(401)")) {
        return {
          output: extractTextOutput(messages),
          tokenUsage,
          status: "failed",
          error: "API key invalid or expired — check ANTHROPIC_API_KEY",
        };
      }

      return {
        output: extractTextOutput(messages),
        tokenUsage,
        status: "failed",
        error: `LLM call failed: ${errorMessage}`,
      };
    }

    // Accumulate token usage
    tokenUsage.input += response.usage.inputTokens;
    tokenUsage.output += response.usage.outputTokens;

    // Append the assistant response to conversation history
    messages.push({ role: "assistant", content: response.content });

    // If the LLM is done, extract final text and return
    if (response.stopReason === "end_turn") {
      return {
        output: extractTextFromBlocks(response.content),
        tokenUsage,
        status: "completed",
      };
    }

    // stopReason === 'tool_use': execute each tool_use block sequentially
    const toolUseBlocks = response.content.filter(
      (block): block is ContentBlock & { type: "tool_use" } => block.type === "tool_use",
    );

    const toolResults: ContentBlock[] = [];
    for (const toolUse of toolUseBlocks) {
      const tool = toolMap.get(toolUse.name);
      let resultContent: string;

      if (!tool) {
        resultContent = `Error: Unknown tool "${toolUse.name}". Available tools: ${config.tools.map((t) => t.name).join(", ")}`;
      } else {
        // Validate input against the tool's schema
        const parseResult = tool.inputSchema.safeParse(toolUse.input);
        if (!parseResult.success) {
          resultContent = `Error: Invalid input for tool "${toolUse.name}": ${parseResult.error.message}`;
        } else {
          // Execute the tool — tools must never throw per contract
          resultContent = await tool.execute(parseResult.data, toolContext);
        }
      }

      toolResults.push({
        type: "tool_result",
        toolUseId: toolUse.id,
        content: resultContent,
      });
    }

    // Append tool results as a user message for the next LLM call
    messages.push({ role: "user", content: toolResults });
  }

  // Safety net: max iterations exceeded
  return {
    output: extractTextOutput(messages),
    tokenUsage,
    status: "failed",
    error: `Agent exceeded maximum iteration limit of ${String(MAX_ITERATIONS)}`,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract concatenated text content from an array of content blocks.
 *
 * @param blocks - Content blocks from an LLM response.
 * @returns All text block contents joined with newlines, or empty string if none.
 */
function extractTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is ContentBlock & { type: "text" } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Extract the last assistant text output from the conversation history.
 *
 * Used when the loop terminates early (timeout, token limit, error) to
 * provide any partial output the agent may have produced.
 *
 * @param messages - The full conversation message history.
 * @returns Text from the last assistant message, or empty string if none.
 */
function extractTextOutput(messages: LLMMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as LLMMessage | undefined;
    if (msg === undefined) continue;
    if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      return extractTextFromBlocks(msg.content);
    }
  }
  return "";
}
