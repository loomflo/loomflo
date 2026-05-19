import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon.js";
import { useAppContext, useWsStatus } from "../context/AppContext.js";
import { useProjects, useStore } from "../context/ProjectStoreContext.js";
import { useTheme } from "../context/ThemeContext.js";
import type { UiProject, UiProjectStatus } from "../lib/types.js";
import "./ProjectsPage.css";

/* ============================================================================
   Time + path helpers (ported from loomflo-foundation.jsx)
   ============================================================================ */

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${String(m)} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${String(h)} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "hier";
  if (d < 7) return `il y a ${String(d)} j`;
  if (d < 30) return `il y a ${String(Math.floor(d / 7))} sem`;
  return `il y a ${String(Math.floor(d / 30))} mois`;
}

function truncatePath(p: string, maxLen = 42): string {
  if (!p) return "";
  if (p.length <= maxLen) return p;
  const segments = p.split("/");
  if (segments.length <= 3) return "…" + p.slice(-(maxLen - 1));
  const first = segments[1] ? `/${segments[1]}` : (segments[0] ?? "");
  const last = segments.slice(-2).join("/");
  let out = `${first}/…/${last}`;
  if (out.length > maxLen) out = `…/${last}`;
  return out;
}

/* ============================================================================
   Status pill
   ============================================================================ */

const STATUS_LABELS: Record<UiProjectStatus, string> = {
  pending: "en attente",
  init: "initialisation",
  spec: "spec en cours",
  building: "construction",
  running: "en cours",
  paused: "en pause",
  done: "terminé",
  failed: "échec",
};

const STATUS_SEMANTIC: Record<UiProjectStatus, string> = {
  pending: "pending",
  init: "pending",
  spec: "review",
  building: "running",
  running: "running",
  paused: "waiting",
  done: "done",
  failed: "failed",
};

interface StatusPillProps {
  status: UiProjectStatus;
}

function StatusPill({ status }: StatusPillProps) {
  return (
    <span className="lf-pill" data-status={STATUS_SEMANTIC[status]}>
      <span className="lf-pill-dot" data-pulse={status === "running" ? "1" : "0"} />
      <span className="lf-pill-label">{STATUS_LABELS[status]}</span>
    </span>
  );
}

/* ============================================================================
   Shimmer border — signature animation from the proto
   ============================================================================ */

interface ShimmerBorderProps {
  phase?: "spec" | "worker";
  active?: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  role?: string;
  tabIndex?: number;
}

function ShimmerBorder({
  phase = "worker",
  active = true,
  delay = 0,
  className = "",
  children,
  ...rest
}: ShimmerBorderProps & { [key: `data-${string}`]: string }) {
  const style = { "--shimmer-delay": `${String(delay)}s` } as CSSProperties;
  return (
    <div
      className={`lf-shimmer ${active ? "is-active" : ""} ${className}`.trim()}
      data-phase={phase}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ============================================================================
   Card subcomponents
   ============================================================================ */

interface NodeCount {
  spec: number;
  worker: number;
  done: number;
}

function NodeProgress({ count }: { count: NodeCount }) {
  const total = count.spec + count.worker;
  const pct = total === 0 ? 0 : Math.round((count.done / total) * 100);
  return (
    <div className="lf-progress">
      <div className="lf-progress-track">
        <div className="lf-progress-fill" style={{ width: `${String(pct)}%` }} />
      </div>
      <div className="lf-progress-meta">
        <span>
          <span className="lf-dot" data-phase="spec" /> spec {count.spec}
        </span>
        <span>
          <span className="lf-dot" data-phase="worker" /> worker {count.worker}
        </span>
        <span className="lf-mono">
          {count.done}/{total}
        </span>
      </div>
    </div>
  );
}

function MiniGraph({ count, isRunning }: { count: NodeCount; isRunning: boolean }) {
  const specDots = Array.from({ length: Math.min(count.spec, 5) });
  const workerDots = Array.from({ length: Math.min(count.worker, 8) });
  return (
    <svg className="lf-minigraph" viewBox="0 0 120 64" aria-hidden="true">
      <defs>
        <linearGradient id="lf-edge-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--color-phase-spec-edge)" stopOpacity="0.5" />
          <stop offset="1" stopColor="var(--color-phase-worker-edge)" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      {specDots.map((_, i) => {
        const cy = 8 + (i * 48) / Math.max(1, specDots.length - 1 || 1);
        return (
          <circle
            key={`s${String(i)}`}
            cx="14"
            cy={specDots.length === 1 ? 32 : cy}
            r="3.5"
            fill="var(--color-phase-spec-fg)"
          />
        );
      })}
      {workerDots.map((_, i) => {
        const isDone = i < count.done;
        const cy = 6 + (i * 52) / Math.max(1, workerDots.length - 1 || 1);
        return (
          <circle
            key={`w${String(i)}`}
            cx="80"
            cy={workerDots.length === 1 ? 32 : cy}
            r={isRunning && i === count.done ? 4.5 : 3.5}
            fill={isDone ? "var(--color-phase-worker-edge)" : "var(--color-phase-worker-bg)"}
            stroke="var(--color-phase-worker-fg)"
            strokeWidth={isDone ? 0 : 1}
            opacity={isDone ? 1 : 0.65}
            className={isRunning && i === count.done ? "lf-mini-running" : ""}
          />
        );
      })}
      {specDots.map((_, i) => {
        const cy = specDots.length === 1 ? 32 : 8 + (i * 48) / Math.max(1, specDots.length - 1 || 1);
        return (
          <path
            key={`e${String(i)}`}
            d={`M18 ${String(cy)} Q 50 ${String(cy - 4)} 76 32`}
            stroke="url(#lf-edge-grad)"
            strokeWidth="1"
            fill="none"
            opacity="0.45"
          />
        );
      })}
      <text x="14" y="60" textAnchor="middle" fontSize="7" fill="var(--fg-4)" fontFamily="var(--font-mono)">
        spec
      </text>
      <text x="80" y="60" textAnchor="middle" fontSize="7" fill="var(--fg-4)" fontFamily="var(--font-mono)">
        worker
      </text>
    </svg>
  );
}

/* ============================================================================
   Project card variations (A informative, B graph-forward, C minimal row)
   ============================================================================ */

type CardVariation = "A" | "B" | "C";
type Density = "roomy" | "balanced" | "dense";

interface ProjectCardProps {
  project: UiProject;
  density: Density;
  shimmerDelay: number;
  onOpen: () => void;
}

function ProjectCardA({ project, density, onOpen, shimmerDelay }: ProjectCardProps) {
  const isRunning = project.status === "running";
  return (
    <ShimmerBorder
      active={!isRunning}
      phase="worker"
      delay={shimmerDelay}
      className="lf-card lf-card--a"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      data-density={density}
    >
      <div className="lf-card-inner">
        <header className="lf-card-head">
          <div className="lf-card-title-row">
            <h3 className="lf-card-title">{project.name}</h3>
            <StatusPill status={project.status} />
          </div>
          <div className="lf-card-path lf-mono" title={project.projectPath}>
            <Icon.Folder width="11" height="11" />
            <span>{truncatePath(project.projectPath)}</span>
          </div>
        </header>

        <NodeProgress count={project.nodeCount} />

        {isRunning && project.runningNode && (
          <div className="lf-running-row">
            <span className="lf-running-glyph">
              <span className="lf-running-pulse" />
            </span>
            <span className="lf-running-label">
              <span className="lf-mono lf-running-node">{project.runningNode}</span>
              <span className="lf-running-agent lf-mono">agent: {project.runningAgent}</span>
            </span>
          </div>
        )}

        <footer className="lf-card-foot">
          <span className="lf-card-time">créé {relativeTime(project.createdAt)}</span>
          {project.createdBy === "cli" && (
            <span className="lf-cli-tag lf-mono">
              <Icon.Terminal width="10" height="10" /> cli
            </span>
          )}
          <span className="lf-card-cta">
            <Icon.ChevronRight width="14" height="14" />
          </span>
        </footer>
      </div>
    </ShimmerBorder>
  );
}

function ProjectCardB({ project, density, onOpen, shimmerDelay }: ProjectCardProps) {
  const isRunning = project.status === "running";
  return (
    <ShimmerBorder
      active={!isRunning}
      phase="worker"
      delay={shimmerDelay}
      className="lf-card lf-card--b"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      data-density={density}
    >
      <div className="lf-card-inner">
        <div className="lf-card-graph">
          <MiniGraph count={project.nodeCount} isRunning={isRunning} />
          {isRunning && (
            <div className="lf-graph-overlay">
              <span className="lf-pulse-mark" />
            </div>
          )}
        </div>
        <div className="lf-card-body">
          <div className="lf-card-title-row">
            <h3 className="lf-card-title">{project.name}</h3>
            <StatusPill status={project.status} />
          </div>
          <div className="lf-card-path lf-mono" title={project.projectPath}>
            <span>{truncatePath(project.projectPath)}</span>
          </div>
          <div className="lf-card-meta-row">
            <span className="lf-meta-chip lf-mono">
              <span className="lf-dot" data-phase="spec" />
              {project.nodeCount.spec}
            </span>
            <span className="lf-meta-chip lf-mono">
              <span className="lf-dot" data-phase="worker" />
              {project.nodeCount.worker}
            </span>
            <span className="lf-meta-chip lf-mono">
              <Icon.Check width="10" height="10" />
              {project.nodeCount.done}
            </span>
            <span className="lf-card-time">·  {relativeTime(project.lastActivityAt)}</span>
          </div>
        </div>
      </div>
    </ShimmerBorder>
  );
}

function ProjectCardC({ project, density, onOpen, shimmerDelay }: ProjectCardProps) {
  const isRunning = project.status === "running";
  const total = project.nodeCount.spec + project.nodeCount.worker;
  return (
    <ShimmerBorder
      active={!isRunning}
      phase="worker"
      delay={shimmerDelay}
      className="lf-card lf-card--c"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      data-density={density}
    >
      <div className="lf-card-inner">
        <div className="lf-c-top">
          <div className="lf-c-name">
            <h3 className="lf-card-title">{project.name}</h3>
            <span className="lf-card-time">{relativeTime(project.lastActivityAt)}</span>
          </div>
          <StatusPill status={project.status} />
        </div>
        <div className="lf-c-path lf-mono" title={project.projectPath}>
          {truncatePath(project.projectPath, 50)}
        </div>
        <div className="lf-c-bar">
          {Array.from({ length: total }).map((_, i) => {
            const isSpec = i < project.nodeCount.spec;
            const idxInPhase = isSpec ? i : i - project.nodeCount.spec;
            const phaseDone = isSpec ? 0 : project.nodeCount.done;
            const isDone = !isSpec && idxInPhase < phaseDone;
            const isLive = isRunning && !isSpec && idxInPhase === phaseDone;
            return (
              <span
                key={i}
                className={`lf-c-segment ${isLive ? "is-live" : ""}`}
                data-phase={isSpec ? "spec" : "worker"}
                data-state={isDone ? "done" : isLive ? "live" : "idle"}
              />
            );
          })}
        </div>
      </div>
    </ShimmerBorder>
  );
}

const CARD_VARIANTS: Record<CardVariation, ComponentType<ProjectCardProps>> = {
  A: ProjectCardA,
  B: ProjectCardB,
  C: ProjectCardC,
};

/* ============================================================================
   Project switcher + TopBar
   ============================================================================ */

interface ProjectSwitcherProps {
  activeProjectId: string | null;
  onSelect: (project: UiProject) => void;
  onAllProjects: () => void;
}

function ProjectSwitcher({ activeProjectId, onSelect, onAllProjects }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const projects = useProjects();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => { document.removeEventListener("mousedown", handle); };
  }, [open]);

  const active = projects.find((p) => p.id === activeProjectId);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
    return list.slice(0, 8);
  }, [projects, query]);

  return (
    <div className="lf-switcher" ref={ref}>
      <button
        className="lf-switcher-trigger"
        onClick={() => { setOpen((o) => !o); }}
        aria-expanded={open}
      >
        <Icon.Layers width="14" height="14" />
        <span className="lf-switcher-label">{active ? active.name : "Mes projets"}</span>
        <Icon.ChevronDown width="14" height="14" style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div className="lf-switcher-menu" role="menu">
          <div className="lf-switcher-search">
            <Icon.Search width="13" height="13" />
            <input
              type="text"
              autoFocus
              placeholder="Filtrer les projets…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); }}
            />
          </div>
          <div className="lf-switcher-list">
            {filtered.length === 0 && (
              <div className="lf-switcher-empty">Aucun projet trouvé</div>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                className={`lf-switcher-item ${p.id === activeProjectId ? "is-active" : ""}`}
                onClick={() => {
                  onSelect(p);
                  setOpen(false);
                }}
              >
                <span className="lf-switcher-item-name">{p.name}</span>
                <StatusPill status={p.status} />
              </button>
            ))}
          </div>
          <div className="lf-switcher-foot">
            <button
              className="lf-switcher-all"
              onClick={() => {
                onAllProjects();
                setOpen(false);
              }}
            >
              Voir tous les projets <Icon.ArrowRight width="12" height="12" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface TopBarProps {
  activeProjectId: string | null;
  onSelectProject: (project: UiProject) => void;
  onAllProjects: () => void;
  onOpenCommand: () => void;
}

export function TopBar({
  activeProjectId,
  onSelectProject,
  onAllProjects,
  onOpenCommand,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  return (
    <header className="lf-topbar">
      <div className="lf-topbar-left">
        <div className="lf-logo">
          <svg width="22" height="22" viewBox="0 0 34 34" aria-hidden="true">
            <circle cx="8" cy="8" r="3.5" fill="var(--color-phase-worker-edge)" />
            <circle cx="26" cy="8" r="3.5" fill="var(--color-phase-worker-fg)" />
            <circle cx="17" cy="20" r="3.5" fill="var(--color-phase-worker-edge)" />
            <circle cx="8" cy="28" r="2.6" fill="var(--color-phase-worker-fg)" />
            <circle cx="26" cy="28" r="2.6" fill="var(--color-phase-worker-fg)" />
            <path
              d="M8 8 L17 20 M26 8 L17 20 M17 20 L8 28 M17 20 L26 28"
              stroke="var(--color-phase-worker-edge)"
              strokeWidth="1.4"
              strokeLinecap="round"
              opacity="0.6"
              fill="none"
            />
          </svg>
          <span className="lf-wordmark">loomflo</span>
        </div>
        <span className="lf-topbar-divider" />
        <ProjectSwitcher
          activeProjectId={activeProjectId}
          onSelect={onSelectProject}
          onAllProjects={onAllProjects}
        />
      </div>
      <div className="lf-topbar-right">
        <button
          className="lf-cmdk-btn"
          onClick={onOpenCommand}
          aria-label="Ouvrir la palette de commandes"
        >
          <Icon.Search width="13" height="13" />
          <span className="lf-cmdk-text">Rechercher…</span>
          <kbd className="lf-kbd lf-mono">⌘K</kbd>
        </button>
        <button
          className="lf-icon-btn"
          onClick={toggleTheme}
          aria-label="Changer de thème"
        >
          {theme === "dark" ? (
            <Icon.Sun width="16" height="16" />
          ) : (
            <Icon.Moon width="16" height="16" />
          )}
        </button>
      </div>
    </header>
  );
}

/* ============================================================================
   Command palette
   ============================================================================ */

interface PaletteItem {
  kind: "project" | "action" | "nav" | "recent";
  id: string;
  label: string;
  sub?: string;
  icon: IconName;
  status?: UiProjectStatus;
  shortcut?: string;
  run: () => void;
}

interface PaletteSection {
  title: string;
  items: PaletteItem[];
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelectProject: (project: UiProject) => void;
  activeProjectId: string | null;
  onAction: (action: string, payload?: string) => void;
}

function CommandPalette({
  open,
  onClose,
  onSelectProject,
  activeProjectId,
  onAction,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const projects = useProjects();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const sections = useMemo<PaletteSection[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (label: string) => !q || label.toLowerCase().includes(q);
    const out: PaletteSection[] = [];

    const projectItems: PaletteItem[] = projects
      .filter((p) => matches(p.name) || matches(p.projectPath))
      .map((p) => ({
        kind: "project",
        id: "proj_" + p.id,
        label: p.name,
        sub: truncatePath(p.projectPath, 38),
        icon: "Layers",
        status: p.status,
        run: () => { onSelectProject(p); },
      }));
    if (projectItems.length) out.push({ title: "Projets", items: projectItems });

    const actionItems: PaletteItem[] = (
      [
        {
          kind: "action",
          id: "a_new",
          label: "Nouveau projet",
          sub: "Lancer le wizard de création",
          icon: "Plus",
          shortcut: "⌘N",
          run: () => { onAction("new-project"); },
        },
        {
          kind: "action",
          id: "a_theme",
          label: theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre",
          sub: "Bascule dark / light",
          icon: theme === "dark" ? "Sun" : "Moon",
          shortcut: "⌘\\",
          run: () => { onAction("toggle-theme"); },
        },
      ] as PaletteItem[]
    ).filter((a) => matches(a.label));
    if (actionItems.length) out.push({ title: "Actions", items: actionItems });

    if (activeProjectId) {
      const navItems: PaletteItem[] = (
        [
          {
            kind: "nav",
            id: "n_workflow",
            label: "Workflow",
            sub: "Voir le DAG",
            icon: "GitBranch",
            run: () => { onAction("nav", "workflow"); },
          },
          {
            kind: "nav",
            id: "n_brainstorm",
            label: "Brainstorm",
            sub: "Discussion avec Loom",
            icon: "MessageCircle",
            run: () => { onAction("nav", "brainstorm"); },
          },
          {
            kind: "nav",
            id: "n_settings",
            label: "Paramètres du projet",
            sub: "Configuration",
            icon: "Settings",
            run: () => { onAction("nav", "settings"); },
          },
        ] as PaletteItem[]
      ).filter((a) => matches(a.label));
      if (navItems.length) out.push({ title: "Projet actif", items: navItems });
    }

    const recentItems: PaletteItem[] = projects
      .filter((p) => p.status === "running")
      .filter((p) => matches("en cours " + p.name))
      .slice(0, 3)
      .map((p) => ({
        kind: "recent",
        id: "r_" + p.id,
        label: `Sauter au nœud actif — ${p.name}`,
        sub: p.runningNode || "nœud en cours",
        icon: "Activity",
        run: () => { onSelectProject(p); },
      }));
    if (recentItems.length) out.push({ title: "Activité récente", items: recentItems });

    return out;
  }, [query, projects, theme, activeProjectId, onAction, onSelectProject]);

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => {
    if (activeIdx >= flatItems.length) setActiveIdx(0);
  }, [flatItems.length, activeIdx]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatItems.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[activeIdx];
      if (item) {
        item.run();
        onClose();
      }
    }
  };

  if (!open) return null;

  let cursor = 0;
  return (
    <div className="lf-palette-backdrop" onClick={onClose}>
      <div
        className="lf-palette"
        role="dialog"
        aria-label="Palette de commandes"
        onClick={(e) => { e.stopPropagation(); }}
        onKeyDown={onKeyDown}
      >
        <div className="lf-palette-search">
          <Icon.Search width="16" height="16" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Tape une commande, un projet, une action…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
          />
          <kbd className="lf-kbd lf-mono">esc</kbd>
        </div>
        <div className="lf-palette-list">
          {sections.length === 0 && (
            <div className="lf-palette-empty">
              <Icon.Search width="22" height="22" />
              <p>
                Aucun résultat pour <span className="lf-mono">"{query}"</span>
              </p>
            </div>
          )}
          {sections.map((s) => (
            <div key={s.title} className="lf-palette-section">
              <div className="lf-palette-section-title">{s.title}</div>
              {s.items.map((item) => {
                const isActive = cursor === activeIdx;
                const myCursor = cursor++;
                const IconC: ComponentType<SVGProps<SVGSVGElement>> = Icon[item.icon];
                return (
                  <div
                    key={item.id}
                    className={`lf-palette-item ${isActive ? "is-active" : ""}`}
                    onMouseEnter={() => { setActiveIdx(myCursor); }}
                    onClick={() => {
                      item.run();
                      onClose();
                    }}
                  >
                    <span className="lf-palette-item-icon">
                      <IconC width="15" height="15" />
                    </span>
                    <span className="lf-palette-item-text">
                      <span className="lf-palette-item-label">{item.label}</span>
                      {item.sub && (
                        <span className="lf-palette-item-sub lf-mono">{item.sub}</span>
                      )}
                    </span>
                    {item.status && <StatusPill status={item.status} />}
                    {item.shortcut && (
                      <kbd className="lf-kbd lf-mono">{item.shortcut}</kbd>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="lf-palette-foot">
          <span>
            <kbd className="lf-kbd lf-mono">↑↓</kbd> naviguer
          </span>
          <span>
            <kbd className="lf-kbd lf-mono">↵</kbd> sélectionner
          </span>
          <span>
            <kbd className="lf-kbd lf-mono">esc</kbd> fermer
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   Empty state + Toast
   ============================================================================ */

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="lf-empty">
      <div className="lf-empty-illu">
        <svg width="220" height="140" viewBox="0 0 220 140" aria-hidden="true">
          {Array.from({ length: 11 }).map((_, x) =>
            Array.from({ length: 7 }).map((_, y) => (
              <circle
                key={`${String(x)}-${String(y)}`}
                cx={10 + x * 20}
                cy={10 + y * 20}
                r="1"
                fill="var(--border-1)"
              />
            )),
          )}
          <g className="lf-empty-graph">
            <path
              d="M50 70 Q 90 40 130 70 M50 70 Q 90 100 130 70 M130 70 L 180 50 M130 70 L 180 90"
              stroke="var(--color-phase-worker-edge)"
              strokeWidth="1.4"
              fill="none"
              strokeDasharray="3 4"
              opacity="0.55"
            />
            <circle
              cx="50"
              cy="70"
              r="9"
              fill="var(--color-phase-spec-bg)"
              stroke="var(--color-phase-spec-edge)"
              strokeWidth="1.4"
            />
            <circle
              cx="130"
              cy="70"
              r="11"
              fill="var(--bg-surface)"
              stroke="var(--color-phase-worker-edge)"
              strokeWidth="1.6"
            />
            <circle
              cx="180"
              cy="50"
              r="7"
              fill="var(--color-phase-worker-bg)"
              stroke="var(--color-phase-worker-edge)"
              strokeWidth="1.2"
            />
            <circle
              cx="180"
              cy="90"
              r="7"
              fill="var(--color-phase-worker-bg)"
              stroke="var(--color-phase-worker-edge)"
              strokeWidth="1.2"
            />
          </g>
        </svg>
      </div>
      <h2>Aucun projet pour le moment</h2>
      <p>
        Crée ton premier workflow d'agents en quelques secondes — Loom génère le DAG, les
        Loomas exécutent.
      </p>
      <button className="lf-btn lf-btn--primary lf-btn--lg" onClick={onCreate}>
        <Icon.Plus width="16" height="16" /> Créer un projet
      </button>
    </div>
  );
}

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="lf-toast" role="status">
      <Icon.Sparkles width="14" height="14" />
      <span>{message}</span>
    </div>
  );
}

/* ============================================================================
   Toast context — exposed for reuse by other pages on the same shell
   ============================================================================ */

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {
    /* placeholder */
  },
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

/* ============================================================================
   ProjectsPage — public route component
   ============================================================================ */

export function ProjectsPage() {
  const projects = useProjects();
  const store = useStore();
  const navigate = useNavigate();
  const { toggleTheme } = useTheme();
  const { token, useMock } = useAppContext();
  const wsStatus = useWsStatus();

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => { setToast(null); }, 3500);
  };

  useEffect(() => {
    const handle = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handle);
    return () => { window.removeEventListener("keydown", handle); };
  }, []);

  const goToProject = (project: UiProject) => {
    setActiveProjectId(project.id);
    if (project.workflowStatus === "init") void navigate(`/projects/${project.id}/brainstorm`);
    else void navigate(`/projects/${project.id}/workflow`);
  };

  const handleAction = (action: string, payload?: string) => {
    if (action === "new-project") void navigate("/projects/new/wizard");
    else if (action === "toggle-theme") toggleTheme();
    else if (action === "nav" && payload && activeProjectId) {
      void navigate(`/projects/${activeProjectId}/${payload}`);
    }
  };

  const variation: CardVariation = "A";
  const density: Density = "balanced";
  const Card = CARD_VARIANTS[variation];

  return (
    <ToastContext.Provider value={{ showToast }}>
      <div className="lf-app">
        <TopBar
          activeProjectId={activeProjectId}
          onSelectProject={goToProject}
          onAllProjects={() => { setActiveProjectId(null); }}
          onOpenCommand={() => { setPaletteOpen(true); }}
        />

        <main className="lf-main">
          {projects.length === 0 ? (
            <EmptyState onCreate={() => { void navigate("/projects/new/wizard"); }} />
          ) : (
            <div className="lf-projects" data-density={density}>
              <div className="lf-projects-head">
                <div>
                  <h1>Projets</h1>
                  <p className="lf-projects-sub">
                    {projects.length} projet{projects.length > 1 ? "s" : ""} ·{" "}
                    {token ? (
                      <>
                        daemon <span className="lf-mono">loomflo</span>{" "}
                        {wsStatus === "open"
                          ? "connecté"
                          : wsStatus === "connecting"
                            ? "connexion…"
                            : "hors-ligne"}
                      </>
                    ) : useMock ? (
                      "mode mock — fixtures /mock/*"
                    ) : (
                      "hors-ligne — données locales"
                    )}
                  </p>
                </div>
                <div className="lf-projects-actions" style={{ display: "flex", gap: 8 }}>
                  <button
                    className="lf-btn lf-btn--ghost"
                    onClick={() => {
                      store.reset();
                      showToast("Données mock réinitialisées");
                    }}
                  >
                    <Icon.RotateCcw width="13" height="13" /> Reset mock
                  </button>
                  <button
                    className="lf-btn lf-btn--primary"
                    onClick={() => { void navigate("/projects/new/wizard"); }}
                  >
                    <Icon.Plus width="14" height="14" /> Nouveau projet
                  </button>
                </div>
              </div>

              <div className="lf-projects-grid" data-variation={variation}>
                {projects.map((p, i) => (
                  <Card
                    key={p.id}
                    project={p}
                    density={density}
                    shimmerDelay={(i * 0.83) % 6}
                    onOpen={() => { goToProject(p); }}
                  />
                ))}
              </div>
            </div>
          )}
        </main>

        <CommandPalette
          open={paletteOpen}
          onClose={() => { setPaletteOpen(false); }}
          onSelectProject={(p) => {
            setActiveProjectId(p.id);
            goToProject(p);
          }}
          activeProjectId={activeProjectId}
          onAction={handleAction}
        />
        <Toast message={toast} />
      </div>
    </ToastContext.Provider>
  );
}
