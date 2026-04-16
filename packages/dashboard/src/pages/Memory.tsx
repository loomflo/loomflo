// ============================================================================
// Memory Page
//
// Lists shared memory files in a left sidebar panel and renders the selected
// file as markdown in the main content area. Subscribes to the
// memory_updated WebSocket event to auto-refresh when agents write to
// shared memory.
// ============================================================================

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

import type { Memory } from "../lib/types.js";
import { useProject, useProjectId } from "../context/ProjectContext.js";
import { MarkdownViewer } from "../components/MarkdownViewer.js";
import { useWebSocket } from "../hooks/useWebSocket.js";

// ============================================================================
// Types
// ============================================================================

/** A single memory file entry. */
type MemoryFile = Memory["files"][number];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format an ISO 8601 timestamp as a short, human-readable date/time string.
 *
 * @param iso - ISO 8601 date string.
 * @returns Locale-formatted date and time string.
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================================
// MemoryPage Component
// ============================================================================

/**
 * Memory page displaying a navigable list of shared memory files with a
 * markdown preview panel.
 *
 * Reads projectId from URL params. The left sidebar shows all shared memory
 * files (name, last modified by, and last modified timestamp) fetched from the
 * REST API. Clicking a file loads its info in the main panel using
 * {@link MarkdownViewer}. The first file is auto-selected on initial load.
 *
 * Subscribes to the `memory_updated` WebSocket event so the list refreshes
 * automatically when agents write to shared memory, and reloads the
 * currently selected file if it was the one modified.
 *
 * @returns Rendered memory page element.
 */
export const MemoryPage = memo(function MemoryPage(): ReactElement {
  const projectId = useProjectId();
  const { client, baseUrl, token } = useProject();

  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);

  const [listLoading, setListLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  const selectedNameRef = useRef<string | null>(null);
  selectedNameRef.current = selectedName;

  // --------------------------------------------------------------------------
  // Data fetching
  // --------------------------------------------------------------------------

  /**
   * Fetch the memory file list from the REST API.
   *
   * @returns The fetched files array, or null on failure.
   */
  const fetchFiles = useCallback(async (): Promise<MemoryFile[] | null> => {
    try {
      setListError(null);
      const data = await client.getMemory(projectId);
      setFiles(data.files);
      return data.files;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load memory files";
      setListError(msg);
      return null;
    } finally {
      setListLoading(false);
    }
  }, [client, projectId]);

  /**
   * Load info for a specific memory file.
   * The new API returns memory file metadata; individual file content fetching
   * displays the file metadata.
   *
   * @param name - Memory file name to fetch.
   */
  const fetchContent = useCallback(
    async (name: string): Promise<void> => {
      setContentLoading(true);
      setContentError(null);
      try {
        const data = await client.getMemory(projectId);
        const file = data.files.find((f) => f.name === name);
        if (file) {
          setContent(
            `# ${file.name}\n\nLast modified by: **${file.lastModifiedBy}**\nLast modified at: ${file.lastModifiedAt}`,
          );
        } else {
          setContent(null);
          setContentError("File not found");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load file content";
        setContentError(msg);
        setContent(null);
      } finally {
        setContentLoading(false);
      }
    },
    [client, projectId],
  );

  // --------------------------------------------------------------------------
  // File selection
  // --------------------------------------------------------------------------

  /**
   * Handle clicking a file in the sidebar list.
   *
   * @param name - The name of the memory file to select and display.
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
      const fetched = await fetchFiles();
      const first = fetched?.[0];
      if (first) {
        setSelectedName(first.name);
        void fetchContent(first.name);
      }
    })();
  }, [fetchFiles, fetchContent]);

  // --------------------------------------------------------------------------
  // WebSocket subscription
  // --------------------------------------------------------------------------

  useWebSocket({
    baseUrl,
    token,
    subscribe: { projectIds: [projectId] },
    onMessage: (frame): void => {
      const type = frame["type"] as string | undefined;
      if (type === "memory_updated") {
        const fileName = frame["file"] as string | undefined;
        void (async (): Promise<void> => {
          await fetchFiles();
          if (selectedNameRef.current === fileName && fileName) {
            void fetchContent(fileName);
          }
        })();
      }
    },
  });

  // --------------------------------------------------------------------------
  // Loading state
  // --------------------------------------------------------------------------

  if (listLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
          <p className="text-sm text-gray-400">Loading memory files…</p>
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

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-300">No shared memory files yet</p>
          <p className="mt-2 text-sm text-gray-500">
            Memory files will appear here once agents begin writing to shared memory during workflow
            execution.
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
      {/* Sidebar: memory file list */}
      <div className="w-72 flex-shrink-0 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900">
        <h3 className="border-b border-gray-700 px-4 py-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Shared Memory
        </h3>
        <ul className="flex flex-col">
          {files.map((file) => (
            <li key={file.name}>
              <button
                type="button"
                onClick={() => {
                  handleSelect(file.name);
                }}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  selectedName === file.name
                    ? "bg-gray-800 text-white"
                    : "text-gray-300 hover:bg-gray-800/50 hover:text-gray-100"
                }`}
              >
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {file.lastModifiedBy} · {formatTimestamp(file.lastModifiedAt)}
                </p>
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
            <p className="text-sm text-gray-500">Select a file to view its content.</p>
          </div>
        )}
      </div>
    </div>
  );
});
