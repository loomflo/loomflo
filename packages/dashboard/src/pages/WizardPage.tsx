import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { useStore } from "../context/ProjectStoreContext.js";
import { useApi, useAppContext } from "../context/AppContext.js";
import { useRuntimeAvailability } from "../hooks/useRuntimes.js";
import type { AgentCliName, CliAvailability, ProviderProfilePayload } from "../lib/types.js";
import { useTheme } from "../context/ThemeContext.js";
import "./WizardPage.css";

/* ============================================================================
   Provider config
   ============================================================================ */

type ApiProviderId = "anthropic" | "openai" | "moonshot";
type CliAgentId = "claude-code" | "copilot" | "codex";
type ProviderId = ApiProviderId | CliAgentId | null;

function isApiProvider(p: ProviderId): p is ApiProviderId {
  return p === "anthropic" || p === "openai" || p === "moonshot";
}

function buildProviderPayload(
  provider: ApiProviderId,
  apiKey: string,
): ProviderProfilePayload {
  switch (provider) {
    case "anthropic":
      return { type: "anthropic", apiKey };
    case "openai":
    case "moonshot":
      return { type: provider, apiKey };
  }
}

const PROVIDER_GLYPH: Record<NonNullable<ProviderId>, string> = {
  anthropic: "A",
  openai: "O",
  moonshot: "M",
  "claude-code": "CC",
  copilot: "CP",
  codex: "CX",
};

const CLI_INFO: Record<
  CliAgentId,
  { name: string; install: string; docs: string; loginCmd: string }
> = {
  "claude-code": {
    name: "Claude Code",
    install: "npm install -g @anthropic-ai/claude-code",
    docs: "https://docs.anthropic.com/claude/docs/claude-code",
    loginCmd: "claude login",
  },
  copilot: {
    name: "Copilot CLI",
    install: "gh extension install github/gh-copilot",
    docs: "https://github.com/github/copilot-cli",
    loginCmd: "gh auth login",
  },
  codex: {
    name: "Codex CLI",
    install: "npm install -g @openai/codex",
    docs: "https://github.com/openai/codex-cli",
    loginCmd: "codex login",
  },
};

/* ============================================================================
   Live CLI detection — sourced from GET /runtimes/availability
   ============================================================================ */

type CliState = Partial<Record<CliAgentId, CliAvailability>>;

const EMPTY_CLI_AVAILABILITY: CliAvailability = { installed: false, authenticated: false };

function asCliState(clis: Partial<Record<AgentCliName, CliAvailability>>): CliState {
  return {
    "claude-code": clis["claude-code"],
    copilot: clis.copilot,
    codex: clis.codex,
  };
}

/* ============================================================================
   Draft persistence
   ============================================================================ */

const DRAFT_KEY = "loomflo.wizardDraft";
const credKey = (p: string) => `loomflo.credentials.${p}`;

type DelayUnit = "seconds" | "minutes" | "hours" | "days";
type DelayPreset = "instant" | "1m" | "10m" | "30m" | "1h" | "2h" | "4h" | "8h" | "1d" | "custom";
type LevelId = "minimal" | "standard" | "complete";
type ProjectType = "scratch" | "feature";

interface WizardAdvanced {
  reviewer: boolean;
  maxRetries: number;
  retryStrategy: "adaptive" | "identical";
  maxWorkers: number;
}

interface WizardDraft {
  step: number;
  folder: string;
  primaryProvider: ProviderId;
  level: LevelId;
  advanced: WizardAdvanced;
  delayPreset: DelayPreset;
  customDelay: { value: number; unit: DelayUnit };
  name: string;
  type: ProjectType;
}

const DEFAULT_DRAFT: WizardDraft = {
  step: 1,
  folder: "",
  primaryProvider: null,
  level: "standard",
  advanced: { reviewer: true, maxRetries: 3, retryStrategy: "adaptive", maxWorkers: 4 },
  delayPreset: "10m",
  customDelay: { value: 30, unit: "minutes" },
  name: "",
  type: "scratch",
};

function loadDraft(): WizardDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...DEFAULT_DRAFT, ...(JSON.parse(raw) as Partial<WizardDraft>) };
  } catch {
    /* localStorage unavailable */
  }
  return { ...DEFAULT_DRAFT };
}
function saveDraft(d: WizardDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* localStorage unavailable */
  }
}

/* ============================================================================
   Helpers
   ============================================================================ */

const STEPS = [
  { num: 1, label: "Dossier" },
  { num: 2, label: "Provider" },
  { num: 3, label: "Niveau" },
  { num: 4, label: "Délai" },
  { num: 5, label: "Identité" },
  { num: 6, label: "Récapitulatif" },
];

interface DelayPresetEntry {
  id: Exclude<DelayPreset, "custom">;
  label: string;
  tag: string;
}

const DELAY_PRESETS: DelayPresetEntry[] = [
  { id: "instant", label: "Instantané", tag: "sans délai" },
  { id: "1m", label: "1 min", tag: "rapide" },
  { id: "10m", label: "10 min", tag: "recommandé" },
  { id: "30m", label: "30 min", tag: "mesuré" },
  { id: "1h", label: "1 h", tag: "mesuré" },
  { id: "2h", label: "2 h", tag: "patient" },
  { id: "4h", label: "4 h", tag: "patient" },
  { id: "8h", label: "8 h", tag: "lent" },
  { id: "1d", label: "1 jour", tag: "lent" },
];

interface LevelEntry {
  id: LevelId;
  numeral: string;
  name: string;
  desc: string;
  nodes: string;
  duration: string;
  cost: string;
}

const LEVELS: LevelEntry[] = [
  {
    id: "minimal",
    numeral: "I",
    name: "Minimal",
    desc: "1 agent spec, 1 worker, sans review. Idéal pour les itérations rapides ou les bugfixes.",
    nodes: "~3 nœuds",
    duration: "~5 min",
    cost: "< 0.10€",
  },
  {
    id: "standard",
    numeral: "II",
    name: "Standard",
    desc: "Spec en 3 étapes, plusieurs workers en parallèle, review activé. Bon pour les features moyennes.",
    nodes: "~8 nœuds",
    duration: "~30 min",
    cost: "~1€",
  },
  {
    id: "complete",
    numeral: "III",
    name: "Complet",
    desc: "Spec exhaustive en 5 étapes, retries multiples, review systématique. Pour les projets critiques ou complexes.",
    nodes: "~15 nœuds",
    duration: "~2 h",
    cost: "~5€",
  },
];

function pathTail(path: string): string {
  if (!path) return "";
  const cleaned = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
function isValidPath(p: string): boolean {
  if (!p) return false;
  return /^(\/|[A-Za-z]:[\\/])/.test(p);
}
function isValidName(n: string): boolean {
  return /^[a-z0-9-]{3,60}$/.test(n);
}
function formatDelay(d: WizardDraft): string {
  const presetMap: Record<DelayPreset, string> = {
    instant: "Instantané",
    "1m": "1 minute",
    "10m": "10 minutes",
    "30m": "30 minutes",
    "1h": "1 heure",
    "2h": "2 heures",
    "4h": "4 heures",
    "8h": "8 heures",
    "1d": "1 jour",
    custom: "",
  };
  if (d.delayPreset !== "custom") return presetMap[d.delayPreset];
  const labels: Record<DelayUnit, string> = {
    seconds: "s",
    minutes: "min",
    hours: "h",
    days: "j",
  };
  return `${String(d.customDelay.value)} ${labels[d.customDelay.unit]}`;
}
function detectCli(name: CliAgentId, state: CliState): CliAvailability {
  return state[name] ?? EMPTY_CLI_AVAILABILITY;
}
function providerIsValid(
  p: ProviderId,
  creds: Record<ApiProviderId, string>,
  cliState: CliState,
): boolean {
  if (!p) return false;
  if (p === "anthropic" || p === "openai" || p === "moonshot") return !!creds[p];
  const d = detectCli(p, cliState);
  return d.installed && d.authenticated;
}

/* ============================================================================
   Created confirmation
   ============================================================================ */

interface CreatedProject {
  id: string;
  name: string;
}

function CreatedScreen({
  project,
  onAgain,
  onGo,
}: {
  project: CreatedProject;
  onAgain: () => void;
  onGo: () => void;
}) {
  return (
    <div className="wizard" style={{ gridTemplateColumns: "1fr", justifyItems: "center" }}>
      <main
        className="stage"
        style={{ alignItems: "center", justifyContent: "center", padding: "120px 24px" }}
      >
        <div
          className="stage-inner"
          style={{ alignItems: "center", textAlign: "center", maxWidth: 520 }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              background: "var(--color-phase-worker-bg)",
              border:
                "1px solid color-mix(in oklab, var(--color-phase-worker-edge) 40%, transparent)",
              color: "var(--color-phase-worker-edge)",
              display: "grid",
              placeItems: "center",
              marginBottom: 18,
            }}
          >
            <Icon.Check width="32" height="32" />
          </div>
          <h2 className="step-title" style={{ marginBottom: 8 }}>
            Projet créé
          </h2>
          <p className="step-subtitle" style={{ textAlign: "center", maxWidth: "unset" }}>
            <code className="mono">{project.name}</code> est prêt. Loom va lancer le brainstorming.
          </p>
          <div className="recap" style={{ marginTop: 24, width: "100%", textAlign: "left" }}>
            <div className="recap-row">
              <span className="recap-key">ID</span>
              <span className="recap-val">
                <code>{project.id}</code>
              </span>
              <span />
            </div>
            <div className="recap-row">
              <span className="recap-key">Route</span>
              <span className="recap-val">
                <code>/projects/{project.id}/brainstorm</code>
              </span>
              <span />
            </div>
            <div className="recap-row">
              <span className="recap-key">Statut</span>
              <span className="recap-val">
                <span className="badge badge--ok">
                  <span className="dot" />
                  init
                </span>
              </span>
              <span />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            <button className="btn btn--ghost" onClick={onAgain}>
              <Icon.ChevronLeft width="14" height="14" /> Recommencer le wizard
            </button>
            <button className="btn btn--primary" onClick={onGo}>
              Aller au brainstorming <Icon.ChevronRight width="14" height="14" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ============================================================================
   Sub-step components
   ============================================================================ */

interface StepProps {
  draft: WizardDraft;
  setDraft: (patch: Partial<WizardDraft> | ((d: WizardDraft) => WizardDraft)) => void;
}

function Step1({ draft, setDraft }: StepProps) {
  const valid = isValidPath(draft.folder);
  return (
    <div className="col gap-md">
      <div className="field">
        <label className="field-label" htmlFor="folder-input">
          Dossier du projet
        </label>
        <div className="row">
          <div className="input-wrap" style={{ flex: 1 }}>
            <input
              id="folder-input"
              className="input input--mono"
              value={draft.folder}
              onChange={(e) => { setDraft({ folder: e.target.value }); }}
              placeholder="~/projects/mon-projet"
              spellCheck={false}
              autoFocus
            />
            {valid && (
              <span className="input-suffix">
                <Icon.Check width="16" height="16" />
              </span>
            )}
          </div>
          <button className="btn" disabled title="Sélecteur natif bientôt disponible">
            <Icon.Folder width="16" height="16" /> Parcourir
          </button>
        </div>
        <span className="field-help">
          Si tu lances le CLI dans un dossier, cette valeur sera pré-remplie automatiquement.
          Le dossier sera créé s'il n'existe pas.
        </span>
        {!valid && draft.folder.length > 0 && (
          <span className="field-error">Chemin absolu requis (ex: /Users/... ou C:\...).</span>
        )}
      </div>
    </div>
  );
}

interface Step2Props extends StepProps {
  creds: Record<ApiProviderId, string>;
  cliState: CliState;
  onOpenCred: (p: ApiProviderId) => void;
  onOpenInstall: (p: CliAgentId) => void;
  onLoginRequest: (name: CliAgentId) => void;
}

function Step2({
  draft,
  setDraft,
  creds,
  cliState,
  onOpenCred,
  onOpenInstall,
  onLoginRequest,
}: Step2Props) {
  const apiProviders: { id: ApiProviderId; name: string }[] = [
    { id: "anthropic", name: "Anthropic" },
    { id: "openai", name: "OpenAI" },
    { id: "moonshot", name: "Moonshot" },
  ];
  const cliAgents: { id: CliAgentId; name: string }[] = [
    { id: "claude-code", name: "Claude Code" },
    { id: "copilot", name: "Copilot CLI" },
    { id: "codex", name: "Codex CLI" },
  ];
  const select = (id: ProviderId) => { setDraft({ primaryProvider: id }); };
  const shimmerStyle = (): CSSProperties =>
    ({ "--shimmer-delay": `${String(-Math.random() * 6)}s` }) as CSSProperties;

  return (
    <div className="col gap-md">
      <div className="section-divider">
        <h4 className="section-label">Clés API</h4>
      </div>
      <div className="card-group" data-cols="3">
        {apiProviders.map((p) => {
          const configured = !!creds[p.id];
          const selected = draft.primaryProvider === p.id;
          return (
            <button
              key={p.id}
              className="scard cred-card shimmer"
              data-phase="worker"
              data-selected={selected}
              style={shimmerStyle()}
              onClick={() => { if (configured) select(p.id); else onOpenCred(p.id); }}
              title={!configured ? "Configure la clé API pour sélectionner ce provider" : ""}
            >
              <div className="cred-head">
                <div className="provider-mark" data-p={p.id}>
                  {PROVIDER_GLYPH[p.id]}
                </div>
                <div className="cred-name">{p.name}</div>
              </div>
              <div className="cred-status-row">
                {configured ? (
                  <span className="badge badge--ok">
                    <span className="dot" />
                    Configuré
                  </span>
                ) : (
                  <span className="badge badge--muted">
                    <span className="dot" />
                    Non configuré
                  </span>
                )}
                <button
                  className="cred-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCred(p.id);
                  }}
                >
                  {configured ? "Modifier" : "Ajouter"}{" "}
                  <Icon.ChevronRight width="12" height="12" />
                </button>
              </div>
              {configured && (
                <div className="radio-row">
                  <span className="radio-mark" data-on={selected} />
                  Provider primaire
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="section-divider">
        <h4 className="section-label">Agents CLI (OAuth)</h4>
      </div>
      <div className="card-group" data-cols="3">
        {cliAgents.map((a) => {
          const d = detectCli(a.id, cliState);
          const selected = draft.primaryProvider === a.id;
          const eligible = d.installed && d.authenticated;
          return (
            <button
              key={a.id}
              className="scard cred-card cli-card shimmer"
              data-phase="spec"
              data-selected={selected}
              style={shimmerStyle()}
              onClick={() => {
                if (eligible) select(a.id);
                else if (d.installed && !d.authenticated) onLoginRequest(a.id);
                else onOpenInstall(a.id);
              }}
              title={!eligible ? "Installe et connecte-toi pour sélectionner cet agent" : ""}
            >
              <div className="cred-head">
                <div className="provider-mark" data-p={a.id}>
                  {PROVIDER_GLYPH[a.id]}
                </div>
                <div className="cred-name">{a.name}</div>
              </div>
              <div className="cred-status-row">
                {d.installed && d.authenticated && (
                  <span className="badge badge--ok">
                    <Icon.Check width="10" height="10" />
                    Installé · Connecté
                  </span>
                )}
                {d.installed && !d.authenticated && (
                  <span className="badge badge--warn">
                    <Icon.AlertTriangle width="12" height="12" />
                    Installé · Non connecté
                  </span>
                )}
                {!d.installed && (
                  <span className="badge badge--err">
                    <Icon.XCircle width="12" height="12" />
                    Non installé
                  </span>
                )}
                {d.installed && !d.authenticated && (
                  <button
                    className="cred-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoginRequest(a.id);
                    }}
                  >
                    Se connecter
                  </button>
                )}
                {!d.installed && (
                  <button
                    className="cred-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenInstall(a.id);
                    }}
                  >
                    Voir l'installation
                  </button>
                )}
              </div>
              {eligible && (
                <div className="radio-row">
                  <span className="radio-mark" data-on={selected} />
                  Provider primaire
                </div>
              )}
              {d.version && eligible && (
                <span
                  className="caption mono"
                  style={{ fontSize: 10, color: "var(--fg-5)" }}
                >
                  v{d.version}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface Step3Props extends StepProps {
  advancedOpen: boolean;
  setAdvancedOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
}

function Step3({ draft, setDraft, advancedOpen, setAdvancedOpen }: Step3Props) {
  const shimmerStyle = (): CSSProperties =>
    ({ "--shimmer-delay": `${String(-Math.random() * 6)}s` }) as CSSProperties;
  return (
    <div className="col gap-md">
      <div className="card-group" data-cols="3">
        {LEVELS.map((l) => {
          const selected = draft.level === l.id;
          return (
            <button
              key={l.id}
              className="scard level-card shimmer"
              data-phase="worker"
              data-selected={selected}
              style={shimmerStyle()}
              onClick={() => { setDraft({ level: l.id }); }}
            >
              <div className="level-numeral">{l.numeral}</div>
              <div className="level-body">
                <div className="level-name">{l.name}</div>
                <p className="level-desc">{l.desc}</p>
                <div className="level-stats">
                  <span>{l.nodes}</span>
                  <span>
                    <Icon.Clock width="12" height="12" />
                    {l.duration}
                  </span>
                  <span>{l.cost}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <button
        className="advanced-toggle"
        data-open={advancedOpen}
        onClick={() => { setAdvancedOpen((o) => !o); }}
      >
        <Icon.ChevronRight width="14" height="14" />
        <Icon.Settings width="14" height="14" /> Configuration personnalisée
      </button>

      {advancedOpen && (
        <div className="advanced-panel">
          <div className="adv-field">
            <span className="adv-label">Reviewer</span>
            <span className="row-spread">
              <span className="caption">Active la passe de revue qualité</span>
              <button
                className="switch"
                data-on={draft.advanced.reviewer}
                onClick={() =>
                  { setDraft((d) => ({
                    ...d,
                    advanced: { ...d.advanced, reviewer: !d.advanced.reviewer },
                  })); }
                }
                aria-pressed={draft.advanced.reviewer}
              />
            </span>
          </div>
          <div className="adv-field">
            <span className="adv-label">Max retries par nœud</span>
            <div className="slider-wrap">
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                className="slider"
                value={draft.advanced.maxRetries}
                onChange={(e) =>
                  { setDraft((d) => ({
                    ...d,
                    advanced: { ...d.advanced, maxRetries: Number(e.target.value) },
                  })); }
                }
              />
              <span className="slider-val">{draft.advanced.maxRetries}</span>
            </div>
          </div>
          <div className="adv-field">
            <span className="adv-label">Stratégie de retry</span>
            <select
              className="select"
              value={draft.advanced.retryStrategy}
              onChange={(e) =>
                { setDraft((d) => ({
                  ...d,
                  advanced: {
                    ...d.advanced,
                    retryStrategy: e.target.value as WizardAdvanced["retryStrategy"],
                  },
                })); }
              }
            >
              <option value="adaptive">Adaptative — modifie le prompt</option>
              <option value="identical">Identique — relance tel quel</option>
            </select>
          </div>
          <div className="adv-field">
            <span className="adv-label">Workers max par Loomi</span>
            <div className="slider-wrap">
              <input
                type="range"
                min="1"
                max="12"
                step="1"
                className="slider"
                value={draft.advanced.maxWorkers}
                onChange={(e) =>
                  { setDraft((d) => ({
                    ...d,
                    advanced: { ...d.advanced, maxWorkers: Number(e.target.value) },
                  })); }
                }
              />
              <span className="slider-val">
                {draft.advanced.maxWorkers === 12 ? "∞" : draft.advanced.maxWorkers}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Step4({ draft, setDraft }: StepProps) {
  const isCustom = draft.delayPreset === "custom";
  const unitLabel: Record<DelayUnit, string> = {
    seconds: "s",
    minutes: "min",
    hours: "h",
    days: "j",
  };
  const preview = `Délai : ${String(draft.customDelay.value || 0)} ${unitLabel[draft.customDelay.unit]}`;
  const shimmerStyle = (): CSSProperties =>
    ({ "--shimmer-delay": `${String(-Math.random() * 6)}s` }) as CSSProperties;
  return (
    <div className="col gap-md">
      <div className="delay-grid">
        {DELAY_PRESETS.map((p) => (
          <button
            key={p.id}
            className="delay-card shimmer"
            data-phase="worker"
            data-selected={draft.delayPreset === p.id}
            data-recommended={p.id === "10m"}
            style={shimmerStyle()}
            onClick={() => { setDraft({ delayPreset: p.id }); }}
          >
            <span className="delay-value">{p.label}</span>
            <span className="delay-tag">{p.tag}</span>
          </button>
        ))}
      </div>

      <div className="custom-delay" data-active={isCustom}>
        <label className="field-label" htmlFor="custom-delay-num">
          Personnalisé
        </label>
        <input
          id="custom-delay-num"
          type="number"
          min="0"
          className="input num"
          value={draft.customDelay.value}
          onChange={(e) =>
            { setDraft({
              delayPreset: "custom",
              customDelay: { ...draft.customDelay, value: Number(e.target.value) },
            }); }
          }
          onFocus={() => { setDraft({ delayPreset: "custom" }); }}
        />
        <select
          className="select"
          value={draft.customDelay.unit}
          onChange={(e) =>
            { setDraft({
              delayPreset: "custom",
              customDelay: { ...draft.customDelay, unit: e.target.value as DelayUnit },
            }); }
          }
        >
          <option value="seconds">secondes</option>
          <option value="minutes">minutes</option>
          <option value="hours">heures</option>
          <option value="days">jours</option>
        </select>
        {isCustom && <span className="preview">{preview}</span>}
      </div>

      <p className="field-help" style={{ marginTop: 4 }}>
        Le délai s'écoule entre la fin d'un nœud et le démarrage du suivant. Permet d'étaler les
        coûts, de revoir le travail, ou d'attendre des inputs externes.
      </p>
    </div>
  );
}

function Step5({ draft, setDraft }: StepProps) {
  const valid = isValidName(draft.name);
  const suggested = slugify(pathTail(draft.folder) || "projet");
  const useSuggestion = () => { setDraft({ name: suggested }); };
  const shimmerStyle = (): CSSProperties =>
    ({ "--shimmer-delay": `${String(-Math.random() * 6)}s` }) as CSSProperties;
  return (
    <div className="col gap-md">
      <div className="field">
        <label className="field-label" htmlFor="name-input">
          Nom du projet
        </label>
        <div className="row">
          <div className="input-wrap" style={{ flex: 1 }}>
            <input
              id="name-input"
              className="input input--mono"
              value={draft.name}
              onChange={(e) => { setDraft({ name: e.target.value }); }}
              placeholder="mon-projet"
              spellCheck={false}
              autoFocus
            />
            {valid && (
              <span className="input-suffix">
                <Icon.Check width="16" height="16" />
              </span>
            )}
          </div>
          {suggested && suggested !== draft.name && (
            <button
              className="btn"
              onClick={useSuggestion}
              title="Basé sur le dernier segment du dossier"
            >
              Utiliser{" "}
              <code className="mono" style={{ marginLeft: 6 }}>
                {suggested}
              </code>
            </button>
          )}
        </div>
        <span className="url-preview">
          loomflo://projets/<b>{draft.name || "…"}</b>
        </span>
        {!valid && draft.name.length > 0 && (
          <span className="field-error">
            3-60 caractères, minuscules, chiffres et tirets uniquement.
          </span>
        )}
        {draft.name.length === 0 && (
          <span className="field-help">
            Slug-friendly. Ex: <code className="mono">mon-projet</code>,{" "}
            <code className="mono">api-service</code>.
          </span>
        )}
      </div>

      <div className="card-group" data-cols="2">
        <button
          className="scard type-card shimmer"
          data-phase="worker"
          data-selected={draft.type === "scratch"}
          style={shimmerStyle()}
          onClick={() => { setDraft({ type: "scratch" }); }}
        >
          <div className="type-icon">
            <Icon.Sparkles width="20" height="20" />
          </div>
          <div className="type-name">Nouveau projet</div>
          <p className="type-desc">
            Loom partira d'une page blanche pour t'aider à concevoir le projet.
          </p>
        </button>
        <button
          className="scard type-card shimmer"
          data-phase="spec"
          data-selected={draft.type === "feature"}
          style={shimmerStyle()}
          onClick={() => { setDraft({ type: "feature" }); }}
        >
          <div className="type-icon">
            <Icon.GitBranch width="20" height="20" />
          </div>
          <div className="type-name">Ajouter une feature</div>
          <p className="type-desc">
            Loom analysera d'abord ton projet existant, puis t'aidera à concevoir la nouvelle
            feature.
          </p>
        </button>
      </div>
    </div>
  );
}

interface Step6Props {
  draft: WizardDraft;
  onJumpTo: (step: number) => void;
  onCreate: () => void;
  creating?: boolean;
  createError?: string | null;
}

function Step6({ draft, onJumpTo, onCreate, creating, createError }: Step6Props) {
  const providerLabels: Record<NonNullable<ProviderId>, string> = {
    anthropic: "Anthropic API",
    openai: "OpenAI API",
    moonshot: "Moonshot API",
    "claude-code": "Claude Code (OAuth)",
    copilot: "Copilot CLI (OAuth)",
    codex: "Codex CLI (OAuth)",
  };
  const levelObj = LEVELS.find((l) => l.id === draft.level);
  const typeLabel =
    draft.type === "scratch" ? "Nouveau projet (from scratch)" : "Ajouter une feature";

  const rows: { key: string; val: ReactNode; jump: number }[] = [
    { key: "Dossier", val: <code>{draft.folder}</code>, jump: 1 },
    {
      key: "Provider primaire",
      val: <>{draft.primaryProvider ? providerLabels[draft.primaryProvider] : "—"}</>,
      jump: 2,
    },
    {
      key: "Niveau",
      val: (
        <>
          {levelObj?.name}
          <span className="meta">
            {levelObj?.nodes} · {levelObj?.duration}
          </span>
        </>
      ),
      jump: 3,
    },
    { key: "Délai entre nœuds", val: formatDelay(draft), jump: 4 },
    { key: "Nom", val: <code>{draft.name}</code>, jump: 5 },
    { key: "Type", val: typeLabel, jump: 5 },
  ];

  return (
    <div className="col gap-md">
      <div className="recap">
        {rows.map((r, i) => (
          <div className="recap-row" key={i}>
            <span className="recap-key">{r.key}</span>
            <span className="recap-val">{r.val}</span>
            <button className="recap-edit" onClick={() => { onJumpTo(r.jump); }}>
              Modifier
            </button>
          </div>
        ))}
      </div>

      <button
        className="btn btn--primary create-cta"
        onClick={onCreate}
        disabled={creating === true}
      >
        {creating === true
          ? "Création du projet…"
          : "Créer le projet et commencer le brainstorming"}{" "}
        <Icon.ChevronRight width="16" height="16" />
      </button>
      {createError && (
        <span
          className="field-help"
          style={{ textAlign: "center", color: "var(--color-loom-error, #c33)" }}
          role="alert"
        >
          Création impossible — {createError}
        </span>
      )}
      <span className="field-help" style={{ textAlign: "center" }}>
        Le projet sera marqué <code className="mono">workflowStatus: 'init'</code> et tu seras
        redirigé vers <code className="mono">/projects/:id/brainstorm</code>.
      </span>
    </div>
  );
}

/* ============================================================================
   Modals + drawer
   ============================================================================ */

const PROVIDER_NAMES: Record<ApiProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  moonshot: "Moonshot",
};
const PROVIDER_HINTS: Record<ApiProviderId, string> = {
  anthropic: "Format attendu : commence par sk-ant-…",
  openai: "Format attendu : commence par sk-…",
  moonshot: "Format attendu : commence par sk-…",
};

function CredentialModal({
  provider,
  existing,
  onSave,
  onClose,
}: {
  provider: ApiProviderId;
  existing: string;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(existing || "");
  const [show, setShow] = useState(false);
  const valid = val.trim().length > 8;
  const isEditing = !!existing;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => { e.stopPropagation(); }} role="dialog">
        <h3>
          {isEditing ? "Modifier" : "Ajouter"} la clé {PROVIDER_NAMES[provider]}
        </h3>
        <p>{PROVIDER_HINTS[provider]} La clé est stockée en local, jamais envoyée.</p>
        <div className="field">
          <label className="field-label">Clé API</label>
          <div className="password-row">
            <input
              className="input input--mono"
              type={show ? "text" : "password"}
              value={val}
              onChange={(e) => { setVal(e.target.value); }}
              placeholder="sk-…"
              autoFocus
              spellCheck={false}
            />
            <button
              className="password-toggle"
              onClick={() => { setShow((s) => !s); }}
              aria-label={show ? "Masquer" : "Afficher"}
            >
              {show ? (
                <Icon.EyeOff width="16" height="16" />
              ) : (
                <Icon.Eye width="16" height="16" />
              )}
            </button>
          </div>
        </div>
        <div className="modal-actions">
          {isEditing && (
            <button
              className="btn"
              onClick={() => { onSave(""); }}
              style={{
                marginRight: "auto",
                color: "var(--status-failed-fg)",
                borderColor: "transparent",
              }}
            >
              Supprimer la clé
            </button>
          )}
          <button className="btn btn--ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn--primary"
            disabled={!valid}
            onClick={() => { onSave(val.trim()); }}
          >
            <Icon.Check width="14" height="14" /> Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

function InstallDrawer({
  cli,
  onClose,
  onCopy,
}: {
  cli: CliAgentId;
  onClose: () => void;
  onCopy: (cmd: string) => void;
}) {
  const info = CLI_INFO[cli];
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog">
        <div className="drawer-head">
          <div>
            <h3>Installer {info.name}</h3>
            <p>Lance la commande dans ton terminal, puis reviens et clique « Se connecter ».</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon.X width="16" height="16" />
          </button>
        </div>
        <div className="drawer-body">
          <div className="field">
            <span className="field-label">1. Installation</span>
            <div className="code-block">
              {info.install}
              <button
                className="code-copy"
                onClick={() => { onCopy(info.install); }}
                aria-label="Copier"
              >
                <Icon.Copy width="14" height="14" />
              </button>
            </div>
          </div>
          <div className="field">
            <span className="field-label">2. Connexion</span>
            <div className="code-block">
              {info.loginCmd}
              <button
                className="code-copy"
                onClick={() => { onCopy(info.loginCmd); }}
                aria-label="Copier"
              >
                <Icon.Copy width="14" height="14" />
              </button>
            </div>
          </div>
          <div className="field">
            <span className="field-label">3. Documentation</span>
            <a className="ext-link" href={info.docs} target="_blank" rel="noopener noreferrer">
              {info.docs.replace(/^https?:\/\//, "")}{" "}
              <Icon.ExternalLink width="14" height="14" />
            </a>
          </div>
          <span className="field-help" style={{ marginTop: "auto" }}>
            Une fois installé, LoomFlo détectera automatiquement {info.name} au prochain démarrage
            du wizard.
          </span>
        </div>
      </aside>
    </>
  );
}

function ConfirmCancelModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => { e.stopPropagation(); }} role="dialog">
        <h3>Annuler la création ?</h3>
        <p>
          Le brouillon sera sauvegardé. Tu pourras reprendre la création plus tard depuis l'écran
          d'accueil.
        </p>
        <div className="modal-actions">
          <button className="btn btn--ghost" onClick={onCancel}>
            Continuer
          </button>
          <button
            className="btn"
            onClick={onConfirm}
            style={{ color: "var(--status-failed-fg)" }}
          >
            Annuler la création
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="toast">
      <span className="dot-ok">
        <Icon.Check width="14" height="14" />
      </span>
      {message}
    </div>
  );
}

/* ============================================================================
   Wizard shell
   ============================================================================ */

function Rail({
  step,
  onJump,
}: {
  step: number;
  onJump: (s: number) => void;
}) {
  return (
    <aside className="rail">
      <div className="rail-head">
        <h1>Création de projet</h1>
        <p>
          Configure ton workflow LoomFlo en six étapes. Tu peux revenir en arrière à tout moment.
        </p>
      </div>
      <nav className="stepper" aria-label="Étapes">
        {STEPS.map(({ num, label }) => {
          const state = num < step ? "passed" : num === step ? "active" : "future";
          return (
            <button
              key={num}
              className="step-row"
              data-state={state}
              onClick={() => { if (state === "passed") onJump(num); }}
              aria-current={state === "active" ? "step" : undefined}
              tabIndex={state === "future" ? -1 : 0}
            >
              <span className="step-dot-wrap">
                <span className="step-dot" />
                <span className="step-line" />
              </span>
              <span className="step-meta">
                <span className="step-num">étape {String(num).padStart(2, "0")}</span>
                <span className="step-label">{label}</span>
              </span>
            </button>
          );
        })}
      </nav>
      <div className="rail-foot">
        <span className="rail-help">Raccourcis</span>
        <span className="rail-shortcut">
          <span>Suivant</span>
          <span className="kbd">↵</span>
        </span>
        <span className="rail-shortcut">
          <span>Annuler</span>
          <span className="kbd">Esc</span>
        </span>
      </div>
    </aside>
  );
}

function StepHead({ step }: { step: number }) {
  const headers: Record<number, { eyebrow: string; title: string; subtitle: string }> = {
    1: {
      eyebrow: "Étape 01 · Emplacement",
      title: "Où vit ton projet ?",
      subtitle:
        "Choisis le dossier de travail. C'est là que LoomFlo orchestrera les agents et lira/écrira ton code.",
    },
    2: {
      eyebrow: "Étape 02 · Connexions",
      title: "Provider et credentials",
      subtitle:
        "Configure au moins une clé API ou un agent CLI authentifié. Le provider sélectionné pilotera tes Looms par défaut.",
    },
    3: {
      eyebrow: "Étape 03 · Profondeur",
      title: "Niveau de planification",
      subtitle:
        "Plus le niveau est élevé, plus la spec est exhaustive et le contrôle qualité strict — au prix de plus de nœuds et de coûts.",
    },
    4: {
      eyebrow: "Étape 04 · Cadence",
      title: "Délai entre les nœuds",
      subtitle:
        "Combien de temps LoomFlo attend après la fin d'un nœud avant de démarrer le suivant. Permet d'étaler les coûts ou de réviser au passage.",
    },
    5: {
      eyebrow: "Étape 05 · Identité",
      title: "Nomme ton projet",
      subtitle:
        "Ce nom apparaîtra dans la liste des projets, dans la barre supérieure, et dans les URLs internes.",
    },
    6: {
      eyebrow: "Étape 06 · Vérification",
      title: "Tout est prêt",
      subtitle:
        "Relis la configuration. Tu pourras toujours modifier n'importe quel paramètre depuis les réglages du projet une fois créé.",
    },
  };
  const h = headers[step];
  if (!h) return null;
  return (
    <header className="step-head">
      <span className="step-eyebrow">{h.eyebrow}</span>
      <h2 className="step-title">{h.title}</h2>
      <p className="step-subtitle">{h.subtitle}</p>
    </header>
  );
}

function loadCreds(): Record<ApiProviderId, string> {
  const out: Record<ApiProviderId, string> = { anthropic: "", openai: "", moonshot: "" };
  (["anthropic", "openai", "moonshot"] as ApiProviderId[]).forEach((p) => {
    try {
      out[p] = localStorage.getItem(credKey(p)) || "";
    } catch {
      /* localStorage unavailable */
    }
  });
  return out;
}

/* ============================================================================
   WizardPage — public route
   ============================================================================ */

export function WizardPage() {
  const navigate = useNavigate();
  const store = useStore();
  const api = useApi();
  const { token } = useAppContext();
  const { theme, toggleTheme } = useTheme();

  const [draft, setDraftState] = useState<WizardDraft>(loadDraft);
  const [step, setStep] = useState(draft.step || 1);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [credModal, setCredModal] = useState<ApiProviderId | null>(null);
  const [installDrawer, setInstallDrawer] = useState<CliAgentId | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<ApiProviderId, string>>(() => loadCreds());
  const [created, setCreated] = useState<CreatedProject | null>(null);

  const { clis: liveClis } = useRuntimeAvailability();
  const cliState = useMemo<CliState>(() => asCliState(liveClis), [liveClis]);

  const setDraft = useCallback(
    (patch: Partial<WizardDraft> | ((d: WizardDraft) => WizardDraft)) => {
      setDraftState((d) => {
        const next = typeof patch === "function" ? patch(d) : { ...d, ...patch };
        saveDraft(next);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    setDraft({ step });
  }, [step, setDraft]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => { setToast(null); }, 2800);
  }, []);

  const validity = useMemo<Record<number, boolean>>(() => {
    return {
      1: isValidPath(draft.folder),
      2: !!draft.primaryProvider && providerIsValid(draft.primaryProvider, creds, cliState),
      3: !!draft.level,
      4:
        draft.delayPreset !== "custom"
          ? !!draft.delayPreset
          : draft.customDelay.value > 0 && !!draft.customDelay.unit,
      5: isValidName(draft.name) && !!draft.type,
      6: true,
    };
  }, [draft, creds, cliState]);

  const canNext = !!validity[step];

  const goNext = useCallback(() => {
    if (!canNext) return;
    if (step < 6) {
      setDir("forward");
      setStep(step + 1);
    }
  }, [canNext, step]);
  const goPrev = () => {
    if (step > 1) {
      setDir("back");
      setStep(step - 1);
    }
  };
  const goTo = (s: number) => {
    if (s < step) {
      setDir("back");
      setStep(s);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (credModal) setCredModal(null);
        else if (installDrawer) setInstallDrawer(null);
        else if (confirmCancel) setConfirmCancel(false);
        else if (step === 1) void navigate("/projects");
        else setConfirmCancel(true);
      } else if (e.key === "Enter" && !credModal && !installDrawer && !confirmCancel) {
        const active = document.activeElement;
        if (active && active.tagName === "INPUT") return;
        if (canNext && step < 6) goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [step, credModal, installDrawer, confirmCancel, canNext, navigate, goNext]);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const finalize = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const provider = draft.primaryProvider;
      const providerProfileId =
        provider && isApiProvider(provider) ? provider : "default";

      // When the user typed an API key in the wizard and we have a daemon
      // token, push the credential first so POST /projects can attach it.
      if (token && provider && isApiProvider(provider) && creds[provider]) {
        const payload = buildProviderPayload(provider, creds[provider]);
        try {
          await api.upsertCredential(provider, payload);
        } catch (err) {
          throw new Error(
            `Échec de l'enregistrement de la clé ${provider} — ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      const project = await store.create({
        name: draft.name,
        projectPath: draft.folder,
        workflowStatus: "init",
        status: "pending",
        createdBy: "user",
        config: { template: draft.type, stack: [], level: 1 },
        providerProfileId,
      });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* localStorage unavailable */
      }
      setCreated({ id: project.id, name: project.name });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  if (created) {
    return (
      <CreatedScreen
        project={created}
        onAgain={() => {
          setCreated(null);
          setDraftState({ ...DEFAULT_DRAFT });
          setStep(1);
        }}
        onGo={() => { void navigate(`/projects/${created.id}/brainstorm`); }}
      />
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
            <span>Projets</span>
            <span className="sep">›</span>
            <strong>Nouveau projet</strong>
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

      <div className="wizard">
        <Rail step={step} onJump={goTo} />
        <main className="stage">
          <div className="stage-inner">
            <StepHead step={step} />
            <div className="step-body step-pane" key={step} data-dir={dir}>
              {step === 1 && <Step1 draft={draft} setDraft={setDraft} />}
              {step === 2 && (
                <Step2
                  draft={draft}
                  setDraft={setDraft}
                  creds={creds}
                  cliState={cliState}
                  onOpenCred={(p) => { setCredModal(p); }}
                  onOpenInstall={(p) => { setInstallDrawer(p); }}
                  onLoginRequest={(name) =>
                    { showToast(
                      `Lance \`${CLI_INFO[name].loginCmd}\` dans ton terminal pour t'authentifier`,
                    ); }
                  }
                />
              )}
              {step === 3 && (
                <Step3
                  draft={draft}
                  setDraft={setDraft}
                  advancedOpen={advancedOpen}
                  setAdvancedOpen={setAdvancedOpen}
                />
              )}
              {step === 4 && <Step4 draft={draft} setDraft={setDraft} />}
              {step === 5 && <Step5 draft={draft} setDraft={setDraft} />}
              {step === 6 && (
                <Step6
                  draft={draft}
                  onJumpTo={goTo}
                  onCreate={() => {
                    void finalize();
                  }}
                  creating={creating}
                  createError={createError}
                />
              )}
            </div>

            <div className="actions">
              <button
                className="btn btn--ghost"
                onClick={() => { if (step === 1) void navigate("/projects"); else setConfirmCancel(true); }}
              >
                <Icon.X width="14" height="14" /> Annuler
              </button>
              <div className="actions-right">
                <span className="actions-info">
                  <span className="mono">{step}</span> / 6
                </span>
                {step > 1 && (
                  <button className="btn" onClick={goPrev}>
                    <Icon.ChevronLeft width="14" height="14" /> Précédent
                  </button>
                )}
                {step < 6 && (
                  <button
                    className="btn btn--primary"
                    disabled={!canNext}
                    onClick={goNext}
                    title={!canNext ? "Complète l'étape pour continuer" : ""}
                  >
                    Suivant <Icon.ChevronRight width="14" height="14" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {credModal && (
        <CredentialModal
          provider={credModal}
          existing={creds[credModal]}
          onSave={(value) => {
            setCreds((c) => ({ ...c, [credModal]: value }));
            try {
              if (value) localStorage.setItem(credKey(credModal), value);
              else localStorage.removeItem(credKey(credModal));
            } catch {
              /* localStorage unavailable */
            }
            setCredModal(null);
            showToast(value ? `Clé ${credModal} enregistrée` : `Clé ${credModal} supprimée`);
          }}
          onClose={() => { setCredModal(null); }}
        />
      )}

      {installDrawer && (
        <InstallDrawer
          cli={installDrawer}
          onClose={() => { setInstallDrawer(null); }}
          onCopy={(cmd) => {
            try {
              void navigator.clipboard.writeText(cmd);
            } catch {
              /* clipboard unavailable */
            }
            showToast("Commande copiée");
          }}
        />
      )}

      {confirmCancel && (
        <ConfirmCancelModal
          onCancel={() => { setConfirmCancel(false); }}
          onConfirm={() => {
            setConfirmCancel(false);
            showToast("Brouillon sauvegardé");
            void navigate("/projects");
          }}
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
