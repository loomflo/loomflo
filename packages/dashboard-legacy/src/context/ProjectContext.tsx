import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useParams } from "react-router-dom";

import { api, type ApiClient } from "../lib/api.js";
import { readToken } from "../lib/token.js";
import type { ProjectSummary } from "../lib/types.js";

// ============================================================================
// Context value type
// ============================================================================

export interface ProjectContextValue {
  token: string;
  baseUrl: string;
  client: ApiClient;
  projectId: string | null;
  setProjectId(id: string | null): void;
  allProjects: ProjectSummary[];
  refresh(): Promise<void>;
  error: Error | null;
}

// ============================================================================
// Context
// ============================================================================

const ProjectCtx = createContext<ProjectContextValue | null>(null);

// ============================================================================
// Hook
// ============================================================================

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectCtx);
  if (ctx === null) {
    throw new Error("useProject must be used inside a <ProjectProvider>");
  }
  return ctx;
}

export function useProjectId(): string {
  const { projectId } = useParams<{ projectId: string }>();
  if (projectId === undefined) {
    throw new Error("useProjectId must be used inside a /projects/:projectId route");
  }
  return projectId;
}

// ============================================================================
// Provider
// ============================================================================

export interface ProjectProviderProps {
  baseUrl: string;
  children: ReactNode;
}

/**
 * Outer provider shell — reads the token and either renders the inner
 * provider or a "paste your token" gate.  Split into two components so
 * hooks are never called conditionally.
 */
export function ProjectProvider(props: ProjectProviderProps): ReactElement {
  const token = readToken();
  if (token === null) {
    return <MissingTokenGate />;
  }
  return (
    <ProjectProviderInner baseUrl={props.baseUrl} token={token}>
      {props.children}
    </ProjectProviderInner>
  );
}

// ============================================================================
// Inner provider (hooks live here)
// ============================================================================

function ProjectProviderInner(props: {
  baseUrl: string;
  token: string;
  children: ReactNode;
}): ReactElement {
  const client = useMemo(
    () => api({ baseUrl: props.baseUrl, token: props.token }),
    [props.baseUrl, props.token],
  );

  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await client.listProjects();
      setAllProjects(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value: ProjectContextValue = {
    token: props.token,
    baseUrl: props.baseUrl,
    client,
    projectId,
    setProjectId,
    allProjects,
    refresh,
    error,
  };

  return <ProjectCtx.Provider value={value}>{props.children}</ProjectCtx.Provider>;
}

// ============================================================================
// Fallback gate when no token is present
// ============================================================================

function MissingTokenGate(): ReactElement {
  const [pasted, setPasted] = useState("");

  const onSubmit = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    sessionStorage.setItem("loomflo.token", pasted);
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-loom-bg text-loom-muted flex items-center justify-center p-8">
      <form
        onSubmit={onSubmit}
        className="bg-loom-panel p-6 rounded-md max-w-md w-full space-y-4"
      >
        <h2 className="text-loom-accent text-lg">Daemon token required</h2>
        <p className="text-sm text-loom-dim">
          Open the dashboard via <code>loomflo dashboard</code> so the token is
          passed automatically, or paste it here:
        </p>
        <input
          type="password"
          className="w-full bg-loom-panel-2 text-loom-muted p-2 rounded"
          placeholder="daemon token"
          value={pasted}
          onChange={(e) => { setPasted((e.target as HTMLInputElement).value); }}
        />
        <button
          className="bg-loom-accent text-loom-bg px-4 py-2 rounded"
          type="submit"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
