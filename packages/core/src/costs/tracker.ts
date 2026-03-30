/**
 * Cost tracking module for Loomflo agent orchestration.
 *
 * Tracks per-call token usage and estimated cost, aggregates costs per node
 * and per agent, and enforces budget limits (FR-035 through FR-038).
 *
 * The tracker does NOT pause the workflow itself — it only tracks and reports.
 * The workflow engine queries {@link CostTracker.isBudgetExceeded} to decide.
 */

/** Pricing for a single LLM model in dollars per million tokens. */
export interface ModelPricing {
  /** Price in USD per million input tokens. */
  inputPricePerMToken: number;
  /** Price in USD per million output tokens. */
  outputPricePerMToken: number;
}

/** Default pricing table for known models. */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': { inputPricePerMToken: 15, outputPricePerMToken: 75 },
  'claude-sonnet-4-6': { inputPricePerMToken: 3, outputPricePerMToken: 15 },
};

/** Fallback pricing used for models not present in the pricing table. */
const FALLBACK_PRICING: ModelPricing = {
  inputPricePerMToken: 3,
  outputPricePerMToken: 15,
};

/** A single recorded LLM cost entry. */
export interface CostEntry {
  /** LLM model identifier used for the call. */
  model: string;
  /** Number of input tokens consumed. */
  inputTokens: number;
  /** Number of output tokens produced. */
  outputTokens: number;
  /** Calculated cost in USD. */
  cost: number;
  /** Agent that made the call. */
  agentId: string;
  /** Node the agent belongs to. */
  nodeId: string;
  /** ISO 8601 timestamp of when the call was recorded. */
  timestamp: string;
}

/** Aggregated cost summary for the entire workflow. */
export interface CostSummary {
  /** Total accumulated cost in USD. */
  totalCost: number;
  /** Cost in USD aggregated per node ID. */
  perNode: Record<string, number>;
  /** Cost in USD aggregated per agent ID. */
  perAgent: Record<string, number>;
  /** Configured budget limit in USD, or null if none set. */
  budgetLimit: number | null;
  /** Remaining budget in USD, or null if no limit is set. */
  budgetRemaining: number | null;
  /** All recorded cost entries. */
  entries: CostEntry[];
}

/**
 * Callback invoked after every {@link CostTracker.recordCall} with the
 * recorded entry and current aggregated cost state.
 *
 * @param entry - The cost entry that was just recorded.
 * @param nodeCost - Accumulated cost in USD for the entry's node after this call.
 * @param totalCost - Total accumulated cost in USD across all nodes after this call.
 * @param budgetRemaining - Remaining budget in USD, or null if no limit is set.
 */
export type OnRecordCallback = (
  entry: CostEntry,
  nodeCost: number,
  totalCost: number,
  budgetRemaining: number | null,
) => void;

/**
 * Tracks token usage and estimated cost for every LLM call in a workflow.
 *
 * Maintains per-node and per-agent cost aggregation, uses a configurable
 * pricing table, and signals when a budget limit is exceeded.
 */
export class CostTracker {
  private readonly pricing: Record<string, ModelPricing>;
  private readonly entries: CostEntry[] = [];
  private readonly perNode: Map<string, number> = new Map();
  private readonly perAgent: Map<string, number> = new Map();
  private totalCost = 0;
  private budgetLimit: number | null;
  private onRecordCallback: OnRecordCallback | null = null;

  /**
   * Creates a new CostTracker instance.
   *
   * @param budgetLimit - Maximum allowed cost in USD, or null/undefined for no limit.
   * @param customPricing - Optional custom pricing table to merge with defaults.
   */
  constructor(
    budgetLimit?: number | null,
    customPricing?: Record<string, ModelPricing>,
  ) {
    this.budgetLimit = budgetLimit ?? null;
    this.pricing = { ...DEFAULT_PRICING, ...customPricing };
  }

  /**
   * Records an LLM call and calculates its cost.
   *
   * @param model - Model identifier used for the call.
   * @param inputTokens - Number of input tokens consumed.
   * @param outputTokens - Number of output tokens produced.
   * @param agentId - Agent that made the call.
   * @param nodeId - Node the agent belongs to.
   * @returns The recorded cost entry.
   */
  recordCall(
    model: string,
    inputTokens: number,
    outputTokens: number,
    agentId: string,
    nodeId: string,
  ): CostEntry {
    const pricing = this.pricing[model] ?? FALLBACK_PRICING;
    const cost =
      (inputTokens * pricing.inputPricePerMToken +
        outputTokens * pricing.outputPricePerMToken) /
      1_000_000;

    const entry: CostEntry = {
      model,
      inputTokens,
      outputTokens,
      cost,
      agentId,
      nodeId,
      timestamp: new Date().toISOString(),
    };

    this.entries.push(entry);
    this.totalCost += cost;
    this.perNode.set(nodeId, (this.perNode.get(nodeId) ?? 0) + cost);
    this.perAgent.set(agentId, (this.perAgent.get(agentId) ?? 0) + cost);

    if (this.onRecordCallback) {
      const nodeCost = this.perNode.get(nodeId) ?? 0;
      const budgetRemaining =
        this.budgetLimit !== null
          ? Math.max(0, this.budgetLimit - this.totalCost)
          : null;
      this.onRecordCallback(entry, nodeCost, this.totalCost, budgetRemaining);
    }

    return entry;
  }

  /**
   * Checks whether the configured budget limit has been exceeded.
   *
   * @returns `true` if a budget limit is set and total cost exceeds it, `false` otherwise.
   */
  isBudgetExceeded(): boolean {
    if (this.budgetLimit === null) {
      return false;
    }
    return this.totalCost >= this.budgetLimit;
  }

  /**
   * Returns a full cost summary for the workflow.
   *
   * @returns Aggregated cost summary including per-node, per-agent, and budget info.
   */
  getSummary(): CostSummary {
    return {
      totalCost: this.totalCost,
      perNode: Object.fromEntries(this.perNode),
      perAgent: Object.fromEntries(this.perAgent),
      budgetLimit: this.budgetLimit,
      budgetRemaining:
        this.budgetLimit !== null
          ? Math.max(0, this.budgetLimit - this.totalCost)
          : null,
      entries: [...this.entries],
    };
  }

  /**
   * Returns the total accumulated cost in USD.
   *
   * @returns Total cost across all recorded calls.
   */
  getTotalCost(): number {
    return this.totalCost;
  }

  /**
   * Returns the accumulated cost for a specific node.
   *
   * @param nodeId - Node identifier to query.
   * @returns Cost in USD for the given node, or 0 if no calls recorded.
   */
  getNodeCost(nodeId: string): number {
    return this.perNode.get(nodeId) ?? 0;
  }

  /**
   * Returns the accumulated cost for a specific agent.
   *
   * @param agentId - Agent identifier to query.
   * @returns Cost in USD for the given agent, or 0 if no calls recorded.
   */
  getAgentCost(agentId: string): number {
    return this.perAgent.get(agentId) ?? 0;
  }

  /**
   * Updates the budget limit.
   *
   * @param limit - New budget limit in USD, or null to remove the limit.
   */
  setBudgetLimit(limit: number | null): void {
    this.budgetLimit = limit;
  }

  /**
   * Registers a callback that fires after every {@link recordCall}.
   *
   * The daemon uses this to wire cost updates to the WebSocket broadcaster.
   * Pass `null` to remove a previously registered callback.
   *
   * @param callback - Function to invoke after each recorded call, or null to unregister.
   */
  setOnRecordCallback(callback: OnRecordCallback | null): void {
    this.onRecordCallback = callback;
  }

  /**
   * Returns recorded cost entries, optionally filtered by node ID.
   *
   * @param nodeId - If provided, only entries for this node are returned.
   * @returns Array of cost entries.
   */
  getEntries(nodeId?: string): CostEntry[] {
    if (nodeId !== undefined) {
      return this.entries.filter((e) => e.nodeId === nodeId);
    }
    return [...this.entries];
  }
}
