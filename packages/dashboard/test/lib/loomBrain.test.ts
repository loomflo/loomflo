import { describe, expect, it } from "vitest";
import {
  buildResponse,
  detectIntent,
  SEED_HISTORY,
  SEED_MESSAGES,
  suggestionsFor,
  type BrainContext,
  type BrainNode,
} from "../../src/lib/loomBrain.js";

const nodes: BrainNode[] = [
  { id: "auth", name: "auth", status: "failed" },
  { id: "models", name: "models", status: "running" },
  { id: "api", name: "api", status: "pending" },
  { id: "ui-pages", name: "ui-pages", status: "running" },
  { id: "docs", name: "docs", status: "pending" },
];

const ctx: BrainContext = { nodes };

describe("detectIntent", () => {
  it("recognises ADD_NODE with template name", () => {
    const intent = detectIntent("ajoute un nœud testing-e2e", ctx);
    expect(intent.kind).toBe("ADD_NODE");
    if (intent.kind === "ADD_NODE") expect(intent.proposedName).toContain("testing");
  });

  it("recognises ADD_NODE in English form", () => {
    const intent = detectIntent("add a deploy node", ctx);
    expect(intent.kind).toBe("ADD_NODE");
  });

  it("uppercase input still matches", () => {
    const intent = detectIntent("AJOUTE UN NŒUD MONITORING", ctx);
    expect(intent.kind).toBe("ADD_NODE");
    if (intent.kind === "ADD_NODE") expect(intent.proposedName).toBe("monitoring");
  });

  it("uses œ ligature variants for nœud", () => {
    const intent = detectIntent("supprime le nœud docs", ctx);
    expect(intent.kind).toBe("REMOVE_NODE");
    if (intent.kind === "REMOVE_NODE") expect(intent.node.id).toBe("docs");
  });

  it("recognises REMOVE_NODE with plain 'supprime'", () => {
    const intent = detectIntent("supprime ui-pages", ctx);
    expect(intent.kind).toBe("REMOVE_NODE");
  });

  it("recognises STOP_NODE", () => {
    const intent = detectIntent("stoppe le nœud ui-pages", ctx);
    expect(intent.kind).toBe("STOP_NODE");
    if (intent.kind === "STOP_NODE") expect(intent.node.id).toBe("ui-pages");
  });

  it("STOP_NODE falls back to a running node when none is named", () => {
    const intent = detectIntent("stoppe", ctx);
    expect(intent.kind).toBe("STOP_NODE");
  });

  it("recognises RESUME_NODE", () => {
    const intent = detectIntent("reprends auth", ctx);
    expect(intent.kind).toBe("RESUME_NODE");
    if (intent.kind === "RESUME_NODE") expect(intent.node.id).toBe("auth");
  });

  it("recognises UPDATE_INSTRUCTIONS", () => {
    const intent = detectIntent("modifie les instructions de api", ctx);
    expect(intent.kind).toBe("UPDATE_INSTRUCTIONS");
    if (intent.kind === "UPDATE_INSTRUCTIONS") expect(intent.node.id).toBe("api");
  });

  it("recognises DIAGNOSE on 'pourquoi … échoué'", () => {
    const intent = detectIntent("pourquoi auth a échoué ?", ctx);
    expect(intent.kind).toBe("DIAGNOSE");
    if (intent.kind === "DIAGNOSE") expect(intent.node?.id).toBe("auth");
  });

  it("recognises REORDER", () => {
    const intent = detectIntent("réorganise les nœuds", ctx);
    expect(intent.kind).toBe("REORDER");
  });

  it("falls back to HELP for irrelevant text", () => {
    const intent = detectIntent("quel temps fait-il ?", ctx);
    expect(intent.kind).toBe("HELP");
  });

  it("handles empty / undefined input gracefully", () => {
    expect(detectIntent("", ctx).kind).toBe("HELP");
    expect(detectIntent("   ", ctx).kind).toBe("HELP");
  });

  it("detects intent against an empty nodes array", () => {
    const intent = detectIntent("ajoute un nœud testing", { nodes: [] });
    expect(intent.kind).toBe("ADD_NODE");
    if (intent.kind === "ADD_NODE") expect(intent.after).toBeUndefined();
  });
});

describe("buildResponse", () => {
  it("ADD_NODE produces an action card label and target", () => {
    const intent = detectIntent("ajoute un nœud monitoring", ctx);
    const r = buildResponse(intent, ctx);
    expect(r.actionCardLabel).toBe("Nouveau worker");
    expect(r.actionCardTone).toBe("add");
    expect(r.actionCardTarget).toMatch(/monitoring/);
  });

  it("REMOVE_NODE on a running node asks for confirmation", () => {
    const intent = detectIntent("supprime ui-pages", ctx);
    const r = buildResponse(intent, ctx);
    expect(r.confirm?.reason).toBe("running");
    expect(r.actionCardTone).toBe("remove");
  });

  it("REMOVE_NODE on an idle node is non-destructive", () => {
    const intent = detectIntent("supprime docs", ctx);
    const r = buildResponse(intent, ctx);
    expect(r.confirm).toBeNull();
  });

  it("UPDATE_INSTRUCTIONS includes a non-empty diff", () => {
    const intent = detectIntent("modifie les instructions de api", ctx);
    const r = buildResponse(intent, ctx);
    expect(r.diff && r.diff.length).toBeGreaterThan(0);
  });

  it("STOP_NODE emits a warn-tone action card", () => {
    const intent = detectIntent("stoppe ui-pages", ctx);
    const r = buildResponse(intent, ctx);
    expect(r.actionCardTone).toBe("warn");
  });

  it("DIAGNOSE on a known-failed node mentions a remedy", () => {
    const intent = detectIntent("pourquoi auth a échoué ?", ctx);
    const r = buildResponse(intent, ctx);
    expect(r.reply).toMatch(/Diagnostic/);
  });

  it("DIAGNOSE with no failed node returns a safe fallback", () => {
    const cleanCtx: BrainContext = { nodes: [{ id: "x", name: "x", status: "done" }] };
    const r = buildResponse({ kind: "DIAGNOSE", node: undefined }, cleanCtx);
    expect(r.reply.toLowerCase()).toMatch(/aucun nœud en échec/);
  });

  it("REORDER yields a friendly nudge with no destructive action", () => {
    const r = buildResponse({ kind: "REORDER" }, ctx);
    expect(r.action).toBeUndefined();
  });

  it("HELP enumerates examples in markdown", () => {
    const r = buildResponse({ kind: "HELP" }, ctx);
    expect(r.reply.toLowerCase()).toContain("ajouter un nœud");
    expect(r.reply.toLowerCase()).toContain("supprimer");
  });

  it("RESUME_NODE has an add-tone action card", () => {
    const r = buildResponse(
      { kind: "RESUME_NODE", node: { id: "auth", name: "auth", status: "failed" } },
      ctx,
    );
    expect(r.actionCardTone).toBe("add");
  });
});

describe("suggestionsFor", () => {
  it("returns 4 running suggestions", () => {
    expect(suggestionsFor("running")).toHaveLength(4);
  });
  it("returns failed-specific suggestions", () => {
    expect(suggestionsFor("failed").join(" ").toLowerCase()).toMatch(/diagnost/);
  });
  it("done branch", () => {
    expect(suggestionsFor("done").length).toBeGreaterThan(0);
  });
  it("default branch", () => {
    expect(suggestionsFor("init").length).toBeGreaterThan(0);
  });
});

describe("seed exports", () => {
  it("SEED_MESSAGES are non-empty and have required fields", () => {
    expect(SEED_MESSAGES.length).toBeGreaterThan(0);
    for (const m of SEED_MESSAGES) {
      expect(m.id).toBeTruthy();
      expect(["loom", "user"]).toContain(m.from);
      expect(typeof m.text).toBe("string");
    }
  });
  it("SEED_HISTORY entries are well-typed", () => {
    expect(SEED_HISTORY.length).toBeGreaterThan(0);
    for (const h of SEED_HISTORY) {
      expect(["loom", "user"]).toContain(h.by);
    }
  });
});
