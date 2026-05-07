import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoomChatPanel } from "../../src/components/loom/LoomChatPanel.js";
import type { SeedHistoryEntry, SeedMessage } from "../../src/lib/loomBrain.js";

const baseMessages: SeedMessage[] = [
  { id: "s1", from: "loom", ts: Date.now() - 1000 * 60, text: "Bonjour" },
];

const history: SeedHistoryEntry[] = [
  {
    id: "h1",
    by: "loom",
    kind: "ADD_NODE",
    target: "x",
    desc: "added x",
    ts: Date.now() - 60_000,
    atomic: true,
  },
];

describe("LoomChatPanel", () => {
  it("renders the seed messages and the composer", () => {
    render(
      <LoomChatPanel
        nodes={[{ id: "n1", name: "n1" }]}
        workflowState="running"
        initialMessages={baseMessages}
      />,
    );
    expect(screen.getByText("Bonjour")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Demande à Loom de modifier le workflow…"),
    ).toBeInTheDocument();
  });

  it("opens and closes the timeline drawer", () => {
    render(
      <LoomChatPanel
        nodes={[]}
        workflowState="running"
        initialMessages={baseMessages}
        initialHistory={history}
      />,
    );
    fireEvent.click(screen.getByLabelText("Timeline des actions"));
    expect(screen.getByText(/Timeline des actions/i)).toBeInTheDocument();
    expect(screen.getByText(/added x/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Fermer"));
  });

  it("disables Send when the composer is empty", () => {
    render(
      <LoomChatPanel nodes={[]} workflowState="running" initialMessages={baseMessages} />,
    );
    expect(screen.getByLabelText("Envoyer")).toBeDisabled();
  });

  it("submits on Enter without Shift and triggers onApplyAction", async () => {
    vi.useFakeTimers();
    const onApply = vi.fn();
    render(
      <LoomChatPanel
        nodes={[{ id: "n1", name: "n1" }]}
        workflowState="running"
        initialMessages={baseMessages}
        onApplyAction={onApply}
      />,
    );
    const composer = screen.getByPlaceholderText("Demande à Loom de modifier le workflow…");
    fireEvent.change(composer, { target: { value: "aide" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: false });
    // Streaming advances by 25ms per char — flush far past the longest reply.
    await vi.advanceTimersByTimeAsync(20_000);
    vi.useRealTimers();
    expect(onApply).toHaveBeenCalled();
  });

  it("renders a suggestion chip per workflow state", () => {
    render(
      <LoomChatPanel nodes={[]} workflowState="failed" initialMessages={baseMessages} />,
    );
    expect(screen.getByText(/Diagnostique l'échec/)).toBeInTheDocument();
  });
});
