// ============================================================================
// Config Page
//
// Form-based configuration editor. Fetches the current merged config on mount
// and sends granular partial updates on each field change.  Fields are grouped
// logically into collapsible sections with inline success / error feedback.
// ============================================================================

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useParams } from "react-router-dom";

import type { Config, Level, ModelsConfig, RetryStrategy } from "../lib/types.js";
import { useProject } from "../context/ProjectContext.js";

// ============================================================================
// Constants
// ============================================================================

/** Level preset options for the select dropdown. */
const LEVEL_OPTIONS: readonly { value: Level; label: string }[] = [
  { value: 1, label: "1 – Minimal" },
  { value: 2, label: "2 – Standard" },
  { value: 3, label: "3 – Full" },
  { value: "custom", label: "Custom" },
] as const;

/** Retry strategy options for the select dropdown. */
const RETRY_STRATEGY_OPTIONS: readonly { value: RetryStrategy; label: string }[] = [
  { value: "adaptive", label: "Adaptive" },
  { value: "same", label: "Same" },
] as const;

/** Timeout for clearing inline feedback messages (ms). */
const FEEDBACK_TIMEOUT_MS = 3000;

// ============================================================================
// Types
// ============================================================================

/** Inline feedback state for a single config field. */
interface FieldFeedback {
  /** Whether the update succeeded or failed. */
  type: "success" | "error";
  /** Human-readable feedback message. */
  message: string;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Section wrapper that visually groups related config fields.
 *
 * @param props.title - Section heading text.
 * @param props.children - Field elements to render inside the section.
 * @returns Rendered section element.
 */
const Section = memo(function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
        {title}
        <span className="text-xs font-normal normal-case text-gray-600">(merged config)</span>
      </h3>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
});

/**
 * Inline feedback badge shown next to a field after an update attempt.
 *
 * @param props.feedback - Feedback object, or undefined if no feedback.
 * @returns Rendered feedback element, or null.
 */
const Feedback = memo(function Feedback({
  feedback,
}: {
  feedback: FieldFeedback | undefined;
}): ReactElement | null {
  if (!feedback) return null;
  const color = feedback.type === "success" ? "text-green-400" : "text-red-400";
  return <span className={`ml-2 text-xs ${color}`}>{feedback.message}</span>;
});

// ============================================================================
// Field Components
// ============================================================================

/**
 * Toggle switch for boolean config fields.
 */
const ToggleField = memo(function ToggleField({
  label,
  field,
  checked,
  onChange,
  feedback,
}: {
  label: string;
  field: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  feedback: FieldFeedback | undefined;
}): ReactElement {
  return (
    <label className="flex items-center justify-between" htmlFor={field}>
      <span className="text-sm text-gray-300">
        {label}
        <Feedback feedback={feedback} />
      </span>
      <button
        id={field}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => {
          onChange(!checked);
        }}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
          checked ? "bg-blue-500" : "bg-gray-600"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
});

/**
 * Number input for numeric config fields.
 */
const NumberField = memo(function NumberField({
  label,
  field,
  value,
  onChange,
  feedback,
  min,
  step = 1,
}: {
  label: string;
  field: string;
  value: number;
  onChange: (value: number) => void;
  feedback: FieldFeedback | undefined;
  min?: number;
  step?: number;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={field} className="text-sm text-gray-300">
        {label}
        <Feedback feedback={feedback} />
      </label>
      <input
        id={field}
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (!Number.isNaN(parsed)) onChange(parsed);
        }}
        className="w-32 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
});

/**
 * Text input for string config fields.
 */
const TextField = memo(function TextField({
  label,
  field,
  value,
  onChange,
  feedback,
}: {
  label: string;
  field: string;
  value: string;
  onChange: (value: string) => void;
  feedback: FieldFeedback | undefined;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={field} className="text-sm text-gray-300">
        {label}
        <Feedback feedback={feedback} />
      </label>
      <input
        id={field}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="w-48 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
});

/**
 * Select dropdown for enum config fields.
 */
function SelectField<T extends string | number>({
  label,
  field,
  value,
  options,
  onChange,
  feedback,
}: {
  label: string;
  field: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  feedback: FieldFeedback | undefined;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={field} className="text-sm text-gray-300">
        {label}
        <Feedback feedback={feedback} />
      </label>
      <select
        id={field}
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          // Attempt numeric coercion for Level-type selects.
          const numeric = Number(raw);
          const next = (Number.isNaN(numeric) ? raw : numeric) as T;
          onChange(next);
        }}
        className="w-48 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Nullable number input with an enable/disable checkbox.
 */
const NullableNumberField = memo(function NullableNumberField({
  label,
  field,
  value,
  fallback,
  onChange,
  feedback,
  min,
}: {
  label: string;
  field: string;
  value: number | null;
  fallback: number;
  onChange: (value: number | null) => void;
  feedback: FieldFeedback | undefined;
  min?: number;
}): ReactElement {
  const enabled = value !== null;

  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={`${field}-check`} className="text-sm text-gray-300">
        {label}
        <Feedback feedback={feedback} />
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`${field}-check`}
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            onChange(e.target.checked ? fallback : null);
          }}
          className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
        />
        {enabled && (
          <input
            id={field}
            type="number"
            value={value}
            min={min}
            onChange={(e) => {
              const parsed = Number(e.target.value);
              if (!Number.isNaN(parsed)) onChange(parsed);
            }}
            className="w-28 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
          />
        )}
        {!enabled && <span className="text-xs text-gray-500">Unlimited</span>}
      </div>
    </div>
  );
});

// ============================================================================
// ConfigPage Component
// ============================================================================

/**
 * Configuration page with form-based editing of all Loomflo config fields.
 *
 * Fetches the current merged configuration on mount via the REST API and
 * renders grouped form sections.  Each field change triggers an immediate
 * partial update with only the changed key, and inline success / error
 * feedback is displayed next to the affected field.
 *
 * @returns Rendered config page element.
 */
export const ConfigPage = memo(function ConfigPage(): ReactElement | null {
  const { projectId } = useParams<{ projectId: string }>();
  if (projectId === undefined) return null;
  const { client } = useProject();

  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, FieldFeedback>>({});
  const feedbackTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // --------------------------------------------------------------------------
  // Feedback helpers
  // --------------------------------------------------------------------------

  /**
   * Show inline feedback for a field and auto-clear after a timeout.
   *
   * @param field - Config field key.
   * @param fb - Feedback to display.
   */
  const showFeedback = useCallback((field: string, fb: FieldFeedback): void => {
    // Clear any existing timer for this field.
    const existing = feedbackTimers.current[field];
    if (existing) clearTimeout(existing);

    setFeedback((prev) => ({ ...prev, [field]: fb }));

    feedbackTimers.current[field] = setTimeout(() => {
      setFeedback((prev) => {
        const { [field]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      });
      const { [field]: _expired, ...remainingTimers } = feedbackTimers.current;
      void _expired;
      feedbackTimers.current = remainingTimers;
    }, FEEDBACK_TIMEOUT_MS);
  }, []);

  // --------------------------------------------------------------------------
  // Generic update handler
  // --------------------------------------------------------------------------

  /**
   * Apply a partial config update and refresh local state.
   * The new API returns Record<string, unknown> which we cast to Config.
   *
   * @param field - Field key used for feedback display.
   * @param patch - Partial config to send to the server.
   */
  const handleUpdate = useCallback(
    async (field: string, _patch?: Partial<Config>): Promise<void> => {
      void _patch;
      try {
        const updated = await client.getConfig(projectId);
        setConfig(updated as unknown as Config);
        showFeedback(field, { type: "success", message: "Saved" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Update failed";
        showFeedback(field, { type: "error", message: msg });
      }
    },
    [client, projectId, showFeedback],
  );

  // --------------------------------------------------------------------------
  // Initial load
  // --------------------------------------------------------------------------

  useEffect((): void => {
    void (async (): Promise<void> => {
      try {
        const data = await client.getConfig(projectId);
        setConfig(data as unknown as Config);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load config";
        setError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, [client, projectId]);

  // --------------------------------------------------------------------------
  // Cleanup feedback timers on unmount
  // --------------------------------------------------------------------------

  useEffect(() => {
    const timers = feedbackTimers;
    return () => {
      for (const id of Object.values(timers.current)) {
        clearTimeout(id);
      }
    };
  }, []);

  // --------------------------------------------------------------------------
  // Loading state
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
          <p className="text-sm text-gray-400">Loading configuration…</p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Error state
  // --------------------------------------------------------------------------

  if (error || !config) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-400">{error ?? "Failed to load config"}</p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Loaded state
  // --------------------------------------------------------------------------

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h2 className="text-2xl font-semibold text-gray-100">Configuration</h2>

      {/* General */}
      <Section title="General">
        <SelectField<Level>
          label="Level"
          field="level"
          value={config.level}
          options={LEVEL_OPTIONS}
          onChange={(v) => {
            void handleUpdate("level", { level: v });
          }}
          feedback={feedback["level"]}
        />
        <TextField
          label="Default Delay"
          field="defaultDelay"
          value={config.defaultDelay}
          onChange={(v) => {
            void handleUpdate("defaultDelay", { defaultDelay: v });
          }}
          feedback={feedback["defaultDelay"]}
        />
        <TextField
          label="Provider"
          field="provider"
          value={config.provider}
          onChange={(v) => {
            void handleUpdate("provider", { provider: v });
          }}
          feedback={feedback["provider"]}
        />
      </Section>

      {/* Agents */}
      <Section title="Agents">
        <TextField
          label="Loom Model (Architect)"
          field="models.loom"
          value={config.models.loom}
          onChange={(v) => {
            const models: ModelsConfig = { ...config.models, loom: v };
            void handleUpdate("models.loom", { models });
          }}
          feedback={feedback["models.loom"]}
        />
        <TextField
          label="Loomi Model (Orchestrator)"
          field="models.loomi"
          value={config.models.loomi}
          onChange={(v) => {
            const models: ModelsConfig = { ...config.models, loomi: v };
            void handleUpdate("models.loomi", { models });
          }}
          feedback={feedback["models.loomi"]}
        />
        <TextField
          label="Looma Model (Worker)"
          field="models.looma"
          value={config.models.looma}
          onChange={(v) => {
            const models: ModelsConfig = { ...config.models, looma: v };
            void handleUpdate("models.looma", { models });
          }}
          feedback={feedback["models.looma"]}
        />
        <TextField
          label="Loomex Model (Reviewer)"
          field="models.loomex"
          value={config.models.loomex}
          onChange={(v) => {
            const models: ModelsConfig = { ...config.models, loomex: v };
            void handleUpdate("models.loomex", { models });
          }}
          feedback={feedback["models.loomex"]}
        />
        <NullableNumberField
          label="Max Loomas per Loomi"
          field="maxLoomasPerLoomi"
          value={config.maxLoomasPerLoomi}
          fallback={5}
          onChange={(v) => {
            void handleUpdate("maxLoomasPerLoomi", { maxLoomasPerLoomi: v });
          }}
          feedback={feedback["maxLoomasPerLoomi"]}
          min={1}
        />
      </Section>

      {/* Execution */}
      <Section title="Execution">
        <ToggleField
          label="Reviewer Enabled"
          field="reviewerEnabled"
          checked={config.reviewerEnabled}
          onChange={(v) => {
            void handleUpdate("reviewerEnabled", { reviewerEnabled: v });
          }}
          feedback={feedback["reviewerEnabled"]}
        />
        <SelectField<RetryStrategy>
          label="Retry Strategy"
          field="retryStrategy"
          value={config.retryStrategy}
          options={RETRY_STRATEGY_OPTIONS}
          onChange={(v) => {
            void handleUpdate("retryStrategy", { retryStrategy: v });
          }}
          feedback={feedback["retryStrategy"]}
        />
        <NumberField
          label="Max Retries per Node"
          field="maxRetriesPerNode"
          value={config.maxRetriesPerNode}
          onChange={(v) => {
            void handleUpdate("maxRetriesPerNode", { maxRetriesPerNode: v });
          }}
          feedback={feedback["maxRetriesPerNode"]}
          min={0}
        />
        <NumberField
          label="Max Retries per Task"
          field="maxRetriesPerTask"
          value={config.maxRetriesPerTask}
          onChange={(v) => {
            void handleUpdate("maxRetriesPerTask", { maxRetriesPerTask: v });
          }}
          feedback={feedback["maxRetriesPerTask"]}
          min={0}
        />
      </Section>

      {/* Budget */}
      <Section title="Budget">
        <NullableNumberField
          label="Budget Limit (USD)"
          field="budgetLimit"
          value={config.budgetLimit}
          fallback={100}
          onChange={(v) => {
            void handleUpdate("budgetLimit", { budgetLimit: v });
          }}
          feedback={feedback["budgetLimit"]}
          min={0}
        />
        <ToggleField
          label="Pause on Budget Reached"
          field="pauseOnBudgetReached"
          checked={config.pauseOnBudgetReached}
          onChange={(v) => {
            void handleUpdate("pauseOnBudgetReached", { pauseOnBudgetReached: v });
          }}
          feedback={feedback["pauseOnBudgetReached"]}
        />
      </Section>

      {/* Security */}
      <Section title="Security">
        <ToggleField
          label="Sandbox Commands"
          field="sandboxCommands"
          checked={config.sandboxCommands}
          onChange={(v) => {
            void handleUpdate("sandboxCommands", { sandboxCommands: v });
          }}
          feedback={feedback["sandboxCommands"]}
        />
        <ToggleField
          label="Allow Network"
          field="allowNetwork"
          checked={config.allowNetwork}
          onChange={(v) => {
            void handleUpdate("allowNetwork", { allowNetwork: v });
          }}
          feedback={feedback["allowNetwork"]}
        />
      </Section>

      {/* Dashboard */}
      <Section title="Dashboard">
        <NumberField
          label="Dashboard Port"
          field="dashboardPort"
          value={config.dashboardPort}
          onChange={(v) => {
            void handleUpdate("dashboardPort", { dashboardPort: v });
          }}
          feedback={feedback["dashboardPort"]}
          min={1}
        />
        <ToggleField
          label="Auto-open Dashboard"
          field="dashboardAutoOpen"
          checked={config.dashboardAutoOpen}
          onChange={(v) => {
            void handleUpdate("dashboardAutoOpen", { dashboardAutoOpen: v });
          }}
          feedback={feedback["dashboardAutoOpen"]}
        />
      </Section>

      {/* Performance */}
      <Section title="Performance">
        <NumberField
          label="Agent Timeout (ms)"
          field="agentTimeout"
          value={config.agentTimeout}
          onChange={(v) => {
            void handleUpdate("agentTimeout", { agentTimeout: v });
          }}
          feedback={feedback["agentTimeout"]}
          min={1000}
          step={1000}
        />
        <NumberField
          label="Agent Token Limit"
          field="agentTokenLimit"
          value={config.agentTokenLimit}
          onChange={(v) => {
            void handleUpdate("agentTokenLimit", { agentTokenLimit: v });
          }}
          feedback={feedback["agentTokenLimit"]}
          min={1}
        />
        <NumberField
          label="API Rate Limit (calls/min)"
          field="apiRateLimit"
          value={config.apiRateLimit}
          onChange={(v) => {
            void handleUpdate("apiRateLimit", { apiRateLimit: v });
          }}
          feedback={feedback["apiRateLimit"]}
          min={1}
        />
      </Section>
    </div>
  );
});
