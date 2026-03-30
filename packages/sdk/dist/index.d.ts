/**
 * Loomflo SDK client — wraps the Loomflo daemon REST API and WebSocket event stream.
 *
 * Zero runtime dependencies. Uses the built-in `fetch` and `WebSocket` APIs
 * available in Node.js 22+.
 *
 * @packageDocumentation
 */
/**
 * Error thrown when a Loomflo daemon API request fails with a non-2xx status.
 */
declare class LoomfloApiError extends Error {
    /** HTTP status code returned by the daemon. */
    readonly status: number;
    /** Raw response body (parsed JSON when available, raw text otherwise). */
    readonly body: unknown;
    constructor(status: number, message: string, body: unknown);
}
/** Workflow summary embedded in the health response. */
interface HealthWorkflowSummary$1 {
    id: string;
    status: string;
    nodeCount: number;
    activeNodes: string[];
}
/** Response from `GET /health`. */
interface HealthResponse$1 {
    status: string;
    uptime: number;
    version: string;
    workflow: HealthWorkflowSummary$1 | null;
}
/** Graph structure embedded in the workflow response. */
interface WorkflowGraph {
    nodes: unknown[];
    edges: unknown[];
    topology: string;
}
/** Response from `GET /workflow`. */
interface WorkflowResponse$1 {
    id: string;
    status: string;
    description: string;
    projectPath: string;
    totalCost: number;
    createdAt: string;
    updatedAt: string;
    graph: WorkflowGraph;
}
/** Response from `POST /workflow/init`. */
interface InitResponse$1 {
    id: string;
    status: string;
    description: string;
}
/** Action taken by Loom in response to a chat message. */
interface ChatAction$1 {
    type: string;
    details: Record<string, unknown>;
}
/** Response from `POST /chat`. */
interface ChatResponse$1 {
    response: string;
    action: ChatAction$1 | null;
}
/** Single message in the chat history. */
interface ChatMessage$1 {
    role: string;
    content: string;
    timestamp: string;
}
/** Response from `GET /chat/history`. */
interface ChatHistoryResponse$1 {
    messages: ChatMessage$1[];
}
/** Summary of a single node returned by `GET /nodes`. */
interface NodeSummary$1 {
    id: string;
    title: string;
    status: string;
    agentCount: number;
    cost: number;
    retryCount: number;
}
/** Token usage for a single agent. */
interface AgentTokenUsage {
    input: number;
    output: number;
}
/** Agent detail within a node. */
interface AgentDetail$1 {
    id: string;
    role: string;
    status: string;
    taskDescription: string;
    writeScope: string[];
    tokenUsage: AgentTokenUsage;
    cost: number;
}
/** Response from `GET /nodes/:id`. */
interface NodeDetailResponse$1 {
    id: string;
    title: string;
    status: string;
    instructions: string;
    delay: string;
    retryCount: number;
    maxRetries: number;
    cost: number;
    startedAt: string;
    agents: AgentDetail$1[];
    fileOwnership: Record<string, string[]>;
}
/** Per-node cost entry. */
interface NodeCost$1 {
    id: string;
    title: string;
    cost: number;
    retries: number;
}
/** Response from `GET /costs`. */
interface CostsResponse$1 {
    total: number;
    budgetLimit: number;
    budgetRemaining: number;
    nodes: NodeCost$1[];
    loomCost: number;
}
/** Single event in the event log. */
interface WorkflowEvent$1 {
    ts: string;
    type: string;
    nodeId: string | null;
    agentId: string | null;
    details: Record<string, unknown>;
}
/** Response from `GET /events`. */
interface EventsResponse$1 {
    events: WorkflowEvent$1[];
    total: number;
}
/** Options for constructing a {@link LoomfloClient}. */
interface LoomfloClientOptions$1 {
    /** Daemon host. Defaults to `"127.0.0.1"`. */
    host?: string;
    /** Daemon port. Defaults to `3000`. */
    port?: number;
    /** Authentication token (required). */
    token: string;
}
/** Callback invoked when a WebSocket event of the subscribed type is received. */
type EventCallback$1 = (event: unknown) => void;
/**
 * Programmatic client for the Loomflo daemon.
 *
 * Wraps the REST API for issuing commands and the WebSocket stream for
 * receiving real-time events. Uses only built-in Node.js APIs (`fetch`,
 * `WebSocket`) — no runtime dependencies required.
 *
 * @example
 * ```ts
 * const client = new LoomfloClient({ token: 'my-token' });
 * const health = await client.health();
 *
 * await client.connect();
 * const unsub = client.onEvent('node_status', (evt) => console.log(evt));
 * // later…
 * unsub();
 * client.disconnect();
 * ```
 */
declare class LoomfloClient {
    private readonly baseUrl;
    private readonly wsUrl;
    private readonly token;
    private ws;
    private listeners;
    /**
     * Create a new LoomfloClient.
     *
     * @param options - Connection options including host, port, and auth token.
     */
    constructor(options: LoomfloClientOptions$1);
    /**
     * Check daemon health. Does not require authentication.
     *
     * @returns The daemon health status including optional workflow summary.
     */
    health(): Promise<HealthResponse$1>;
    /**
     * Get the current workflow state.
     *
     * @returns The workflow state, or `null` if no workflow is active.
     */
    getWorkflow(): Promise<WorkflowResponse$1 | null>;
    /**
     * Initialize a new workflow from a natural-language description.
     *
     * @param description - What the workflow should build.
     * @param projectPath - Absolute path to the target project directory.
     * @param config - Optional workflow configuration overrides.
     * @returns The newly created workflow summary.
     */
    init(description: string, projectPath: string, config?: Record<string, unknown>): Promise<InitResponse$1>;
    /**
     * Confirm the generated spec and begin Phase 2 execution.
     */
    start(): Promise<void>;
    /**
     * Pause the running workflow. Active agent calls finish; no new calls are
     * dispatched.
     */
    pause(): Promise<void>;
    /**
     * Resume a paused or interrupted workflow.
     */
    resume(): Promise<void>;
    /**
     * Send a chat message to Loom (the architect agent).
     *
     * @param message - The user's message.
     * @returns Loom's response and any action taken.
     */
    chat(message: string): Promise<ChatResponse$1>;
    /**
     * Retrieve the full chat history.
     *
     * @returns All chat messages exchanged with Loom.
     */
    chatHistory(): Promise<ChatHistoryResponse$1>;
    /**
     * List all nodes in the workflow graph.
     *
     * @returns An array of node summaries.
     */
    getNodes(): Promise<NodeSummary$1[]>;
    /**
     * Get detailed information about a single node including its agents.
     *
     * @param nodeId - The node identifier.
     * @returns Full node detail with agents and file ownership.
     */
    getNode(nodeId: string): Promise<NodeDetailResponse$1>;
    /**
     * List available spec artifact names.
     *
     * @returns An array of artifact names (e.g. `["spec.md", "plan.md"]`).
     */
    getSpecs(): Promise<string[]>;
    /**
     * Read a specific spec artifact.
     *
     * @param name - Artifact filename (e.g. `"spec.md"`).
     * @returns The raw markdown content of the artifact.
     */
    getSpec(name: string): Promise<string>;
    /**
     * Get the cost summary for the current workflow.
     *
     * @returns Cost breakdown by node and totals.
     */
    getCosts(): Promise<CostsResponse$1>;
    /**
     * Get the current merged daemon configuration.
     *
     * @returns The configuration key-value map.
     */
    getConfig(): Promise<Record<string, unknown>>;
    /**
     * Update daemon configuration. Changes take effect for the next node
     * activation.
     *
     * @param updates - Key-value pairs to merge into the current config.
     */
    setConfig(updates: Record<string, unknown>): Promise<void>;
    /**
     * Query the event log with optional filters.
     *
     * @param params - Optional filter parameters.
     * @param params.type - Filter by event type (e.g. `"node_started"`).
     * @param params.nodeId - Filter by node identifier.
     * @param params.limit - Maximum number of events to return.
     * @param params.offset - Number of events to skip (for pagination).
     * @returns Matching events and total count.
     */
    getEvents(params?: {
        type?: string;
        nodeId?: string;
        limit?: number;
        offset?: number;
    }): Promise<EventsResponse$1>;
    /**
     * Open a WebSocket connection to the daemon event stream.
     *
     * Resolves once the server sends the `connected` welcome message.
     * Requires the global `WebSocket` API (available in Node.js 22+).
     *
     * @throws {Error} If already connected.
     * @throws {Error} If the global `WebSocket` API is not available.
     */
    connect(): Promise<void>;
    /**
     * Close the WebSocket connection. No-op if not connected.
     */
    disconnect(): void;
    /**
     * Subscribe to WebSocket events of a specific type.
     *
     * @param type - The event type to listen for (e.g. `"node_status"`).
     * @param callback - Invoked with the full parsed event object.
     * @returns An unsubscribe function. Call it to remove this listener.
     */
    onEvent(type: string, callback: EventCallback$1): () => void;
    /**
     * Dispatch an incoming WebSocket message to registered listeners.
     */
    private handleMessage;
    /**
     * Send an HTTP request to the daemon and parse the JSON response.
     *
     * @param method - HTTP method.
     * @param path - URL path (e.g. `"/workflow"`).
     * @param body - Optional JSON request body.
     * @returns The parsed response body.
     * @throws {LoomfloApiError} On non-2xx responses.
     */
    private request;
}

/**
 * Loomflo SDK public types.
 *
 * Standalone TypeScript definitions mirroring the core engine types.
 * Zero runtime dependencies — pure type declarations only.
 *
 * @packageDocumentation
 */
/** Workflow lifecycle state. */
type WorkflowStatus = 'init' | 'spec' | 'building' | 'running' | 'paused' | 'done' | 'failed';
/** Node execution state. */
type NodeStatus = 'pending' | 'waiting' | 'running' | 'review' | 'done' | 'failed' | 'blocked';
/** Agent role in the workflow hierarchy. */
type AgentRole = 'loom' | 'loomi' | 'looma' | 'loomex';
/** Agent lifecycle state. */
type AgentStatus = 'created' | 'running' | 'completed' | 'failed';
/** Graph topology classification. */
type TopologyType = 'linear' | 'divergent' | 'convergent' | 'tree' | 'mixed';
/** Event type identifier for the event log. */
type EventType = 'workflow_created' | 'workflow_started' | 'workflow_paused' | 'workflow_resumed' | 'workflow_completed' | 'spec_phase_started' | 'spec_phase_completed' | 'graph_built' | 'graph_modified' | 'node_started' | 'node_completed' | 'node_failed' | 'node_blocked' | 'agent_created' | 'agent_completed' | 'agent_failed' | 'reviewer_started' | 'reviewer_verdict' | 'retry_triggered' | 'escalation_triggered' | 'message_sent' | 'cost_tracked' | 'memory_updated';
/** Review verdict from a Loomex reviewer agent. */
type ReviewVerdict = 'PASS' | 'FAIL' | 'BLOCKED';
/** LLM response stop reason. */
type StopReason = 'end_turn' | 'tool_use';
/** A directed edge between two nodes in the workflow graph. */
interface Edge {
    /** Source node ID. */
    from: string;
    /** Target node ID. */
    to: string;
}
/** Per-task verification result from a Loomex review. */
interface TaskVerification {
    /** Identifier of the verified task. */
    taskId: string;
    /** Task-level verification result. */
    status: 'pass' | 'fail' | 'blocked';
    /** Explanation of what was found during verification. */
    details: string;
}
/** Cumulative token usage for an agent or LLM call. */
interface TokenUsage {
    /** Number of input tokens consumed. */
    input: number;
    /** Number of output tokens produced. */
    output: number;
}
/** JSON-serializable tool definition sent to the LLM. */
interface ToolDefinition {
    /** Tool identifier (e.g., "read_file"). */
    name: string;
    /** Human-readable description included in the LLM prompt. */
    description: string;
    /** JSON Schema describing the tool's input parameters. */
    inputSchema: Record<string, unknown>;
}
/** A shared memory file managed by the daemon for cross-node state. */
interface SharedMemoryFile {
    /** File name (e.g., "DECISIONS.md"). */
    name: string;
    /** Full path within .loomflo/shared-memory/. */
    path: string;
    /** Current file content (Markdown). */
    content: string;
    /** Agent ID that last wrote to this file. */
    lastModifiedBy: string;
    /** ISO 8601 timestamp of last modification. */
    lastModifiedAt: string;
}
/** Metadata about an agent assigned to a workflow node. */
interface AgentInfo {
    /** Unique agent identifier (e.g., "looma-auth-1"). */
    id: string;
    /** Agent role in the workflow. */
    role: AgentRole;
    /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
    model: string;
    /** Current agent lifecycle state. */
    status: AgentStatus;
    /** Glob patterns defining the agent's file write permissions. */
    writeScope: string[];
    /** Description of the agent's assigned task. */
    taskDescription: string;
    /** Cumulative token usage for this agent's LLM calls. */
    tokenUsage: TokenUsage;
    /** Cumulative cost in USD for this agent's LLM calls. */
    cost: number;
}
/** Structured review report produced by a Loomex reviewer agent. */
interface ReviewReport {
    /** Overall review verdict. */
    verdict: ReviewVerdict;
    /** Per-task verification results. */
    tasksVerified: TaskVerification[];
    /** Detailed findings: what works, what's missing, what's blocked. */
    details: string;
    /** Specific recommended actions for retry or escalation. */
    recommendation: string;
    /** ISO 8601 timestamp when the review was produced. */
    createdAt: string;
}
/** An inter-agent message routed by the MessageBus within a node. */
interface Message {
    /** Unique message identifier. */
    id: string;
    /** Sender agent ID. */
    from: string;
    /** Recipient agent ID. */
    to: string;
    /** Node context (messages are node-scoped). */
    nodeId: string;
    /** Message body. */
    content: string;
    /** ISO 8601 timestamp when the message was sent. */
    timestamp: string;
}
/** A single entry in the workflow event log (events.jsonl). */
interface Event {
    /** ISO 8601 precise timestamp. */
    ts: string;
    /** Event type identifier. */
    type: EventType;
    /** Workflow this event belongs to. */
    workflowId: string;
    /** Node this event relates to, or null for workflow-level events. */
    nodeId: string | null;
    /** Agent this event relates to, or null for node/workflow-level events. */
    agentId: string | null;
    /** Event-specific payload data. */
    details: Record<string, unknown>;
}
/** A workflow node representing one major step in the execution graph. */
interface Node {
    /** Unique node identifier (e.g., "node-1"). */
    id: string;
    /** Human-readable node name (e.g., "Setup Authentication"). */
    title: string;
    /** Current node execution state. */
    status: NodeStatus;
    /** Markdown instructions for this node. */
    instructions: string;
    /** Delay before activation (e.g., "0", "30m", "1h", "1d"). */
    delay: string;
    /** ISO 8601 timestamp when the delay expires, or null. */
    resumeAt: string | null;
    /** Agents assigned to this node. */
    agents: AgentInfo[];
    /** Agent ID to glob patterns mapping for write scope enforcement. */
    fileOwnership: Record<string, string[]>;
    /** Number of retry cycles attempted. */
    retryCount: number;
    /** Maximum allowed retry cycles (from config). */
    maxRetries: number;
    /** Loomex review report, or null if no review has run. */
    reviewReport: ReviewReport | null;
    /** Total accumulated cost in USD for this node (including retries). */
    cost: number;
    /** ISO 8601 timestamp when the node started running, or null. */
    startedAt: string | null;
    /** ISO 8601 timestamp when the node finished, or null. */
    completedAt: string | null;
}
/** The directed acyclic graph defining workflow execution topology. */
interface Graph {
    /** All nodes keyed by node ID. */
    nodes: Record<string, Node>;
    /** Directed edges connecting nodes. */
    edges: Edge[];
    /** Graph topology classification. */
    topology: TopologyType;
}
/** The top-level workflow entity representing a project being built. */
interface Workflow {
    /** Unique workflow identifier. */
    id: string;
    /** Current workflow lifecycle state. */
    status: WorkflowStatus;
    /** Original natural language project description. */
    description: string;
    /** Absolute path to the project workspace. */
    projectPath: string;
    /** The directed execution graph. */
    graph: Graph;
    /** Merged configuration (global + project + CLI). */
    config: Config;
    /** ISO 8601 timestamp when the workflow was created. */
    createdAt: string;
    /** ISO 8601 timestamp of the last state change. */
    updatedAt: string;
    /** Accumulated cost in USD across all nodes. */
    totalCost: number;
}
/** Per-agent-role model configuration. */
interface ModelConfig {
    /** Model for the Loom architect agent. */
    loom: string;
    /** Model for Loomi orchestrator agents. */
    loomi: string;
    /** Model for Looma worker agents. */
    looma: string;
    /** Model for Loomex reviewer agents. */
    loomex: string;
}
/** Retry strategy configuration. */
interface RetryConfig {
    /** Maximum retries per node before escalation. */
    maxRetriesPerNode: number;
    /** Maximum retries per individual task. */
    maxRetriesPerTask: number;
    /** Retry strategy: "adaptive" adjusts prompts, "same" retries unchanged. */
    strategy: 'adaptive' | 'same';
}
/** Loomflo configuration (merged from global, project, and CLI sources). */
interface Config {
    /** Per-role model assignments. */
    models: ModelConfig;
    /** Whether the Loomex reviewer is enabled. */
    reviewerEnabled: boolean;
    /** Default delay between node activations (e.g., "0", "30m"). */
    defaultDelay: string;
    /** Retry configuration. */
    retry: RetryConfig;
    /** Budget limit in USD (0 = unlimited). */
    budgetLimit: number;
    /** Dashboard port number. */
    dashboardPort: number;
    /** Daemon port number. */
    daemonPort: number;
    /** Max LLM API calls per minute per agent. */
    rateLimitPerAgent: number;
    /** Wall-clock timeout per agent call in seconds. */
    agentTimeout: number;
    /** Maximum tokens per agent call. */
    agentMaxTokens: number;
    /** Loomflo level (1=Minimal, 2=Standard, 3=Full). */
    level: 1 | 2 | 3;
    /** Whether shell execution sandbox is enabled. */
    sandboxEnabled: boolean;
}
/** Workflow summary embedded in the health response. */
interface HealthWorkflowSummary {
    /** Workflow identifier. */
    id: string;
    /** Current workflow status. */
    status: WorkflowStatus;
    /** Total number of nodes in the graph. */
    nodeCount: number;
    /** IDs of currently active (running) nodes. */
    activeNodes: string[];
}
/** Response from `GET /health`. */
interface HealthResponse {
    /** Daemon status (e.g., "ok"). */
    status: string;
    /** Daemon uptime in seconds. */
    uptime: number;
    /** Daemon version string. */
    version: string;
    /** Active workflow summary, or null if no workflow. */
    workflow: HealthWorkflowSummary | null;
}
/** Response from `GET /workflow`. */
interface WorkflowResponse {
    /** Workflow identifier. */
    id: string;
    /** Current workflow status. */
    status: WorkflowStatus;
    /** Original project description. */
    description: string;
    /** Absolute path to the project workspace. */
    projectPath: string;
    /** Accumulated total cost in USD. */
    totalCost: number;
    /** ISO 8601 creation timestamp. */
    createdAt: string;
    /** ISO 8601 last update timestamp. */
    updatedAt: string;
    /** The workflow graph structure. */
    graph: Graph;
}
/** Response from `POST /workflow/init`. */
interface InitResponse {
    /** Created workflow identifier. */
    id: string;
    /** Initial workflow status. */
    status: WorkflowStatus;
    /** Echoed project description. */
    description: string;
}
/** Action taken by Loom in response to a chat message. */
interface ChatAction {
    /** Type of action taken (e.g., "graph_modification", "instruction_relay"). */
    type: string;
    /** Action-specific detail data. */
    details: Record<string, unknown>;
}
/** Response from `POST /chat`. */
interface ChatResponse {
    /** Loom's text response. */
    response: string;
    /** Action taken, or null if message was purely conversational. */
    action: ChatAction | null;
}
/** Single message in the chat history. */
interface ChatMessage {
    /** Message role ("user" or "assistant"). */
    role: string;
    /** Message content. */
    content: string;
    /** ISO 8601 timestamp. */
    timestamp: string;
}
/** Response from `GET /chat/history`. */
interface ChatHistoryResponse {
    /** All chat messages exchanged with Loom. */
    messages: ChatMessage[];
}
/** Summary of a single node returned by `GET /nodes`. */
interface NodeSummary {
    /** Node identifier. */
    id: string;
    /** Node title. */
    title: string;
    /** Current node status. */
    status: NodeStatus;
    /** Number of agents assigned. */
    agentCount: number;
    /** Accumulated cost in USD. */
    cost: number;
    /** Number of retry cycles completed. */
    retryCount: number;
}
/** Agent detail within a node detail response. */
interface AgentDetail {
    /** Agent identifier. */
    id: string;
    /** Agent role. */
    role: AgentRole;
    /** Agent lifecycle state. */
    status: AgentStatus;
    /** Description of assigned task. */
    taskDescription: string;
    /** Glob patterns for write permissions. */
    writeScope: string[];
    /** Cumulative token usage. */
    tokenUsage: TokenUsage;
    /** Cumulative cost in USD. */
    cost: number;
}
/** Response from `GET /nodes/:id`. */
interface NodeDetailResponse {
    /** Node identifier. */
    id: string;
    /** Node title. */
    title: string;
    /** Current node status. */
    status: NodeStatus;
    /** Markdown instructions for this node. */
    instructions: string;
    /** Delay string (e.g., "30m"). */
    delay: string;
    /** Number of retry cycles completed. */
    retryCount: number;
    /** Maximum allowed retries. */
    maxRetries: number;
    /** Accumulated cost in USD. */
    cost: number;
    /** ISO 8601 timestamp when the node started, or empty. */
    startedAt: string;
    /** Agents working in this node. */
    agents: AgentDetail[];
    /** Agent ID to glob patterns mapping. */
    fileOwnership: Record<string, string[]>;
}
/** Per-node cost entry in the costs response. */
interface NodeCost {
    /** Node identifier. */
    id: string;
    /** Node title. */
    title: string;
    /** Total cost in USD. */
    cost: number;
    /** Number of retries (contributes to cost). */
    retries: number;
}
/** Response from `GET /costs`. */
interface CostsResponse {
    /** Total workflow cost in USD. */
    total: number;
    /** Budget limit in USD (0 = unlimited). */
    budgetLimit: number;
    /** Remaining budget in USD. */
    budgetRemaining: number;
    /** Per-node cost breakdown. */
    nodes: NodeCost[];
    /** Cost attributed to the Loom architect agent. */
    loomCost: number;
}
/** Single event in the event log. */
interface WorkflowEvent {
    /** ISO 8601 precise timestamp. */
    ts: string;
    /** Event type. */
    type: EventType;
    /** Related node ID, or null. */
    nodeId: string | null;
    /** Related agent ID, or null. */
    agentId: string | null;
    /** Event-specific payload. */
    details: Record<string, unknown>;
}
/** Response from `GET /events`. */
interface EventsResponse {
    /** Matching events. */
    events: WorkflowEvent[];
    /** Total count of matching events (for pagination). */
    total: number;
}
/** Spec artifact metadata. */
interface SpecArtifact {
    /** Artifact filename (e.g., "spec.md"). */
    name: string;
    /** Full file path. */
    path: string;
    /** File size in bytes. */
    size: number;
}
/** Response from `GET /specs`. */
interface SpecsResponse {
    /** Available spec artifacts. */
    artifacts: SpecArtifact[];
}
/** Memory file metadata. */
interface MemoryFile {
    /** File name (e.g., "DECISIONS.md"). */
    name: string;
    /** Full file path. */
    path: string;
    /** File size in bytes. */
    size: number;
    /** ISO 8601 timestamp of last modification. */
    lastModified: string;
}
/** Response from `GET /memory`. */
interface MemoryResponse {
    /** Available shared memory files. */
    files: MemoryFile[];
}
/** Base WebSocket event with type discriminator. */
interface WebSocketEvent {
    /** Event type discriminator. */
    type: string;
    /** Event-specific payload. */
    [key: string]: unknown;
}
/** WebSocket welcome event sent on connection. */
interface ConnectedEvent extends WebSocketEvent {
    /** Always "connected". */
    type: 'connected';
    /** Welcome message. */
    message: string;
}
/** WebSocket event for node status changes. */
interface NodeStatusEvent extends WebSocketEvent {
    /** Always "node_status". */
    type: 'node_status';
    /** Node identifier. */
    nodeId: string;
    /** New node status. */
    status: NodeStatus;
}
/** WebSocket event for agent status changes. */
interface AgentStatusEvent extends WebSocketEvent {
    /** Always "agent_status". */
    type: 'agent_status';
    /** Node identifier. */
    nodeId: string;
    /** Agent identifier. */
    agentId: string;
    /** Agent role. */
    role: AgentRole;
    /** New agent status. */
    status: AgentStatus;
}
/** WebSocket event for inter-agent messages. */
interface AgentMessageEvent extends WebSocketEvent {
    /** Always "agent_message". */
    type: 'agent_message';
    /** Node identifier. */
    nodeId: string;
    /** Sender agent ID. */
    from: string;
    /** Recipient agent ID. */
    to: string;
    /** Message content. */
    content: string;
}
/** WebSocket event for review verdicts. */
interface ReviewVerdictEvent extends WebSocketEvent {
    /** Always "review_verdict". */
    type: 'review_verdict';
    /** Node identifier. */
    nodeId: string;
    /** Review verdict. */
    verdict: ReviewVerdict;
    /** Reviewer details. */
    details: string;
}
/** WebSocket event for graph modifications. */
interface GraphModifiedEvent extends WebSocketEvent {
    /** Always "graph_modified". */
    type: 'graph_modified';
    /** Type of modification. */
    action: 'add_node' | 'remove_node' | 'modify_node' | 'add_edge' | 'remove_edge';
    /** Modified node or edge data. */
    data: Record<string, unknown>;
}
/** WebSocket event for cost updates. */
interface CostUpdateEvent extends WebSocketEvent {
    /** Always "cost_update". */
    type: 'cost_update';
    /** Node identifier. */
    nodeId: string;
    /** Cost of this call in USD. */
    callCost: number;
    /** Total node cost in USD. */
    nodeCost: number;
    /** Total workflow cost in USD. */
    totalCost: number;
    /** Remaining budget in USD. */
    budgetRemaining: number;
}
/** WebSocket event for chat responses from Loom. */
interface ChatResponseEvent extends WebSocketEvent {
    /** Always "chat_response". */
    type: 'chat_response';
    /** Loom's response text. */
    response: string;
    /** Action taken, or null. */
    action: ChatAction | null;
}
/** WebSocket event for spec artifact readiness. */
interface SpecArtifactReadyEvent extends WebSocketEvent {
    /** Always "spec_artifact_ready". */
    type: 'spec_artifact_ready';
    /** Artifact name. */
    name: string;
    /** Artifact file path. */
    path: string;
}
/** Options for constructing a LoomfloClient. */
interface LoomfloClientOptions {
    /** Daemon host. Defaults to "127.0.0.1". */
    host?: string;
    /** Daemon port. Defaults to 3000. */
    port?: number;
    /** Authentication token (required). */
    token: string;
}
/** Callback invoked when a WebSocket event of the subscribed type is received. */
type EventCallback = (event: unknown) => void;

export { type AgentDetail, type AgentInfo, type AgentMessageEvent, type AgentRole, type AgentStatus, type AgentStatusEvent, type ChatAction, type ChatHistoryResponse, type ChatMessage, type ChatResponse, type ChatResponseEvent, type Config, type ConnectedEvent, type CostUpdateEvent, type CostsResponse, type Edge, type Event, type EventCallback, type EventType, type EventsResponse, type Graph, type GraphModifiedEvent, type HealthResponse, type HealthWorkflowSummary, type InitResponse, LoomfloApiError, LoomfloClient, type LoomfloClientOptions, type MemoryFile, type MemoryResponse, type Message, type ModelConfig, type Node, type NodeCost, type NodeDetailResponse, type NodeStatus, type NodeStatusEvent, type NodeSummary, type RetryConfig, type ReviewReport, type ReviewVerdict, type ReviewVerdictEvent, type SharedMemoryFile, type SpecArtifact, type SpecArtifactReadyEvent, type SpecsResponse, type StopReason, type TaskVerification, type TokenUsage, type ToolDefinition, type TopologyType, type WebSocketEvent, type Workflow, type WorkflowEvent, type WorkflowResponse, type WorkflowStatus };
