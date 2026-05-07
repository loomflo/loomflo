import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { LoomChatPanel } from "../components/loom/LoomChatPanel.js";
import { useProjectStore } from "../context/ProjectStoreContext.js";
import { useTheme } from "../context/ThemeContext.js";
import type { BrainNode } from "../lib/loomBrain.js";
import { SEED_HISTORY, SEED_MESSAGES } from "../lib/loomBrain.js";
import "./WorkflowPage.css";

/* ============================================================================
   Static workflow data — Phase A renders without a simulator.
   Phase B replaces these literals with live data from /workflow + WS events.
   ============================================================================ */

interface SpecNode {
  id: string;
  name: string;
  description: string;
  phase: "spec";
  estimatedDurationSeconds: number;
  agent: "loom" | "loomi" | "looma" | "loomex";
  isFinalSpec?: boolean;
}

interface WorkerNode {
  id: string;
  name: string;
  description: string;
  phase: "worker";
  estimatedDurationSeconds: number;
  agent: "looma";
  parents: string[];
}

type GraphNode = SpecNode | WorkerNode;

const SPEC_NODES: SpecNode[] = [
  {
    id: "requirements",
    name: "Requirements",
    description: "Extrait les requirements à partir du brainstorm.",
    phase: "spec",
    estimatedDurationSeconds: 80,
    agent: "loomi",
  },
  {
    id: "architecture",
    name: "Architecture",
    description: "Conçoit l'architecture technique du projet.",
    phase: "spec",
    estimatedDurationSeconds: 140,
    agent: "loomi",
  },
  {
    id: "workflow-builder",
    name: "Workflow builder",
    description: "Génère le DAG des workers à partir de la spec.",
    phase: "spec",
    estimatedDurationSeconds: 120,
    agent: "loomex",
    isFinalSpec: true,
  },
];

const WORKERS: WorkerNode[] = [
  {
    id: "setup-project",
    name: "Setup project",
    description: "Initialise le repo, installe les deps.",
    phase: "worker",
    estimatedDurationSeconds: 90,
    agent: "looma",
    parents: ["workflow-builder"],
  },
  {
    id: "models",
    name: "Models",
    description: "Schémas Prisma + types partagés.",
    phase: "worker",
    estimatedDurationSeconds: 140,
    agent: "looma",
    parents: ["setup-project"],
  },
  {
    id: "api",
    name: "API REST",
    description: "Endpoints CRUD + validation Zod.",
    phase: "worker",
    estimatedDurationSeconds: 220,
    agent: "looma",
    parents: ["models"],
  },
  {
    id: "auth",
    name: "Auth & sessions",
    description: "Login, JWT, middleware d'auth.",
    phase: "worker",
    estimatedDurationSeconds: 180,
    agent: "looma",
    parents: ["models"],
  },
  {
    id: "ui-base",
    name: "UI base",
    description: "Layout, theming, design tokens.",
    phase: "worker",
    estimatedDurationSeconds: 120,
    agent: "looma",
    parents: ["setup-project"],
  },
  {
    id: "ui-pages",
    name: "Pages",
    description: "Routes principales et data fetching.",
    phase: "worker",
    estimatedDurationSeconds: 240,
    agent: "looma",
    parents: ["ui-base", "api"],
  },
  {
    id: "ui-components",
    name: "Composants",
    description: "Boutons, formulaires, modals.",
    phase: "worker",
    estimatedDurationSeconds: 200,
    agent: "looma",
    parents: ["ui-base"],
  },
  {
    id: "tests",
    name: "Tests E2E",
    description: "Playwright flows critiques.",
    phase: "worker",
    estimatedDurationSeconds: 160,
    agent: "looma",
    parents: ["ui-pages", "auth"],
  },
  {
    id: "docs",
    name: "Documentation",
    description: "README, ADR, guide contrib.",
    phase: "worker",
    estimatedDurationSeconds: 110,
    agent: "looma",
    parents: ["ui-pages"],
  },
];

const NODE_STATUS: Record<string, "pending" | "running" | "done" | "failed" | "waiting"> = {
  requirements: "done",
  architecture: "done",
  "workflow-builder": "done",
  "setup-project": "done",
  models: "done",
  api: "running",
  auth: "running",
  "ui-base": "done",
  "ui-pages": "pending",
  "ui-components": "pending",
  tests: "pending",
  docs: "pending",
};

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}

/* ============================================================================
   Layout — column-by-rank
   ============================================================================ */

interface Edge {
  source: string;
  target: string;
}

function buildEdges(nodes: GraphNode[]): Edge[] {
  const edges: Edge[] = [];
  for (const n of nodes) {
    if (n.phase === "spec") continue;
    for (const p of n.parents) {
      edges.push({ source: p, target: n.id });
    }
  }
  // Spec is sequential
  for (let i = 0; i < SPEC_NODES.length - 1; i++) {
    const a = SPEC_NODES[i];
    const b = SPEC_NODES[i + 1];
    if (a && b) edges.push({ source: a.id, target: b.id });
  }
  return edges;
}

function layoutGraph(
  nodes: GraphNode[],
  edges: Edge[],
): { pos: Record<string, { x: number; y: number }> } {
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
  return { pos };
}

/* ============================================================================
   Sub-components
   ============================================================================ */

function StatusPill({
  status,
}: {
  status: "pending" | "running" | "done" | "failed" | "waiting";
}) {
  const labels = {
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
  node: GraphNode;
  status: "pending" | "running" | "done" | "failed" | "waiting";
  x: number;
  y: number;
  selected: boolean;
  onClick: () => void;
}

function NodeCard({ node, status, x, y, selected, onClick }: NodeCardProps) {
  const idle = status !== "running";
  const phaseLabel = node.phase === "spec" ? "SPEC" : "WORKER";
  return (
    <div
      className="node"
      data-phase={node.phase}
      data-status={status}
      data-idle={idle}
      data-selected={selected}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      onClick={onClick}
    >
      <div className="node-head">
        <span className="node-phase">
          {node.phase === "spec" ? (
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
      <h4 className="node-title">{node.name}</h4>
      <p className="node-desc">{node.description}</p>
      <div className="node-foot">
        <StatusPill status={status} />
        <span className="time">~{fmtDuration(node.estimatedDurationSeconds)}</span>
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

export function WorkflowPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { projects } = useProjectStore();
  const { theme, toggleTheme } = useTheme();

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const allNodes: GraphNode[] = useMemo(() => [...SPEC_NODES, ...WORKERS], []);
  const allEdges = useMemo(() => buildEdges(allNodes), [allNodes]);
  const layout = useMemo(() => layoutGraph(allNodes, allEdges), [allNodes, allEdges]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [stopped, setStopped] = useState(false);

  const selectedNode = allNodes.find((n) => n.id === selectedId) ?? null;
  const selectedStatus = selectedNode ? NODE_STATUS[selectedNode.id] ?? "pending" : null;

  const brainNodes: BrainNode[] = allNodes.map((n) => ({
    id: n.id,
    name: n.name,
    status: NODE_STATUS[n.id],
  }));

  if (!project) {
    return (
      <div className="app">
        <header className="topbar">
          <Link to="/projects" className="brand" style={{ textDecoration: "none" }}>
            loomflo
          </Link>
        </header>
        <main style={{ padding: 32 }}>
          <p>Projet introuvable. <Link to="/projects">Retour</Link>.</p>
        </main>
      </div>
    );
  }

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
            <Link to={`/projects/${project.id}/brainstorm`}>{project.name}</Link>
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
          <span className="workflow-status-badge running">
            <span className="dot" />
            En cours
          </span>
        </div>
        <div className="page-header-right">
          {paused ? (
            <button className="btn" onClick={() => setPaused(false)}>
              <Icon.Play width="14" height="14" /> Reprendre
            </button>
          ) : (
            <button className="btn" onClick={() => setPaused(true)}>
              <Icon.Pause width="14" height="14" /> Pause
            </button>
          )}
          {stopped ? (
            <button className="btn" onClick={() => setStopped(false)}>
              <Icon.RotateCcw width="14" height="14" /> Recommencer
            </button>
          ) : (
            <button className="btn danger" onClick={() => setStopped(true)}>
              <Icon.X width="14" height="14" /> Stop
            </button>
          )}
          <button className="btn ghost">
            <Icon.Terminal width="14" height="14" /> Logs
          </button>
          <button
            className="btn ghost"
            onClick={() => navigate(`/projects/${project.id}/settings`)}
            aria-label="Configuration"
          >
            <Icon.Settings width="16" height="16" />
          </button>
        </div>
      </div>

      <div className="main">
        <aside className="left-panel">
          <div className="left-panel-detail" style={{ flex: 1 }}>
            <div className="panel-header">
              <span className="panel-title">Détail du nœud</span>
              {selectedNode && <span className="panel-meta">{selectedNode.agent}</span>}
            </div>
            <div className="panel-body">
              {selectedNode && selectedStatus ? (
                <div className="detail-card">
                  <div className="dc-head">
                    <span className={`dc-phase ${selectedNode.phase === "spec" ? "spec" : ""}`}>
                      {selectedNode.phase === "spec" ? "SPEC" : "WORKER"}
                    </span>
                    <StatusPill status={selectedStatus} />
                  </div>
                  <h3 className="dc-title">{selectedNode.name}</h3>
                  <p className="dc-desc">{selectedNode.description}</p>
                  <dl className="dc-meta">
                    <dt>id</dt>
                    <dd>{selectedNode.id}</dd>
                    <dt>agent</dt>
                    <dd>{selectedNode.agent}</dd>
                    <dt>durée estimée</dt>
                    <dd>{fmtDuration(selectedNode.estimatedDurationSeconds)}</dd>
                  </dl>
                  <button
                    className="btn"
                    onClick={() => navigate(`/projects/${project.id}/nodes/${selectedNode.id}`)}
                  >
                    Voir le détail complet <Icon.ChevronRight width="11" height="11" />
                  </button>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">
                    <Icon.GitBranch width="22" height="22" />
                  </div>
                  <h3>Sélectionne un nœud</h3>
                  <p>Clique sur un nœud du graphe pour voir son détail et sa progression.</p>
                </div>
              )}
            </div>
          </div>

          <div className="left-panel-chat" style={{ flex: 1 }}>
            <LoomChatPanel
              nodes={brainNodes}
              workflowState="running"
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
                const from = layout.pos[e.source];
                const to = layout.pos[e.target];
                if (!from || !to) return null;
                const sourceStatus = NODE_STATUS[e.source] ?? "pending";
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
              const pos = layout.pos[n.id];
              if (!pos) return null;
              const status = NODE_STATUS[n.id] ?? "pending";
              return (
                <NodeCard
                  key={n.id}
                  node={n}
                  status={status}
                  x={pos.x}
                  y={pos.y}
                  selected={selectedId === n.id}
                  onClick={() => setSelectedId(n.id)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
