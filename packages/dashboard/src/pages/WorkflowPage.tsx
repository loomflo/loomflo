import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { LoomChatPanel } from "../components/loom/LoomChatPanel.js";
import { useApi } from "../context/AppContext.js";
import { useProjectStore } from "../context/ProjectStoreContext.js";
import { useTheme } from "../context/ThemeContext.js";
import { useWorkflow } from "../hooks/useWorkflow.js";
import type { BrainNode } from "../lib/loomBrain.js";
import { SEED_HISTORY, SEED_MESSAGES } from "../lib/loomBrain.js";
import type { Edge as WfEdge, Node as WfNode, NodeStatus } from "../lib/types.js";
import "./WorkflowPage.css";

/* ============================================================================
   UI status mapping
   ============================================================================ */

type UiStatus = "pending" | "running" | "done" | "failed" | "waiting";

function toUiStatus(status: NodeStatus): UiStatus {
  switch (status) {
    case "running":
    case "review":
      return "running";
    case "done":
      return "done";
    case "failed":
    case "blocked":
    case "failed_provider_exhausted":
      return "failed";
    case "waiting":
    case "waiting_for_provider":
      return "waiting";
    case "pending":
    default:
      return "pending";
  }
}

/* ============================================================================
   Phase classification
   ============================================================================ */

type Phase = "spec" | "worker";

/**
 * Classify a node as "spec" (planning agents) or "worker" (build agents).
 *
 * Falls back to "worker" when the agent roster is empty so freshly
 * graph_built nodes still render in the worker column rather than getting
 * pinned to the spec phase.
 */
function nodePhase(node: WfNode): Phase {
  const roles = new Set(node.agents.map((a) => a.role));
  if (roles.has("looma")) return "worker";
  if (roles.has("loom") || roles.has("loomi") || roles.has("loomex")) return "spec";
  return "worker";
}

/* ============================================================================
   Layout — column-by-rank
   ============================================================================ */

interface UiEdge {
  source: string;
  target: string;
}

interface LaidOutGraph {
  nodes: WfNode[];
  edges: UiEdge[];
  pos: Record<string, { x: number; y: number }>;
}

function layoutGraph(nodes: WfNode[], edges: UiEdge[]): LaidOutGraph["pos"] {
  const incoming = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => incoming.get(e.target)?.push(e.source));
  const rank = new Map<string, number>();
  const compRank = (id: string, seen: Set<string> = new Set()): number => {
    const cached = rank.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = incoming.get(id) ?? [];
    const r = parents.length === 0 ? 0 : Math.max(...parents.map((p) => compRank(p, seen) + 1));
    rank.set(id, r);
    return r;
  };
  nodes.forEach((n) => compRank(n.id));
  const byRank = new Map<number, string[]>();
  nodes.forEach((n) => {
    const r = rank.get(n.id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(n.id);
  });
  const startX = 80;
  const gapX = 280;
  const rowHeight = 130;
  const pos: Record<string, { x: number; y: number }> = {};
  for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
    const ids = byRank.get(r) ?? [];
    const totalH = ids.length * rowHeight;
    const startY = -totalH / 2 + rowHeight / 2;
    ids.forEach((id, i) => {
      pos[id] = { x: startX + r * gapX, y: startY + i * rowHeight };
    });
  }
  return pos;
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}

function durationFromNode(node: WfNode): number {
  if (node.startedAt && node.completedAt) {
    return Math.max(
      0,
      (new Date(node.completedAt).getTime() - new Date(node.startedAt).getTime()) / 1000,
    );
  }
  return 0;
}

/* ============================================================================
   Sub-components
   ============================================================================ */

function StatusPill({ status }: { status: UiStatus }) {
  const labels: Record<UiStatus, string> = {
    pending: "En attente",
    waiting: "En attente",
    running: "En cours",
    done: "Terminé",
    failed: "Échec",
  };
  return (
    <span className={`status-pill ${status}`}>
      <span className="dot" />
      {labels[status]}
    </span>
  );
}

interface NodeCardProps {
  node: WfNode;
  phase: Phase;
  status: UiStatus;
  x: number;
  y: number;
  selected: boolean;
  onClick: () => void;
}

function NodeCard({ node, phase, status, x, y, selected, onClick }: NodeCardProps) {
  const idle = status !== "running";
  const phaseLabel = phase === "spec" ? "SPEC" : "WORKER";
  const description = node.instructions.split("\n", 1)[0]?.slice(0, 120) ?? "";
  return (
    <div
      className="node"
      data-phase={phase}
      data-status={status}
      data-idle={idle}
      data-selected={selected}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      onClick={onClick}
    >
      <div className="node-head">
        <span className="node-phase">
          {phase === "spec" ? (
            <Icon.FileText width="11" height="11" />
          ) : (
            <Icon.Tool width="11" height="11" />
          )}{" "}
          {phaseLabel}
        </span>
        {status === "done" && (
          <Icon.Check width="14" height="14" style={{ color: "var(--status-done-fg)" }} />
        )}
      </div>
      <h4 className="node-title">{node.title}</h4>
      <p className="node-desc">{description}</p>
      <div className="node-foot">
        <StatusPill status={status} />
        <span className="time">{node.cost > 0 ? `$${node.cost.toFixed(2)}` : "—"}</span>
      </div>
    </div>
  );
}

function EdgePath({
  from,
  to,
  done,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  done: boolean;
}) {
  const NODE_W = 220;
  const NODE_H = 110;
  const sx = from.x + NODE_W;
  const sy = from.y + NODE_H / 2;
  const tx = to.x;
  const ty = to.y + NODE_H / 2;
  const dx = Math.max(40, Math.abs(tx - sx) * 0.5);
  const c1x = sx + dx;
  const c2x = tx - dx;
  const d = `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
  return <path className="edge" d={d} data-done={done} />;
}

/* ============================================================================
   WorkflowPage
   ============================================================================ */

const WORKFLOW_BADGE: Record<string, { label: string; className: string }> = {
  init: { label: "Initialisation", className: "init" },
  spec: { label: "Spec en cours", className: "running" },
  building: { label: "Construction", className: "running" },
  running: { label: "En cours", className: "running" },
  paused: { label: "En pause", className: "waiting" },
  done: { label: "Terminé", className: "done" },
  failed: { label: "Échec", className: "failed" },
};

export function WorkflowPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const api = useApi();
  const { projects } = useProjectStore();
  const { theme, toggleTheme } = useTheme();
  const { workflow, loading, error } = useWorkflow(projectId ?? null);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const [actionPending, setActionPending] = useState<"pause" | "resume" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const allNodes: WfNode[] = useMemo(() => {
    if (!workflow) return [];
    return Object.values(workflow.graph.nodes);
  }, [workflow]);

  const allEdges: UiEdge[] = useMemo(() => {
    if (!workflow) return [];
    return workflow.graph.edges.map((e: WfEdge) => ({ source: e.from, target: e.to }));
  }, [workflow]);

  const layout = useMemo(() => layoutGraph(allNodes, allEdges), [allNodes, allEdges]);
  const phaseFor = useCallback((n: WfNode) => nodePhase(n), []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId && !allNodes.some((n) => n.id === selectedId)) setSelectedId(null);
  }, [allNodes, selectedId]);

  const selectedNode = allNodes.find((n) => n.id === selectedId) ?? null;
  const selectedStatus = selectedNode ? toUiStatus(selectedNode.status) : null;

  const brainNodes: BrainNode[] = allNodes.map((n) => ({
    id: n.id,
    name: n.title,
    status: toUiStatus(n.status),
  }));

  const onPause = useCallback(async () => {
    if (!projectId) return;
    setActionPending("pause");
    setActionError(null);
    try {
      await api.pauseWorkflow(projectId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionPending(null);
    }
  }, [api, projectId]);

  const onResume = useCallback(async () => {
    if (!projectId) return;
    setActionPending("resume");
    setActionError(null);
    try {
      await api.resumeWorkflow(projectId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionPending(null);
    }
  }, [api, projectId]);

  if (!project && !loading) {
    return (
      <div className="app">
        <header className="topbar">
          <Link to="/projects" className="brand" style={{ textDecoration: "none" }}>
            loomflo
          </Link>
        </header>
        <main style={{ padding: 32 }}>
          <p>
            Projet introuvable. <Link to="/projects">Retour</Link>.
          </p>
        </main>
      </div>
    );
  }

  const wfStatus = workflow?.status ?? project?.workflowStatus ?? "init";
  const wfBadge = WORKFLOW_BADGE[wfStatus] ?? WORKFLOW_BADGE["running"]!;
  const isPaused = wfStatus === "paused";

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">
            <span className="brand-mark">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
              </svg>
            </span>
            loomflo
          </span>
          <div className="crumbs">
            <Link to="/projects">Projets</Link>
            <span className="sep">›</span>
            <Link to={`/projects/${project?.id ?? ""}/brainstorm`}>
              {project?.name ?? "Projet"}
            </Link>
            <span className="sep">›</span>
            <strong>Workflow</strong>
          </div>
        </div>
        <div className="topbar-right">
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label="Basculer le thème"
            title="Basculer le thème"
          >
            {theme === "dark" ? (
              <Icon.Sun width="16" height="16" />
            ) : (
              <Icon.Moon width="16" height="16" />
            )}
          </button>
        </div>
      </header>

      <div className="page-header">
        <div className="page-header-left">
          <span className={`workflow-status-badge ${wfBadge.className}`}>
            <span className="dot" />
            {wfBadge.label}
          </span>
          {error && (
            <span className="workflow-status-badge failed" role="alert">
              <span className="dot" /> {error.message.slice(0, 60)}
            </span>
          )}
        </div>
        <div className="page-header-right">
          {isPaused ? (
            <button
              className="btn"
              onClick={onResume}
              disabled={actionPending !== null || !projectId}
            >
              <Icon.Play width="14" height="14" />{" "}
              {actionPending === "resume" ? "…" : "Reprendre"}
            </button>
          ) : (
            <button
              className="btn"
              onClick={onPause}
              disabled={actionPending !== null || !projectId}
            >
              <Icon.Pause width="14" height="14" />{" "}
              {actionPending === "pause" ? "…" : "Pause"}
            </button>
          )}
          <button className="btn ghost">
            <Icon.Terminal width="14" height="14" /> Logs
          </button>
          <button
            className="btn ghost"
            onClick={() => navigate(`/projects/${project?.id ?? ""}/settings`)}
            aria-label="Configuration"
          >
            <Icon.Settings width="16" height="16" />
          </button>
        </div>
      </div>

      {actionError && (
        <div className="page-header" role="alert">
          <span className="workflow-status-badge failed">
            <span className="dot" /> {actionError}
          </span>
        </div>
      )}

      <div className="main">
        <aside className="left-panel">
          <div className="left-panel-detail" style={{ flex: 1 }}>
            <div className="panel-header">
              <span className="panel-title">Détail du nœud</span>
              {selectedNode && (
                <span className="panel-meta">
                  {selectedNode.agents[0]?.role ?? "—"}
                </span>
              )}
            </div>
            <div className="panel-body">
              {selectedNode && selectedStatus ? (
                <div className="detail-card">
                  <div className="dc-head">
                    <span
                      className={`dc-phase ${phaseFor(selectedNode) === "spec" ? "spec" : ""}`}
                    >
                      {phaseFor(selectedNode) === "spec" ? "SPEC" : "WORKER"}
                    </span>
                    <StatusPill status={selectedStatus} />
                  </div>
                  <h3 className="dc-title">{selectedNode.title}</h3>
                  <p className="dc-desc">
                    {selectedNode.instructions.split("\n", 1)[0]}
                  </p>
                  <dl className="dc-meta">
                    <dt>id</dt>
                    <dd>{selectedNode.id}</dd>
                    <dt>agents</dt>
                    <dd>
                      {selectedNode.agents.map((a) => a.id).join(", ") || "—"}
                    </dd>
                    <dt>coût</dt>
                    <dd>${selectedNode.cost.toFixed(4)}</dd>
                    <dt>retry</dt>
                    <dd>
                      {selectedNode.retryCount}/{selectedNode.maxRetries}
                    </dd>
                    {durationFromNode(selectedNode) > 0 && (
                      <>
                        <dt>durée</dt>
                        <dd>{fmtDuration(durationFromNode(selectedNode))}</dd>
                      </>
                    )}
                  </dl>
                  <button
                    className="btn"
                    onClick={() =>
                      navigate(`/projects/${project?.id ?? ""}/nodes/${selectedNode.id}`)
                    }
                  >
                    Voir le détail complet <Icon.ChevronRight width="11" height="11" />
                  </button>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">
                    <Icon.GitBranch width="22" height="22" />
                  </div>
                  <h3>{loading ? "Chargement du workflow…" : "Sélectionne un nœud"}</h3>
                  <p>
                    {loading
                      ? "Connexion au daemon en cours."
                      : "Clique sur un nœud du graphe pour voir son détail et sa progression."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="left-panel-chat" style={{ flex: 1 }}>
            <LoomChatPanel
              nodes={brainNodes}
              workflowState={
                isPaused ? "idle" : wfStatus === "running" ? "running" : "idle"
              }
              initialMessages={SEED_MESSAGES}
              initialHistory={SEED_HISTORY}
            />
          </div>
        </aside>

        <div className="canvas-wrap">
          <div className="legend">
            <button className="legend-toggle">Légende</button>
            <div className="legend-body">
              <div className="legend-row">
                <span className="legend-item">
                  <span className="swatch spec" /> Spec
                </span>
                <span className="legend-item">
                  <span className="swatch worker" /> Worker
                </span>
              </div>
              <div className="legend-row">
                <span className="legend-item">
                  <span className="dot running" /> En cours
                </span>
                <span className="legend-item">
                  <span className="dot done" /> Terminé
                </span>
                <span className="legend-item">
                  <span className="dot failed" /> Échec
                </span>
              </div>
            </div>
          </div>

          <div className="canvas-viewport" style={{ transform: "translate(0px, 200px)" }}>
            <svg
              className="edges-svg"
              style={{ left: -2000, top: -2000, width: 6000, height: 6000 }}
              viewBox="-2000 -2000 6000 6000"
              preserveAspectRatio="none"
            >
              {allEdges.map((e) => {
                const from = layout[e.source];
                const to = layout[e.target];
                if (!from || !to) return null;
                const sourceNode = workflow?.graph.nodes[e.source];
                const sourceStatus = sourceNode ? toUiStatus(sourceNode.status) : "pending";
                return (
                  <EdgePath
                    key={`${e.source}->${e.target}`}
                    from={from}
                    to={to}
                    done={sourceStatus === "done"}
                  />
                );
              })}
            </svg>

            {allNodes.map((n) => {
              const pos = layout[n.id];
              if (!pos) return null;
              return (
                <NodeCard
                  key={n.id}
                  node={n}
                  phase={phaseFor(n)}
                  status={toUiStatus(n.status)}
                  x={pos.x}
                  y={pos.y}
                  selected={selectedId === n.id}
                  onClick={() => setSelectedId(n.id)}
                />
              );
            })}

            {!loading && allNodes.length === 0 && (
              <div className="empty-state" style={{ position: "absolute", left: 80, top: 0 }}>
                <div className="empty-icon">
                  <Icon.GitBranch width="22" height="22" />
                </div>
                <h3>Pas encore de graphe</h3>
                <p>
                  Lance le workflow ou attends que Loom ait construit le DAG —{" "}
                  <Link to={`/projects/${project?.id ?? ""}/brainstorm`}>brainstorm</Link>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
