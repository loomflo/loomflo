import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { useProjectStore } from "../context/ProjectStoreContext.js";
import { useTheme } from "../context/ThemeContext.js";
import "./NodeDetailPage.css";

/* ============================================================================
   Static node fixtures — Phase A renders without /nodes/:id wiring.
   Phase B replaces these with daemon reads + WS streaming logs.
   ============================================================================ */

type NodeStatus = "pending" | "waiting" | "running" | "done" | "failed" | "blocked";

interface NodeFixture {
  id: string;
  name: string;
  phase: "spec" | "worker";
  description: string;
  agent: string;
  status: NodeStatus;
  estimatedDurationSeconds: number;
  parents: string[];
  instructions: string;
  tools: string[];
  writeGlobs: string[];
  files?: { path: string; lines: number }[];
  cost?: { tokensInput: number; tokensOutput: number; usd: number; model: string };
  logs?: { ts: number; level: "info" | "warn" | "error" | "debug"; text: string }[];
}

const NODE_FIXTURES: Record<string, NodeFixture> = {
  api: {
    id: "api",
    name: "API REST",
    phase: "worker",
    description: "Endpoints CRUD + validation Zod sur tous les endpoints.",
    agent: "looma",
    status: "running",
    estimatedDurationSeconds: 220,
    parents: ["models"],
    instructions:
      "Implémente les endpoints CRUD pour les ressources principales du projet. Utilise Zod pour valider les requêtes. Respecte les conventions du projet pour le nommage et la structure des fichiers.",
    tools: ["read", "write", "exec", "search"],
    writeGlobs: ["src/api/**/*", "src/schemas/**/*"],
    files: [
      { path: "src/api/users.ts", lines: 142 },
      { path: "src/api/orders.ts", lines: 98 },
      { path: "src/schemas/user.ts", lines: 36 },
    ],
    cost: { tokensInput: 14820, tokensOutput: 3210, usd: 0.21, model: "claude-sonnet-4-6" },
    logs: [
      { ts: Date.now() - 180_000, level: "info", text: "Démarrage du worker — branche feature/api" },
      { ts: Date.now() - 150_000, level: "info", text: "Lecture des dépendances depuis models" },
      { ts: Date.now() - 120_000, level: "info", text: "Génération de src/api/users.ts (CRUD)" },
      { ts: Date.now() - 90_000, level: "warn", text: "Conflit mineur sur src/schemas/user.ts (résolu)" },
      { ts: Date.now() - 30_000, level: "info", text: "Ajout du middleware validate(schema)" },
    ],
  },
  auth: {
    id: "auth",
    name: "Auth & sessions",
    phase: "worker",
    description: "Login, JWT, middleware d'auth.",
    agent: "looma",
    status: "running",
    estimatedDurationSeconds: 180,
    parents: ["models"],
    instructions: "Implémente le login, la rotation des JWT et le middleware d'auth.",
    tools: ["read", "write", "exec"],
    writeGlobs: ["src/auth/**/*", "src/middleware/**/*"],
    logs: [
      { ts: Date.now() - 120_000, level: "info", text: "Démarrage du worker auth" },
      { ts: Date.now() - 60_000, level: "info", text: "Implémentation de JWT rotation" },
    ],
  },
  models: {
    id: "models",
    name: "Models",
    phase: "worker",
    description: "Schémas Prisma + types partagés.",
    agent: "looma",
    status: "done",
    estimatedDurationSeconds: 140,
    parents: ["setup-project"],
    instructions: "Définit les schémas Prisma et exporte les types partagés.",
    tools: ["read", "write"],
    writeGlobs: ["prisma/**/*", "src/types/**/*"],
    files: [
      { path: "prisma/schema.prisma", lines: 88 },
      { path: "src/types/db.ts", lines: 42 },
    ],
    cost: { tokensInput: 8210, tokensOutput: 1640, usd: 0.11, model: "claude-sonnet-4-6" },
  },
};

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}

function fmtClock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 5);
}

const STATUS_LABELS: Record<NodeStatus, string> = {
  pending: "En attente",
  waiting: "En attente",
  running: "En cours",
  done: "Terminé",
  failed: "Échec",
  blocked: "Bloqué",
};

/* ============================================================================
   Sub-components
   ============================================================================ */

function NodeHeader({ node, onClose }: { node: NodeFixture; onClose: () => void }) {
  return (
    <header className="nd-header">
      <div className="nd-header-left">
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">
          <Icon.ArrowLeft width="16" height="16" />
        </button>
        <div className="nd-header-meta">
          <span className="eyebrow">
            {node.phase === "spec" ? "Spec node" : "Worker"} · {node.id}
          </span>
          <h1 className="nd-title">{node.name}</h1>
        </div>
      </div>
      <div className="nd-header-right">
        <span className={`status-pill ${node.status}`}>
          <span className="dot" />
          {STATUS_LABELS[node.status]}
        </span>
        <span className="agent-badge">{node.agent}</span>
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

function InstructionsSection({
  instructions,
  onEdit,
}: {
  instructions: string;
  onEdit: () => void;
}) {
  return (
    <Section title="Instructions">
      <p className="nd-instructions">{instructions}</p>
      <button className="btn ghost" onClick={onEdit}>
        <Icon.Edit width="11" height="11" /> Modifier les instructions
      </button>
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
          {tools.map((t) => (
            <span key={t} className="chip mono">
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="nd-tools">
        <span className="label">Write globs</span>
        <div className="chips">
          {writeGlobs.map((g) => (
            <span key={g} className="chip mono">
              {g}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FilesSection({
  files,
}: {
  files: { path: string; lines: number }[];
}) {
  return (
    <Section title="Fichiers produits">
      <ul className="nd-files">
        {files.map((f) => (
          <li key={f.path}>
            <Icon.FileText width="11" height="11" />
            <code>{f.path}</code>
            <span className="lines">{f.lines} lignes</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CostSection({
  cost,
}: {
  cost: NodeFixture["cost"];
}) {
  if (!cost) return null;
  return (
    <Section title="Coût">
      <dl className="nd-cost">
        <dt>tokens entrée</dt>
        <dd>{cost.tokensInput.toLocaleString("fr-FR")}</dd>
        <dt>tokens sortie</dt>
        <dd>{cost.tokensOutput.toLocaleString("fr-FR")}</dd>
        <dt>coût</dt>
        <dd>${cost.usd.toFixed(2)}</dd>
        <dt>modèle</dt>
        <dd>
          <code>{cost.model}</code>
        </dd>
      </dl>
    </Section>
  );
}

function LogsSection({
  logs,
  onFullscreen,
}: {
  logs: NonNullable<NodeFixture["logs"]>;
  onFullscreen: () => void;
}) {
  return (
    <Section title="Logs">
      <div className="nd-logs">
        {logs.map((l, i) => (
          <div key={i} className="nd-log-line" data-level={l.level}>
            <span className="ts mono">{fmtClock(l.ts)}</span>
            <span className="lvl">{l.level}</span>
            <span className="msg">{l.text}</span>
          </div>
        ))}
      </div>
      <button className="btn ghost" onClick={onFullscreen}>
        <Icon.ExternalLink width="11" height="11" /> Plein écran
      </button>
    </Section>
  );
}

function FullscreenLogs({
  logs,
  onClose,
}: {
  logs: NonNullable<NodeFixture["logs"]>;
  onClose: () => void;
}) {
  return (
    <div className="nd-modal-bg" onClick={onClose}>
      <div className="nd-fullscreen" onClick={(e) => e.stopPropagation()}>
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

function InstructionsModal({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (next: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div className="nd-modal-bg" onClick={onClose}>
      <div className="nd-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <h3>Modifier les instructions</h3>
        <textarea
          className="nd-textarea"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          rows={6}
        />
        <div className="nd-modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" onClick={() => onSave(val)}>
            <Icon.Check width="11" height="11" /> Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

function NodeFooter({
  status,
  onAction,
}: {
  status: NodeStatus;
  onAction: (kind: "stop" | "resume" | "retry" | "rollback") => void;
}) {
  return (
    <footer className="nd-footer">
      {status === "running" && (
        <button className="btn danger" onClick={() => onAction("stop")}>
          <Icon.Pause width="11" height="11" /> Stopper
        </button>
      )}
      {(status === "pending" || status === "waiting") && (
        <button className="btn primary" onClick={() => onAction("resume")}>
          <Icon.Play width="11" height="11" /> Démarrer
        </button>
      )}
      {(status === "failed" || status === "blocked") && (
        <button className="btn primary" onClick={() => onAction("retry")}>
          <Icon.RefreshCw width="11" height="11" /> Réessayer
        </button>
      )}
      {status === "done" && (
        <button className="btn ghost" onClick={() => onAction("rollback")}>
          <Icon.RotateCcw width="11" height="11" /> Rollback
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
  const { projects } = useProjectStore();
  const { theme, toggleTheme } = useTheme();

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );
  const node = nodeId ? NODE_FIXTURES[nodeId] : undefined;

  const [editing, setEditing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [instructions, setInstructions] = useState(node?.instructions ?? "");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  const onAction = (kind: "stop" | "resume" | "retry" | "rollback") => {
    showToast(`Action « ${kind} » envoyée — Phase B câble cette action au daemon`);
  };

  if (!project || !node) {
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
            Le nœud <code>{nodeId}</code> n'a pas de fixture statique pour Phase A.{" "}
            <Link to={projectId ? `/projects/${projectId}/workflow` : "/projects"}>
              Retour au workflow
            </Link>
            .
          </p>
        </main>
      </div>
    );
  }

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
            <Link to={`/projects/${project.id}/workflow`}>{project.name}</Link>
            <span className="sep">›</span>
            <strong>{node.name}</strong>
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

      <NodeHeader node={node} onClose={() => navigate(`/projects/${project.id}/workflow`)} />

      <div className="nd-main">
        <div className="nd-summary">
          <p className="nd-desc">{node.description}</p>
          <dl className="nd-meta">
            <dt>id</dt>
            <dd>
              <code>{node.id}</code>
            </dd>
            <dt>agent</dt>
            <dd>{node.agent}</dd>
            <dt>durée estimée</dt>
            <dd>{fmtDuration(node.estimatedDurationSeconds)}</dd>
            <dt>statut</dt>
            <dd>{STATUS_LABELS[node.status]}</dd>
          </dl>
        </div>

        <InstructionsSection
          instructions={instructions}
          onEdit={() => setEditing(true)}
        />
        <DependenciesSection parents={node.parents} />
        <ToolsSection tools={node.tools} writeGlobs={node.writeGlobs} />
        {node.files && <FilesSection files={node.files} />}
        {node.cost && <CostSection cost={node.cost} />}
        {node.logs && (
          <LogsSection logs={node.logs} onFullscreen={() => setFullscreen(true)} />
        )}
      </div>

      <NodeFooter status={node.status} onAction={onAction} />

      {editing && (
        <InstructionsModal
          initial={instructions}
          onSave={(next) => {
            setInstructions(next);
            setEditing(false);
            showToast("Instructions sauvegardées localement");
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {fullscreen && node.logs && (
        <FullscreenLogs logs={node.logs} onClose={() => setFullscreen(false)} />
      )}

      {toast && <div className="nd-toast">{toast}</div>}
    </div>
  );
}
