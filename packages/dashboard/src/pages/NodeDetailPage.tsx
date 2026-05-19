import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { useApi } from "../context/AppContext.js";
import { useProjectStore } from "../context/ProjectStoreContext.js";
import { useTheme } from "../context/ThemeContext.js";
import { useNode } from "../hooks/useNode.js";
import { useWorkflow } from "../hooks/useWorkflow.js";
import type {
  AgentInfo,
  Node as WfNode,
  NodeStatus,
  WsRuntimeSessionEvent,
} from "../lib/types.js";
import "./NodeDetailPage.css";

/* ============================================================================
   Status mapping
   ============================================================================ */

type UiStatus = "pending" | "waiting" | "running" | "done" | "failed" | "blocked";

function toUiStatus(status: NodeStatus): UiStatus {
  switch (status) {
    case "running":
    case "review":
      return "running";
    case "done":
      return "done";
    case "failed":
    case "failed_provider_exhausted":
      return "failed";
    case "blocked":
      return "blocked";
    case "waiting":
    case "waiting_for_provider":
      return "waiting";
    case "pending":
    default:
      return "pending";
  }
}

const STATUS_LABELS: Record<UiStatus, string> = {
  pending: "En attente",
  waiting: "En attente",
  running: "En cours",
  done: "Terminé",
  failed: "Échec",
  blocked: "Bloqué",
};

function fmtDuration(sec: number): string {
  if (sec < 60) return `${String(Math.round(sec))}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${String(m)}m` : `${String(m)}m ${s.toString().padStart(2, "0")}s`;
}

function fmtClock(ts: number | string): string {
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d.toTimeString().slice(0, 5);
}

function nodePhase(node: WfNode): "spec" | "worker" {
  const roles = new Set(node.agents.map((a) => a.role));
  if (roles.has("looma")) return "worker";
  if (roles.has("loom") || roles.has("loomi") || roles.has("loomex")) return "spec";
  return "worker";
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

function aggregateAgents(agents: AgentInfo[]): {
  totalInput: number;
  totalOutput: number;
  totalCost: number;
  models: string[];
} {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  const models = new Set<string>();
  for (const a of agents) {
    totalInput += a.tokenUsage.input;
    totalOutput += a.tokenUsage.output;
    totalCost += a.cost;
    if (a.model) models.add(a.model);
  }
  return { totalInput, totalOutput, totalCost, models: [...models] };
}

/* ============================================================================
   Live log derivation
   ============================================================================ */

interface LogLine {
  ts: number;
  level: "info" | "warn" | "error" | "debug";
  text: string;
}

function eventToLogLine(ev: WsRuntimeSessionEvent): LogLine | null {
  const kind = (ev.event as { kind?: string }).kind ?? "session";
  const ts = new Date(ev.timestamp).getTime();
  // Best-effort log shaping. The runtime SessionEvent payload varies per
  // runtime (claude-agent vs copilot vs mock); stringify whatever lives
  // under common fields so the user sees something.
  const payload = ev.event;
  const text =
    typeof payload["text"] === "string"
      ? (payload["text"])
      : typeof payload["message"] === "string"
        ? (payload["message"])
        : typeof payload["content"] === "string"
          ? (payload["content"])
          : `[${kind}] ${JSON.stringify(payload).slice(0, 280)}`;

  let level: LogLine["level"] = "info";
  if (kind === "error") level = "error";
  else if (kind === "tool_call" || kind === "tool_result") level = "debug";
  else if (kind === "warning") level = "warn";
  return { ts, level, text };
}

/* ============================================================================
   Sub-components
   ============================================================================ */

function NodeHeader({
  node,
  phase,
  onClose,
}: {
  node: WfNode;
  phase: "spec" | "worker";
  onClose: () => void;
}) {
  const ui = toUiStatus(node.status);
  const agentLabel = node.agents[0]?.role ?? "—";
  return (
    <header className="nd-header">
      <div className="nd-header-left">
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">
          <Icon.ArrowLeft width="16" height="16" />
        </button>
        <div className="nd-header-meta">
          <span className="eyebrow">
            {phase === "spec" ? "Spec node" : "Worker"} · {node.id}
          </span>
          <h1 className="nd-title">{node.title}</h1>
        </div>
      </div>
      <div className="nd-header-right">
        <span className={`status-pill ${ui}`}>
          <span className="dot" />
          {STATUS_LABELS[ui]}
        </span>
        <span className="agent-badge">{agentLabel}</span>
      </div>
    </header>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="nd-section">
      <h3 className="nd-section-title">{title}</h3>
      <div className="nd-section-body">{children}</div>
    </section>
  );
}

function InstructionsSection({ instructions }: { instructions: string }) {
  return (
    <Section title="Instructions">
      <p className="nd-instructions">{instructions || "Aucune instruction définie."}</p>
    </Section>
  );
}

function DependenciesSection({ parents }: { parents: string[] }) {
  if (parents.length === 0) {
    return (
      <Section title="Dépendances">
        <p className="nd-empty">Aucune dépendance — ce nœud est une racine.</p>
      </Section>
    );
  }
  return (
    <Section title="Dépendances">
      <ul className="nd-deps">
        {parents.map((p) => (
          <li key={p}>
            <Icon.GitBranch width="11" height="11" />
            <code>{p}</code>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AgentsSection({ agents }: { agents: AgentInfo[] }) {
  if (agents.length === 0) {
    return (
      <Section title="Agents">
        <p className="nd-empty">Aucun agent assigné — le nœud n'a pas encore démarré.</p>
      </Section>
    );
  }
  return (
    <Section title="Agents">
      <ul className="nd-deps">
        {agents.map((a) => (
          <li key={a.id}>
            <Icon.Tool width="11" height="11" />
            <code>{a.id}</code>
            <span className="lines">
              {a.role} · {a.model} · {a.status}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ToolsSection({
  tools,
  writeGlobs,
}: {
  tools: string[];
  writeGlobs: string[];
}) {
  return (
    <Section title="Outils & scope">
      <div className="nd-tools">
        <span className="label">Tools</span>
        <div className="chips">
          {tools.length === 0 ? (
            <span className="chip mono">—</span>
          ) : (
            tools.map((t) => (
              <span key={t} className="chip mono">
                {t}
              </span>
            ))
          )}
        </div>
      </div>
      <div className="nd-tools">
        <span className="label">Write globs</span>
        <div className="chips">
          {writeGlobs.length === 0 ? (
            <span className="chip mono">—</span>
          ) : (
            writeGlobs.map((g) => (
              <span key={g} className="chip mono">
                {g}
              </span>
            ))
          )}
        </div>
      </div>
    </Section>
  );
}

function CostSection({
  totalInput,
  totalOutput,
  totalCost,
  models,
}: {
  totalInput: number;
  totalOutput: number;
  totalCost: number;
  models: string[];
}) {
  if (totalInput === 0 && totalOutput === 0 && totalCost === 0) return null;
  return (
    <Section title="Coût">
      <dl className="nd-cost">
        <dt>tokens entrée</dt>
        <dd>{totalInput.toLocaleString("fr-FR")}</dd>
        <dt>tokens sortie</dt>
        <dd>{totalOutput.toLocaleString("fr-FR")}</dd>
        <dt>coût</dt>
        <dd>${totalCost.toFixed(4)}</dd>
        <dt>modèle{models.length > 1 ? "s" : ""}</dt>
        <dd>
          <code>{models.length === 0 ? "—" : models.join(", ")}</code>
        </dd>
      </dl>
    </Section>
  );
}

function LogsSection({ logs, onFullscreen }: { logs: LogLine[]; onFullscreen: () => void }) {
  return (
    <Section title="Logs">
      <div className="nd-logs">
        {logs.length === 0 ? (
          <p className="nd-empty">
            Aucun log pour le moment — les events du runtime arrivent en direct.
          </p>
        ) : (
          logs.map((l, i) => (
            <div key={i} className="nd-log-line" data-level={l.level}>
              <span className="ts mono">{fmtClock(l.ts)}</span>
              <span className="lvl">{l.level}</span>
              <span className="msg">{l.text}</span>
            </div>
          ))
        )}
      </div>
      <button className="btn ghost" onClick={onFullscreen} disabled={logs.length === 0}>
        <Icon.ExternalLink width="11" height="11" /> Plein écran
      </button>
    </Section>
  );
}

function FullscreenLogs({ logs, onClose }: { logs: LogLine[]; onClose: () => void }) {
  return (
    <div className="nd-modal-bg" onClick={onClose}>
      <div className="nd-fullscreen" onClick={(e) => { e.stopPropagation(); }}>
        <div className="nd-fullscreen-head">
          <h3>Logs</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon.X width="16" height="16" />
          </button>
        </div>
        <div className="nd-fullscreen-body">
          {logs.map((l, i) => (
            <div key={i} className="nd-log-line" data-level={l.level}>
              <span className="ts mono">{fmtClock(l.ts)}</span>
              <span className="lvl">{l.level}</span>
              <span className="msg">{l.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NodeFooter({
  status,
  onAction,
  pending,
}: {
  status: UiStatus;
  onAction: (kind: "pause" | "resume" | "retry") => void;
  pending: boolean;
}) {
  return (
    <footer className="nd-footer">
      {status === "running" && (
        <button className="btn danger" onClick={() => { onAction("pause"); }} disabled={pending}>
          <Icon.Pause width="11" height="11" /> Mettre le workflow en pause
        </button>
      )}
      {(status === "pending" || status === "waiting") && (
        <button className="btn primary" onClick={() => { onAction("resume"); }} disabled={pending}>
          <Icon.Play width="11" height="11" /> Reprendre le workflow
        </button>
      )}
      {(status === "failed" || status === "blocked") && (
        <button className="btn primary" onClick={() => { onAction("retry"); }} disabled={pending}>
          <Icon.RefreshCw width="11" height="11" /> Reprendre le workflow
        </button>
      )}
    </footer>
  );
}

/* ============================================================================
   NodeDetailPage
   ============================================================================ */

export function NodeDetailPage() {
  const { projectId, nodeId } = useParams<{ projectId: string; nodeId: string }>();
  const navigate = useNavigate();
  const api = useApi();
  const { projects } = useProjectStore();
  const { theme, toggleTheme } = useTheme();

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const { workflow } = useWorkflow(projectId ?? null);
  const { node, loading, error, live } = useNode(projectId ?? null, nodeId ?? null);

  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  // Workflow edges drive the dependency list (daemon Node has no parents field).
  const parents = useMemo(() => {
    if (!workflow || !nodeId) return [];
    return workflow.graph.edges.filter((e) => e.to === nodeId).map((e) => e.from);
  }, [workflow, nodeId]);

  const phase = useMemo(() => (node ? nodePhase(node) : "worker"), [node]);
  const duration = node ? durationFromNode(node) : 0;
  const aggregate = useMemo(
    () =>
      node
        ? aggregateAgents(node.agents)
        : { totalInput: 0, totalOutput: 0, totalCost: 0, models: [] },
    [node],
  );

  const tools = useMemo(() => {
    if (!node) return [];
    if (node.runtime) return [node.runtime];
    return [];
  }, [node]);
  const writeGlobs = useMemo(() => {
    if (!node) return [];
    return [...new Set(Object.values(node.fileOwnership).flat())];
  }, [node]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => { setToast(null); }, 2400);
  }, []);

  const onAction = useCallback(
    async (kind: "pause" | "resume" | "retry") => {
      if (!projectId) return;
      setActionPending(true);
      try {
        if (kind === "pause") await api.pauseWorkflow(projectId);
        else await api.resumeWorkflow(projectId);
        showToast(`Action « ${kind} » envoyée au daemon`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      } finally {
        setActionPending(false);
      }
    },
    [api, projectId, showToast],
  );

  // Aggregate live runtime session events into a tail of log lines.
  const logs = useMemo<LogLine[]>(() => {
    return live.sessionEvents
      .map(eventToLogLine)
      .filter((line): line is LogLine => line !== null)
      .slice(-200);
  }, [live.sessionEvents]);

  // Reset transient UI state when the node changes.
  useEffect(() => {
    setFullscreen(false);
  }, [nodeId]);

  if (!projectId || !nodeId) {
    return (
      <div className="nd-app">
        <main style={{ padding: 32 }}>
          <h2>URL invalide</h2>
          <Link to="/projects">Retour</Link>
        </main>
      </div>
    );
  }

  if (loading && !node) {
    return (
      <div className="nd-app">
        <main style={{ padding: 32 }}>
          <h2>Chargement du nœud…</h2>
        </main>
      </div>
    );
  }

  if (error || !node) {
    return (
      <div className="nd-app">
        <header className="nd-header">
          <Link to="/projects" className="icon-btn">
            <Icon.ArrowLeft width="16" height="16" />
          </Link>
        </header>
        <main style={{ padding: 32 }}>
          <h2>Nœud introuvable</h2>
          <p>
            {error?.message ?? "Le daemon ne renvoie pas ce nœud."}{" "}
            <Link to={`/projects/${projectId}/workflow`}>Retour au workflow</Link>.
          </p>
        </main>
      </div>
    );
  }

  const ui = toUiStatus(node.status);

  return (
    <div className="nd-app">
      <div className="nd-topbar">
        <div className="nd-topbar-left">
          <Link to="/projects" className="brand">
            loomflo
          </Link>
          <div className="crumbs">
            <Link to="/projects">Projets</Link>
            <span className="sep">›</span>
            <Link to={`/projects/${projectId}/workflow`}>{project?.name ?? "Projet"}</Link>
            <span className="sep">›</span>
            <strong>{node.title}</strong>
          </div>
        </div>
        <button className="icon-btn" onClick={toggleTheme} aria-label="Basculer le thème">
          {theme === "dark" ? (
            <Icon.Sun width="16" height="16" />
          ) : (
            <Icon.Moon width="16" height="16" />
          )}
        </button>
      </div>

      <NodeHeader
        node={node}
        phase={phase}
        onClose={() => { void navigate(`/projects/${projectId}/workflow`); }}
      />

      <div className="nd-main">
        <div className="nd-summary">
          <p className="nd-desc">
            {node.instructions.split("\n", 1)[0] ?? "Pas de description."}
          </p>
          <dl className="nd-meta">
            <dt>id</dt>
            <dd>
              <code>{node.id}</code>
            </dd>
            <dt>agents</dt>
            <dd>{node.agents.length}</dd>
            <dt>retry</dt>
            <dd>
              {node.retryCount}/{node.maxRetries}
            </dd>
            {duration > 0 && (
              <>
                <dt>durée</dt>
                <dd>{fmtDuration(duration)}</dd>
              </>
            )}
            <dt>statut</dt>
            <dd>{STATUS_LABELS[ui]}</dd>
          </dl>
        </div>

        <InstructionsSection instructions={node.instructions} />
        <DependenciesSection parents={parents} />
        <AgentsSection agents={node.agents} />
        <ToolsSection tools={tools} writeGlobs={writeGlobs} />
        <CostSection
          totalInput={aggregate.totalInput}
          totalOutput={aggregate.totalOutput}
          totalCost={aggregate.totalCost === 0 ? node.cost : aggregate.totalCost}
          models={aggregate.models}
        />
        <LogsSection logs={logs} onFullscreen={() => { setFullscreen(true); }} />
      </div>

      <NodeFooter status={ui} onAction={(kind) => { void onAction(kind); }} pending={actionPending} />

      {fullscreen && <FullscreenLogs logs={logs} onClose={() => { setFullscreen(false); }} />}

      {toast && <div className="nd-toast">{toast}</div>}
    </div>
  );
}
