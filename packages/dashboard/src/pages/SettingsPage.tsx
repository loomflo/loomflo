import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { useApi } from "../context/AppContext.js";
import { useProjectStore } from "../context/ProjectStoreContext.js";
import { useTheme } from "../context/ThemeContext.js";
import { useConfig } from "../hooks/useConfig.js";
import { useMcp } from "../hooks/useMcp.js";
import type { Config, McpServerConfigEntry, RetryStrategy } from "../lib/types.js";
import "./SettingsPage.css";

/* ============================================================================
   Project config — local-only fixture for Phase A.
   Phase B replaces the load/save with /projects/:id/config + /mcp endpoints.
   ============================================================================ */

interface McpServer {
  name: string;
  type: "stdio" | "sse" | "http";
  command: string;
  enabled: boolean;
}

interface ProjectConfig {
  name: string;
  folder: string;
  template: string;
  primaryProvider: string;
  level: { id: "minimal" | "standard" | "complete"; name: string };
  delayPreset: string;
  reviewer: boolean;
  maxRetries: number;
  retryStrategy: "adaptive" | "identical";
  maxWorkers: number;
  budgetUsd: number | null;
  mcpServers: McpServer[];
}

const PROJECT_KEY = (id: string) => `loomflo.project.${id}`;

const DEFAULT_CONFIG: ProjectConfig = {
  name: "",
  folder: "",
  template: "fullstack-saas",
  primaryProvider: "Anthropic API",
  level: { id: "standard", name: "Standard" },
  delayPreset: "10 minutes",
  reviewer: true,
  maxRetries: 3,
  retryStrategy: "adaptive",
  maxWorkers: 4,
  budgetUsd: 5,
  mcpServers: [],
};

function loadProject(id: string): ProjectConfig {
  try {
    const raw = localStorage.getItem(PROJECT_KEY(id));
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<ProjectConfig>) };
  } catch {
    /* localStorage unavailable */
  }
  return { ...DEFAULT_CONFIG };
}
function saveProject(id: string, p: ProjectConfig): void {
  try {
    localStorage.setItem(PROJECT_KEY(id), JSON.stringify(p));
  } catch {
    /* localStorage unavailable */
  }
}

/* ============================================================================
   Daemon Config <-> ProjectConfig (local UI shape) bridges
   ============================================================================ */

function localRetryStrategyFromConfig(s: RetryStrategy): "adaptive" | "identical" {
  return s === "same" ? "identical" : "adaptive";
}

function configRetryStrategyFromLocal(s: "adaptive" | "identical"): RetryStrategy {
  return s === "identical" ? "same" : "adaptive";
}

function localDelayFromConfig(d: string): string {
  if (d === "0") return "Immédiat";
  return d;
}

function configDelayFromLocal(s: string): string {
  if (s === "Immédiat") return "0";
  // Pass-through for shorthand like "10m", "1h" that the daemon already parses.
  return s;
}

function mergeConfigIntoLocal(prev: ProjectConfig, c: Config): ProjectConfig {
  return {
    ...prev,
    reviewer: c.reviewerEnabled,
    maxRetries: c.maxRetriesPerNode,
    retryStrategy: localRetryStrategyFromConfig(c.retryStrategy),
    maxWorkers: c.maxLoomasPerLoomi ?? prev.maxWorkers,
    budgetUsd: c.budgetLimit,
    delayPreset: localDelayFromConfig(c.defaultDelay),
    primaryProvider: c.provider || prev.primaryProvider,
  };
}

function diffLocalConfig(prev: ProjectConfig, next: ProjectConfig): Partial<Config> {
  const out: Partial<Config> = {};
  if (prev.reviewer !== next.reviewer) out.reviewerEnabled = next.reviewer;
  if (prev.maxRetries !== next.maxRetries) out.maxRetriesPerNode = next.maxRetries;
  if (prev.retryStrategy !== next.retryStrategy)
    out.retryStrategy = configRetryStrategyFromLocal(next.retryStrategy);
  if (prev.maxWorkers !== next.maxWorkers) out.maxLoomasPerLoomi = next.maxWorkers;
  if (prev.budgetUsd !== next.budgetUsd) out.budgetLimit = next.budgetUsd;
  if (prev.delayPreset !== next.delayPreset)
    out.defaultDelay = configDelayFromLocal(next.delayPreset);
  if (prev.primaryProvider !== next.primaryProvider) out.provider = next.primaryProvider;
  return out;
}

function toLocalMcp(name: string, entry: McpServerConfigEntry): McpServer {
  return {
    name,
    type: entry.type,
    command: entry.type === "stdio" ? (entry.command ?? "") : (entry.url ?? ""),
    enabled: entry.enabled,
  };
}

interface SectionDef {
  id:
    | "general"
    | "providers"
    | "level"
    | "delays"
    | "tools"
    | "budget"
    | "advanced"
    | "danger";
  title: string;
  sub: string;
  icon: ReactNode;
  danger?: boolean;
}

const SECTIONS: SectionDef[] = [
  {
    id: "general",
    title: "Général",
    sub: "Identité du projet et dossier de travail.",
    icon: <Icon.Folder width="14" height="14" />,
  },
  {
    id: "providers",
    title: "Providers",
    sub: "Modèles et clés API utilisés par le projet.",
    icon: <Icon.Zap width="14" height="14" />,
  },
  {
    id: "level",
    title: "Niveau",
    sub: "Profondeur de spec et stratégie de review.",
    icon: <Icon.Layers width="14" height="14" />,
  },
  {
    id: "delays",
    title: "Délais",
    sub: "Cadence d'exécution entre les nœuds.",
    icon: <Icon.Clock width="14" height="14" />,
  },
  {
    id: "tools",
    title: "Outils & MCP",
    sub: "Tools autorisés, serveurs MCP du projet.",
    icon: <Icon.Tool width="14" height="14" />,
  },
  {
    id: "budget",
    title: "Budget",
    sub: "Plafond de coût et alertes.",
    icon: <Icon.Database width="14" height="14" />,
  },
  {
    id: "advanced",
    title: "Avancé",
    sub: "Retry, parallélisme, options expert.",
    icon: <Icon.Settings width="14" height="14" />,
  },
  {
    id: "danger",
    title: "Danger zone",
    sub: "Pause, reset, suppression du projet.",
    icon: <Icon.AlertTriangle width="14" height="14" />,
    danger: true,
  },
];

/* ============================================================================
   Sub-components
   ============================================================================ */

function Toast({ message }: { message: string }) {
  return (
    <div className="st-toast">
      <Icon.Check width="14" height="14" /> {message}
    </div>
  );
}

function Modal({
  open,
  icon,
  title,
  body,
  foot,
  onClose,
}: {
  open: boolean;
  icon: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  foot: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="st-modal-bg" onClick={onClose}>
      <div className="st-modal" onClick={(e) => { e.stopPropagation(); }} role="dialog">
        <div className="st-modal-head">
          <span className="st-modal-icon">{icon}</span>
          <div>{title}</div>
        </div>
        {body && <div className="st-modal-body">{body}</div>}
        <div className="st-modal-foot">{foot}</div>
      </div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  ariaLabel,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      className="st-toggle"
      data-on={on}
      onClick={() => { onChange(!on); }}
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel ?? "Toggle"}
    />
  );
}

interface SectionProps {
  id: string;
  icon: ReactNode;
  title: string;
  sub: string;
  danger?: boolean;
  editing: boolean;
  canEdit?: boolean;
  saving?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  children: ReactNode;
}

function Section({
  id,
  icon,
  title,
  sub,
  danger,
  editing,
  canEdit = true,
  saving = false,
  onEdit,
  onSave,
  onCancel,
  children,
}: SectionProps) {
  return (
    <section id={id} className="st-section" data-danger={danger}>
      <header className="st-section-head">
        <div className="st-section-meta">
          <span className="st-section-icon">{icon}</span>
          <div>
            <h2>{title}</h2>
            <p>{sub}</p>
          </div>
        </div>
        {canEdit && (
          <div className="st-section-actions">
            {editing ? (
              <>
                <button className="btn ghost" onClick={onCancel} disabled={saving}>
                  Annuler
                </button>
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon.Check width="11" height="11" />{" "}
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </>
            ) : (
              <button className="btn ghost" onClick={onEdit}>
                <Icon.Edit width="11" height="11" /> Modifier
              </button>
            )}
          </div>
        )}
      </header>
      <div className="st-section-body">{children}</div>
    </section>
  );
}

function KeyVal({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="st-kv">
      <span className="st-kv-k">{k}</span>
      <span className="st-kv-v">{v}</span>
    </div>
  );
}

interface SectionEditProps {
  data: ProjectConfig;
  draft: ProjectConfig;
  setDraft: (next: ProjectConfig) => void;
  editing: boolean;
}

function GeneralSection({ data, draft, setDraft, editing }: SectionEditProps) {
  if (!editing) {
    return (
      <>
        <KeyVal k="Nom" v={<code className="mono">{data.name}</code>} />
        <KeyVal k="Dossier" v={<code className="mono">{data.folder}</code>} />
        <KeyVal k="Template" v={data.template} />
      </>
    );
  }
  return (
    <>
      <div className="field">
        <label className="field-label">Nom</label>
        <input
          className="input mono"
          value={draft.name}
          onChange={(e) => { setDraft({ ...draft, name: e.target.value }); }}
        />
      </div>
      <div className="field">
        <label className="field-label">Dossier</label>
        <input
          className="input mono"
          value={draft.folder}
          onChange={(e) => { setDraft({ ...draft, folder: e.target.value }); }}
        />
      </div>
      <div className="field">
        <label className="field-label">Template</label>
        <input
          className="input"
          value={draft.template}
          onChange={(e) => { setDraft({ ...draft, template: e.target.value }); }}
        />
      </div>
    </>
  );
}

function ProvidersSection({ data, draft, setDraft, editing }: SectionEditProps) {
  if (!editing) {
    return <KeyVal k="Provider primaire" v={data.primaryProvider} />;
  }
  return (
    <div className="field">
      <label className="field-label">Provider primaire</label>
      <select
        className="select"
        value={draft.primaryProvider}
        onChange={(e) => { setDraft({ ...draft, primaryProvider: e.target.value }); }}
      >
        <option>Anthropic API</option>
        <option>OpenAI API</option>
        <option>Moonshot API</option>
        <option>Claude Code (OAuth)</option>
        <option>Copilot CLI (OAuth)</option>
        <option>Codex CLI (OAuth)</option>
      </select>
    </div>
  );
}

function LevelSection({ data, draft, setDraft, editing }: SectionEditProps) {
  const levels: { id: "minimal" | "standard" | "complete"; name: string; desc: string }[] = [
    { id: "minimal", name: "Minimal", desc: "1 spec, 1 worker, sans review." },
    { id: "standard", name: "Standard", desc: "Spec en 3 étapes, review activé." },
    {
      id: "complete",
      name: "Complet",
      desc: "Spec exhaustive en 5 étapes, retries multiples.",
    },
  ];
  if (!editing) {
    return (
      <>
        <KeyVal k="Niveau" v={data.level.name} />
        <KeyVal k="Reviewer" v={data.reviewer ? "Activé" : "Désactivé"} />
      </>
    );
  }
  return (
    <>
      <div className="field">
        <label className="field-label">Niveau de planification</label>
        <div className="st-radio-group">
          {levels.map((l) => (
            <button
              key={l.id}
              className="st-radio"
              data-on={draft.level.id === l.id}
              onClick={() => { setDraft({ ...draft, level: { id: l.id, name: l.name } }); }}
            >
              <span className="st-radio-name">{l.name}</span>
              <span className="st-radio-desc">{l.desc}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <span>Reviewer activé</span>
        <Toggle
          on={draft.reviewer}
          onChange={(v) => { setDraft({ ...draft, reviewer: v }); }}
          ariaLabel="Reviewer"
        />
      </div>
    </>
  );
}

function DelaysSection({ data, draft, setDraft, editing }: SectionEditProps) {
  if (!editing) return <KeyVal k="Délai entre nœuds" v={data.delayPreset} />;
  return (
    <div className="field">
      <label className="field-label">Délai entre les nœuds</label>
      <select
        className="select"
        value={draft.delayPreset}
        onChange={(e) => { setDraft({ ...draft, delayPreset: e.target.value }); }}
      >
        <option>Instantané</option>
        <option>1 minute</option>
        <option>10 minutes</option>
        <option>30 minutes</option>
        <option>1 heure</option>
        <option>2 heures</option>
        <option>4 heures</option>
        <option>8 heures</option>
        <option>1 jour</option>
      </select>
    </div>
  );
}

function ToolsSection({
  data,
  draft,
  editing,
  onAddMcp,
  onRemoveMcp,
}: SectionEditProps & {
  onAddMcp: () => void;
  onRemoveMcp: (name: string) => void;
}) {
  // The MCP list is owned by the daemon — even in edit mode, mutations
  // hit /projects/:id/mcp directly so we always show the live list.
  const list = data.mcpServers;
  void draft;
  return (
    <>
      <div className="st-mcp-list">
        {list.length === 0 && <p className="st-empty">Aucun serveur MCP configuré.</p>}
        {list.map((srv) => (
          <div key={srv.name} className="st-mcp-row">
            <div>
              <code className="mono">{srv.name}</code>{" "}
              <span className="st-mcp-type">{srv.type}</span>
            </div>
            <code className="mono">{srv.command}</code>
            <span className={`st-pill ${srv.enabled ? "ok" : "muted"}`}>
              <span className="dot" />
              {srv.enabled ? "actif" : "désactivé"}
            </span>
            {editing && (
              <button
                className="icon-btn"
                aria-label="Supprimer"
                onClick={() => { onRemoveMcp(srv.name); }}
              >
                <Icon.Trash width="11" height="11" />
              </button>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <button className="btn ghost" onClick={onAddMcp}>
          <Icon.Plus width="11" height="11" /> Ajouter un serveur MCP
        </button>
      )}
    </>
  );
}

function BudgetSection({ data, draft, setDraft, editing }: SectionEditProps) {
  if (!editing) {
    return <KeyVal k="Budget" v={data.budgetUsd ? `$${data.budgetUsd.toFixed(2)}` : "Aucun plafond"} />;
  }
  return (
    <div className="field">
      <label className="field-label">Plafond budgétaire (USD)</label>
      <input
        type="number"
        className="input mono"
        min="0"
        step="0.50"
        value={draft.budgetUsd ?? ""}
        onChange={(e) =>
          { setDraft({
            ...draft,
            budgetUsd: e.target.value === "" ? null : Number(e.target.value),
          }); }
        }
        placeholder="Aucun plafond"
      />
    </div>
  );
}

function AdvancedSection({ data, draft, setDraft, editing }: SectionEditProps) {
  if (!editing) {
    return (
      <>
        <KeyVal k="Max retries" v={data.maxRetries} />
        <KeyVal
          k="Stratégie retry"
          v={data.retryStrategy === "adaptive" ? "Adaptative" : "Identique"}
        />
        <KeyVal k="Workers max" v={data.maxWorkers} />
      </>
    );
  }
  return (
    <>
      <div className="field">
        <label className="field-label">Max retries par nœud</label>
        <input
          type="number"
          className="input"
          min="0"
          max="10"
          value={draft.maxRetries}
          onChange={(e) => { setDraft({ ...draft, maxRetries: Number(e.target.value) }); }}
        />
      </div>
      <div className="field">
        <label className="field-label">Stratégie de retry</label>
        <select
          className="select"
          value={draft.retryStrategy}
          onChange={(e) =>
            { setDraft({
              ...draft,
              retryStrategy: e.target.value as ProjectConfig["retryStrategy"],
            }); }
          }
        >
          <option value="adaptive">Adaptative</option>
          <option value="identical">Identique</option>
        </select>
      </div>
      <div className="field">
        <label className="field-label">Workers max par Loomi</label>
        <input
          type="number"
          className="input"
          min="1"
          max="12"
          value={draft.maxWorkers}
          onChange={(e) => { setDraft({ ...draft, maxWorkers: Number(e.target.value) }); }}
        />
      </div>
    </>
  );
}

function DangerSection({
  onPause,
  onReset,
  onDelete,
}: {
  onPause: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="st-danger-grid">
      <div className="st-danger-row">
        <div>
          <h4>Pauser le workflow</h4>
          <p>Stoppe les workers en cours. Reprenable depuis la page Workflow.</p>
        </div>
        <button className="btn" onClick={onPause}>
          <Icon.Pause width="11" height="11" /> Pauser
        </button>
      </div>
      <div className="st-danger-row">
        <div>
          <h4>Réinitialiser le workflow</h4>
          <p>Efface l'état d'exécution (nœuds, edges, logs). La config reste intacte.</p>
        </div>
        <button className="btn danger" onClick={onReset}>
          <Icon.RotateCcw width="11" height="11" /> Réinitialiser
        </button>
      </div>
      <div className="st-danger-row">
        <div>
          <h4>Supprimer le projet</h4>
          <p>Action irréversible. Les fichiers du dossier ne sont pas touchés.</p>
        </div>
        <button className="btn danger solid" onClick={onDelete}>
          <Icon.Trash width="11" height="11" /> Supprimer
        </button>
      </div>
    </div>
  );
}

/* ============================================================================
   SettingsPage
   ============================================================================ */

export function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const api = useApi();
  const { projects, store } = useProjectStore();
  const { theme, toggleTheme } = useTheme();

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const { config, update: updateConfig } = useConfig(projectId ?? null);
  const {
    servers: mcpServers,
    upsert: upsertMcp,
    remove: removeMcp,
  } = useMcp(projectId ?? null);

  const [data, setData] = useState<ProjectConfig>(() =>
    projectId ? loadProject(projectId) : { ...DEFAULT_CONFIG },
  );

  // Hydrate from the daemon when the live Config arrives.
  useEffect(() => {
    if (!config) return;
    setData((prev) => mergeConfigIntoLocal(prev, config));
  }, [config]);

  // Hydrate MCP list from the daemon (CRUD lives on the daemon, not in
  // localStorage anymore).
  useEffect(() => {
    setData((prev) => ({
      ...prev,
      mcpServers: Object.entries(mcpServers).map(([name, entry]) =>
        toLocalMcp(name, entry),
      ),
    }));
  }, [mcpServers]);

  const [editingId, setEditingId] = useState<SectionDef["id"] | null>(null);
  const [draft, setDraft] = useState<ProjectConfig | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionDef["id"]>("general");
  const [modal, setModal] = useState<"pause" | "reset" | "delete" | "mcp" | null>(null);
  const [mcpForm, setMcpForm] = useState<McpServer>({
    name: "",
    type: "stdio",
    command: "",
    enabled: true,
  });
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pausing, setPausing] = useState(false);
  const contentRef = useRef<HTMLElement | null>(null);

  const startEdit = (id: SectionDef["id"]) => {
    setEditingId(id);
    setDraft({ ...data });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };
  const saveEdit = async () => {
    if (!draft || !projectId) return;
    setSaving(true);
    try {
      const partial = diffLocalConfig(data, draft);
      if (Object.keys(partial).length > 0) {
        try {
          await updateConfig(partial);
        } catch (err) {
          showToast(
            `Le daemon a refusé la mise à jour — sauvegarde locale uniquement (${
              err instanceof Error ? err.message : String(err)
            })`,
          );
        }
      }
      setData(draft);
      saveProject(projectId, draft);
      setEditingId(null);
      setDraft(null);
      showToast("Configuration mise à jour");
    } finally {
      setSaving(false);
    }
  };
  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => { setToast(null); }, 2400);
  };

  const navigateTo = (id: SectionDef["id"]) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const addMcp = async () => {
    if (!mcpForm.name || !mcpForm.command) return;
    const entry: McpServerConfigEntry =
      mcpForm.type === "stdio"
        ? { type: "stdio", command: mcpForm.command, enabled: mcpForm.enabled }
        : { type: mcpForm.type, url: mcpForm.command, enabled: mcpForm.enabled };
    try {
      await upsertMcp(mcpForm.name, entry);
      setMcpForm({ name: "", type: "stdio", command: "", enabled: true });
      setModal(null);
      showToast("Serveur MCP ajouté");
    } catch (err) {
      showToast(
        `Échec de l'ajout MCP — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const onRemoveMcp = async (name: string) => {
    try {
      await removeMcp(name);
      showToast("Serveur MCP supprimé");
    } catch (err) {
      showToast(
        `Échec de la suppression MCP — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // Scroll-spy
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        let best: SectionDef["id"] | null = null;
        let bestRatio = 0;
        for (const e of entries) {
          if (e.intersectionRatio > bestRatio) {
            best = (e.target as HTMLElement).id as SectionDef["id"];
            bestRatio = e.intersectionRatio;
          }
        }
        if (best) setActiveSection(best);
      },
      { rootMargin: "-80px 0px -50% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => { obs.disconnect(); };
  }, []);

  if (!project) {
    return (
      <div className="st-app">
        <main style={{ padding: 32 }}>
          <p>
            Projet introuvable. <Link to="/projects">Retour</Link>.
          </p>
        </main>
      </div>
    );
  }

  const renderSection = (s: SectionDef) => {
    const editing = editingId === s.id;
    const editProps: SectionEditProps = {
      data,
      draft: draft ?? data,
      setDraft: (next) => { setDraft(next); },
      editing,
    };
    switch (s.id) {
      case "general":
        return <GeneralSection {...editProps} />;
      case "providers":
        return <ProvidersSection {...editProps} />;
      case "level":
        return <LevelSection {...editProps} />;
      case "delays":
        return <DelaysSection {...editProps} />;
      case "tools":
        return (
          <ToolsSection
            {...editProps}
            onAddMcp={() => { setModal("mcp"); }}
            onRemoveMcp={(name) => { void onRemoveMcp(name); }}
          />
        );
      case "budget":
        return <BudgetSection {...editProps} />;
      case "advanced":
        return <AdvancedSection {...editProps} />;
      case "danger":
        return (
          <DangerSection
            onPause={() => { setModal("pause"); }}
            onReset={() => { setModal("reset"); }}
            onDelete={() => {
              setDeleteConfirmName("");
              setModal("delete");
            }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="st-app">
      <header className="topbar">
        <div className="topbar-left">
          <Link to="/projects" className="brand">
            loomflo
          </Link>
          <div className="crumbs">
            <Link to="/projects">Projets</Link>
            <span className="sep">›</span>
            <Link to={`/projects/${project.id}/workflow`}>{project.name}</Link>
            <span className="sep">›</span>
            <strong>Configuration</strong>
          </div>
        </div>
        <div className="topbar-right">
          <button className="icon-btn" onClick={toggleTheme} aria-label="Basculer le thème">
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
          <h1>Configuration</h1>
          <div className="page-header-meta">
            <span>Toutes les modifications sont enregistrées localement.</span>
          </div>
        </div>
        <div className="page-header-right">
          <button
            className="btn ghost"
            onClick={() => { void navigate(`/projects/${project.id}/workflow`); }}
          >
            <Icon.ChevronLeft width="11" height="11" /> Retour au workflow
          </button>
        </div>
      </div>

      <div className="main">
        <nav className="sidebar" aria-label="Sections de configuration">
          <div className="sidebar-header">Sections</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`nav-item ${activeSection === s.id ? "active" : ""} ${
                s.danger ? "danger" : ""
              }`}
              onClick={() => { navigateTo(s.id); }}
              aria-current={activeSection === s.id ? "true" : undefined}
            >
              <span className="nav-icon">{s.icon}</span>
              <span>{s.title}</span>
            </button>
          ))}
        </nav>

        <main className="content" ref={contentRef}>
          {SECTIONS.map((s) => (
            <Section
              key={s.id}
              id={s.id}
              icon={s.icon}
              title={s.title}
              sub={s.sub}
              danger={s.danger}
              editing={editingId === s.id}
              canEdit={s.id !== "danger"}
              onEdit={() => { startEdit(s.id); }}
              onSave={() => {
                void saveEdit();
              }}
              saving={saving}
              onCancel={cancelEdit}
            >
              {renderSection(s)}
            </Section>
          ))}
        </main>
      </div>

      {toast && <Toast message={toast} />}

      <Modal
        open={modal === "pause"}
        icon={<Icon.Pause width="16" height="16" />}
        title={
          <>
            <h2>Pauser le workflow ?</h2>
            <p>
              Tous les workers en cours seront stoppés. Le workflow pourra être repris depuis la
              page Workflow.
            </p>
          </>
        }
        foot={
          <>
            <button className="btn ghost" onClick={() => { setModal(null); }}>
              Annuler
            </button>
            <button
              className="btn danger"
              disabled={pausing || !projectId}
              onClick={() => {
                if (!projectId) return;
                setPausing(true);
                void (async () => {
                  try {
                    await api.pauseWorkflow(projectId);
                    showToast("Workflow mis en pause");
                  } catch (err) {
                    showToast(
                      `Échec — ${err instanceof Error ? err.message : String(err)}`,
                    );
                  } finally {
                    setPausing(false);
                    setModal(null);
                  }
                })();
              }}
            >
              {pausing ? "…" : "Pauser"}
            </button>
          </>
        }
        onClose={() => { setModal(null); }}
      />

      <Modal
        open={modal === "reset"}
        icon={<Icon.RotateCcw width="16" height="16" />}
        title={
          <>
            <h2>Réinitialiser le workflow ?</h2>
            <p>
              L'état d'exécution sera effacé : nœuds, edges, logs et historique. La configuration
              de ce projet sera <strong>conservée</strong>.
            </p>
          </>
        }
        foot={
          <>
            <button className="btn ghost" onClick={() => { setModal(null); }}>
              Annuler
            </button>
            <button
              className="btn danger"
              onClick={() => {
                setModal(null);
                showToast("Workflow réinitialisé");
              }}
            >
              Réinitialiser
            </button>
          </>
        }
        onClose={() => { setModal(null); }}
      />

      <Modal
        open={modal === "delete"}
        icon={<Icon.AlertTriangle width="16" height="16" />}
        title={
          <>
            <h2>Supprimer ce projet ?</h2>
            <p>
              Cette action est irréversible. Toute la config et l'historique seront effacés. Les
              fichiers du dossier <code className="mono">{data.folder}</code> ne seront{" "}
              <strong>pas</strong> touchés.
            </p>
          </>
        }
        body={
          <>
            <label className="field-label">
              Pour confirmer, tape le nom du projet :{" "}
              <code className="mono">{data.name}</code>
            </label>
            <input
              className="input mono"
              placeholder={data.name}
              value={deleteConfirmName}
              onChange={(e) => { setDeleteConfirmName(e.target.value); }}
              autoFocus
            />
          </>
        }
        foot={
          <>
            <button className="btn ghost" onClick={() => { setModal(null); }}>
              Annuler
            </button>
            <button
              className="btn danger solid"
              disabled={deleteConfirmName !== data.name}
              onClick={() => {
                setModal(null);
                void (async () => {
                  try {
                    await store.remove(project.id);
                    showToast("Projet supprimé");
                    await navigate("/projects");
                  } catch (err) {
                    showToast(
                      `Échec — ${err instanceof Error ? err.message : String(err)}`,
                    );
                  }
                })();
              }}
            >
              <Icon.Trash width="11" height="11" /> Supprimer définitivement
            </button>
          </>
        }
        onClose={() => { setModal(null); }}
      />

      <Modal
        open={modal === "mcp"}
        icon={<Icon.Tool width="16" height="16" />}
        title={
          <>
            <h2>Ajouter un serveur MCP</h2>
            <p>Configure un serveur Model Context Protocol pour ce projet.</p>
          </>
        }
        body={
          <>
            <div className="field">
              <label className="field-label">Nom</label>
              <input
                className="input"
                placeholder="filesystem-mcp"
                value={mcpForm.name}
                onChange={(e) => { setMcpForm({ ...mcpForm, name: e.target.value }); }}
              />
            </div>
            <div className="field">
              <label className="field-label">Type</label>
              <select
                className="select"
                value={mcpForm.type}
                onChange={(e) =>
                  { setMcpForm({ ...mcpForm, type: e.target.value as McpServer["type"] }); }
                }
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse (Server-Sent Events)</option>
                <option value="http">http</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">Commande / URL</label>
              <input
                className="input mono"
                placeholder="npx @mcp/filesystem ./src"
                value={mcpForm.command}
                onChange={(e) => { setMcpForm({ ...mcpForm, command: e.target.value }); }}
              />
            </div>
            <div
              className="field row"
              style={{ alignItems: "center", justifyContent: "space-between" }}
            >
              <span>Activé pour ce projet</span>
              <Toggle
                on={mcpForm.enabled}
                onChange={(v) => { setMcpForm({ ...mcpForm, enabled: v }); }}
                ariaLabel="Activé"
              />
            </div>
          </>
        }
        foot={
          <>
            <button className="btn ghost" onClick={() => { setModal(null); }}>
              Annuler
            </button>
            <button
              className="btn primary"
              onClick={() => { void addMcp(); }}
              disabled={!mcpForm.name || !mcpForm.command || !draft}
            >
              <Icon.Plus width="11" height="11" /> Ajouter
            </button>
          </>
        }
        onClose={() => { setModal(null); }}
      />
    </div>
  );
}
