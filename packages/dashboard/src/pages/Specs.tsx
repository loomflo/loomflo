// ============================================================================
// Specs Page
//
// Lists spec artifacts in a left sidebar panel and renders the selected
// artifact as markdown in the main content area. Subscribes to the
// spec_artifact_ready WebSocket event to auto-refresh when new artifacts
// are generated during Phase 1.
// ============================================================================

import { memo, useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useSearchParams } from "react-router-dom";

import type { SpecArtifact } from "../lib/api.js";
import { apiClient } from "../lib/api.js";
import { MarkdownViewer } from "../components/MarkdownViewer.js";
import { useWebSocket } from "../hooks/useWebSocket.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a byte count as a human-readable size string.
 *
 * @param bytes - File size in bytes.
 * @returns Formatted size string (e.g., "1.5 KB", "3.0 MB").
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// SpecsPage Component
// ============================================================================

/**
 * Specs page displaying a navigable list of spec artifacts with a markdown
 * preview panel.
 *
 * The left sidebar shows all available spec artifacts (name and file size)
 * fetched from the REST API. Clicking an artifact loads its raw markdown
 * content and renders it in the main panel using {@link MarkdownViewer}.
 * The first artifact is auto-selected on initial load.
 *
 * Subscribes to the `spec_artifact_ready` WebSocket event so the list
 * refreshes automatically when Loom generates new spec artifacts.
 *
 * @returns Rendered specs page element.
 */
export const SpecsPage = memo(function SpecsPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { subscribe } = useWebSocket(token);

  const [artifacts, setArtifacts] = useState<SpecArtifact[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);

  const [listLoading, setListLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // Data fetching
  // --------------------------------------------------------------------------

  /**
   * Fetch the artifact list from the REST API.
   *
   * @returns The fetched artifacts array, or null on failure.
   */
  const fetchArtifacts = useCallback(async (): Promise<SpecArtifact[] | null> => {
    try {
      setListError(null);
      const data = await apiClient.getSpecs();
      setArtifacts(data.artifacts);
      return data.artifacts;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load spec artifacts";
      setListError(msg);
      return null;
    } finally {
      setListLoading(false);
    }
  }, []);

  /**
   * Load the raw markdown content for a specific artifact.
   *
   * @param name - Artifact file name to fetch.
   */
  const fetchContent = useCallback(async (name: string): Promise<void> => {
    setContentLoading(true);
    setContentError(null);
    try {
      const md = await apiClient.getSpec(name);
      setContent(md);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load artifact content";
      setContentError(msg);
      setContent(null);
    } finally {
      setContentLoading(false);
    }
  }, []);

  // --------------------------------------------------------------------------
  // Artifact selection
  // --------------------------------------------------------------------------

  /**
   * Handle clicking an artifact in the sidebar list.
   *
   * @param name - The name of the artifact to select and display.
   */
  const handleSelect = useCallback(
    (name: string): void => {
      setSelectedName(name);
      void fetchContent(name);
    },
    [fetchContent],
  );

  // --------------------------------------------------------------------------
  // Initial load
  // --------------------------------------------------------------------------

  useEffect((): void => {
    void (async (): Promise<void> => {
      const fetched = await fetchArtifacts();
      const first = fetched?.[0];
      if (first) {
        setSelectedName(first.name);
        void fetchContent(first.name);
      }
    })();
  }, [fetchArtifacts, fetchContent]);

  // --------------------------------------------------------------------------
  // WebSocket subscription
  // --------------------------------------------------------------------------

  useEffect((): (() => void) => {
    const unsub = subscribe("spec_artifact_ready", (): void => {
      void (async (): Promise<void> => {
        const fetched = await fetchArtifacts();
        const first = fetched?.[0];
        if (first && selectedName === null) {
          setSelectedName(first.name);
          void fetchContent(first.name);
        }
      })();
    });
    return unsub;
  }, [subscribe, fetchArtifacts, fetchContent, selectedName]);

  // --------------------------------------------------------------------------
  // Loading state
  // --------------------------------------------------------------------------

  if (listLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
          <p className="text-sm text-gray-400">Loading spec artifacts…</p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Error state
  // --------------------------------------------------------------------------

  if (listError) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-400">{listError}</p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Empty state
  // --------------------------------------------------------------------------

  if (artifacts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-300">No spec artifacts available</p>
          <p className="mt-2 text-sm text-gray-500">
            Spec artifacts will appear here once a workflow enters the spec phase.
          </p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Loaded state
  // --------------------------------------------------------------------------

  return (
    <div className="flex h-full gap-4">
      {/* Sidebar: artifact list */}
      <div className="w-64 flex-shrink-0 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900">
        <h3 className="border-b border-gray-700 px-4 py-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Spec Artifacts
        </h3>
        <ul className="flex flex-col">
          {artifacts.map((artifact) => (
            <li key={artifact.name}>
              <button
                type="button"
                onClick={() => {
                  handleSelect(artifact.name);
                }}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  selectedName === artifact.name
                    ? "bg-gray-800 text-white"
                    : "text-gray-300 hover:bg-gray-800/50 hover:text-gray-100"
                }`}
              >
                <p className="truncate text-sm font-medium">{artifact.name}</p>
                <p className="mt-0.5 text-xs text-gray-500">{formatFileSize(artifact.size)}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Main content: markdown viewer */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-6">
        {contentLoading && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
              <p className="text-sm text-gray-400">Loading content…</p>
            </div>
          </div>
        )}

        {contentError && !contentLoading && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-red-400">{contentError}</p>
          </div>
        )}

        {content !== null && !contentLoading && !contentError && (
          <MarkdownViewer content={content} />
        )}

        {content === null && !contentLoading && !contentError && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-gray-500">Select an artifact to view its content.</p>
          </div>
        )}
      </div>
    </div>
  );
});
