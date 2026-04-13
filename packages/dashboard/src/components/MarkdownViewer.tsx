// ============================================================================
// MarkdownViewer Component
//
// Renders a markdown string with full styling for the dark-themed dashboard.
// Uses react-markdown for parsing and rehype-highlight for syntax
// highlighting of fenced code blocks.
// ============================================================================

import { memo } from "react";
import type { ReactElement } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";

// ============================================================================
// Types
// ============================================================================

/** Props for the {@link MarkdownViewer} component. */
export interface MarkdownViewerProps {
  /** Raw markdown string to render. */
  content: string;
  /** Optional maximum height (CSS value) — enables vertical scrolling. */
  maxHeight?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Rehype plugins applied to every render pass. */
const REHYPE_PLUGINS = [rehypeHighlight];

/** Custom component overrides for dark-theme styling. */
const COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-4 mt-6 text-2xl font-bold text-gray-100">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="mb-3 mt-5 text-xl font-semibold text-gray-100">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold text-gray-100">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-2 mt-3 text-base font-medium text-gray-100">{children}</h4>
  ),
  p: ({ children }) => <p className="mb-3 leading-relaxed text-gray-300">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-blue-400 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="mb-3 ml-6 list-disc space-y-1 text-gray-300">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-3 ml-6 list-decimal space-y-1 text-gray-300">{children}</ol>
  ),
  li: ({ children }) => <li className="text-gray-300">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-gray-600 pl-4 italic text-gray-400">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-lg bg-gray-800 p-4 font-mono text-sm">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    // Fenced code blocks are wrapped in <pre> and carry a language className.
    const isBlock = Boolean(className);
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-sm text-gray-200">
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm text-gray-300">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-gray-600 bg-gray-800 text-left text-gray-200">
      {children}
    </thead>
  ),
  tbody: ({ children }) => (
    <tbody className="[&>tr:nth-child(even)]:bg-gray-800/50">{children}</tbody>
  ),
  tr: ({ children }) => <tr className="border-b border-gray-700">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2">{children}</td>,
  hr: () => <hr className="my-4 border-gray-700" />,
};

// ============================================================================
// MarkdownViewer Component
// ============================================================================

/**
 * Render a markdown string with dark-theme styling and syntax highlighting.
 *
 * All standard markdown elements (headings, paragraphs, code, tables, lists,
 * blockquotes, links) are styled for the dashboard's dark colour scheme.
 * Fenced code blocks receive automatic language-based syntax highlighting
 * via `rehype-highlight`.
 *
 * @param props - Markdown content and optional height constraint.
 * @returns Rendered markdown element.
 */
export const MarkdownViewer = memo(function MarkdownViewer({
  content,
  maxHeight,
}: MarkdownViewerProps): ReactElement {
  return (
    <div className="text-sm" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      <Markdown rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
        {content}
      </Markdown>
    </div>
  );
});
