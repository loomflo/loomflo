import type { NodeStatus } from "./types.js";

/* ============================================================================
   Scripted intent detection + canned Loom responses.

   Ported from loomflo_dashboard_prototype/loom-chat-brain.jsx. The brain
   is intentionally hand-rolled regex matching, not an LLM call — it powers
   the demo chat and gives Phase A a deterministic action surface.
   ============================================================================ */

/** Minimal node shape used by the brain. */
export interface BrainNode {
  id: string;
  name: string;
  status?: NodeStatus | string;
}

/** Workflow context passed in by the host. */
export interface BrainContext {
  nodes?: BrainNode[];
}

export type IntentKind =
  | "ADD_NODE"
  | "REMOVE_NODE"
  | "UPDATE_INSTRUCTIONS"
  | "STOP_NODE"
  | "RESUME_NODE"
  | "DIAGNOSE"
  | "REORDER"
  | "HELP";

export type Intent =
  | { kind: "ADD_NODE"; proposedName: string; after: BrainNode | undefined }
  | { kind: "REMOVE_NODE"; node: BrainNode }
  | { kind: "UPDATE_INSTRUCTIONS"; node: BrainNode }
  | { kind: "STOP_NODE"; node: BrainNode }
  | { kind: "RESUME_NODE"; node: BrainNode }
  | { kind: "DIAGNOSE"; node: BrainNode | undefined }
  | { kind: "REORDER" }
  | { kind: "HELP" };

export type DiffEntry = { type: "ctx" | "add" | "del"; text: string };

export interface BrainResponse {
  reply: string;
  action?: {
    type: IntentKind;
    nodeId?: string;
    name?: string;
    after?: string;
    phase?: "spec" | "worker";
  };
  actionCardLabel?: string;
  actionCardTone?: "add" | "remove" | "update" | "warn";
  actionCardTarget?: string;
  confirm?: { reason: string } | null;
  diff?: DiffEntry[];
}

export function detectIntent(text: string, ctx: BrainContext): Intent {
  const t = (text || "").toLowerCase();
  const nodes = ctx.nodes || [];
  const findNode = (): BrainNode | undefined => {
    for (const n of nodes) {
      const re = new RegExp(`\\b${n.name.toLowerCase()}\\b|\\b${n.id.toLowerCase()}\\b`);
      if (re.test(t)) return n;
    }
    return undefined;
  };

  if (
    /(ajoute|rajoute|add|crée|cree).*(n[oœ]ud|node|étape|step)/.test(t) ||
    /(ajoute|add)\s+(un\s+)?(node|n[oœ]ud)?\s*\b(testing|test|e2e|docs?|monitoring|deploy|ci|lint|seed)/.test(
      t,
    )
  ) {
    const nameMatch = t.match(
      /\b(testing[- ]?e2e|testing|tests?|monitoring|deploy(?:ment)?|docs?|documentation|lint(?:ing)?|seed|migrations?|ci|qa|review|cache|telemetry|logging|backup)\b/,
    );
    const proposedName = nameMatch?.[1] ? nameMatch[1].replace(/\s+/g, "-") : "testing-e2e";
    const after =
      findNode() ||
      nodes.find((n) => n.status === "running") ||
      nodes[nodes.length - 2] ||
      nodes[0];
    return { kind: "ADD_NODE", proposedName, after };
  }

  if (
    /(supprime|enl[èe]ve|remove|delete|drop).*(n[oœ]ud|node|étape)/.test(t) ||
    /\bsupprime\b|\bremove\b/.test(t)
  ) {
    const node = findNode();
    if (node) return { kind: "REMOVE_NODE", node };
  }

  if (
    /(modifie|change|update|édite|edite).*(instructions?|prompt|consignes?)/.test(t) ||
    /(instructions?|prompt).*?\b(modifie|change|update)/.test(t)
  ) {
    const node = findNode() || nodes.find((n) => n.status === "pending") || nodes[0];
    if (node) return { kind: "UPDATE_INSTRUCTIONS", node };
  }

  if (/(stoppe|arr[êe]te|stop|kill).*(n[oœ]ud|node|\b)/.test(t)) {
    const node = findNode() || nodes.find((n) => n.status === "running");
    if (node) return { kind: "STOP_NODE", node };
  }

  if (/(reprends?|resume|relance|restart).*(n[oœ]ud|node|\b)/.test(t)) {
    const node = findNode();
    if (node) return { kind: "RESUME_NODE", node };
  }

  if (
    /(pourquoi|why|diagnostique|diagnose|analyse).*(échou|échec|failed|fail|cassé|erreur|error|bug)/.test(
      t,
    ) ||
    /(échou|failed)/.test(t)
  ) {
    const node = findNode() || nodes.find((n) => n.status === "failed");
    return { kind: "DIAGNOSE", node };
  }

  if (/(réorganise|reordonne|reorder|déplace|move).*(n[oœ]ud|node|workflow|graphe)/.test(t)) {
    return { kind: "REORDER" };
  }

  return { kind: "HELP" };
}

export function buildResponse(intent: Intent, ctx: BrainContext): BrainResponse {
  const fmtNode = (n: { id?: string; name?: string } | undefined | null): string =>
    `\`${n?.name || n?.id || "node"}\``;

  switch (intent.kind) {
    case "ADD_NODE": {
      const name = intent.proposedName;
      const after = intent.after;
      return {
        reply: `Compris. J'ajoute un nœud ${fmtNode({ id: name })} après ${fmtNode(
          after,
        )}. Il s'exécutera en parallèle des autres workers une fois ${fmtNode(
          after,
        )} terminé, avec le délai par défaut du projet (10 min).`,
        action: { type: "ADD_NODE", nodeId: name, name, after: after?.id, phase: "worker" },
        actionCardLabel: "Nouveau worker",
        actionCardTone: "add",
        actionCardTarget: name,
      };
    }
    case "REMOVE_NODE": {
      const n = intent.node;
      const running = n.status === "running";
      return {
        reply: running
          ? `Tu veux que je supprime ${fmtNode(n)} ? Il est en cours d'exécution — il faut d'abord le **stopper**. Continuer ?`
          : `Suppression de ${fmtNode(n)} prête. Cette action est réversible (rollback dispo dans la timeline).`,
        action: { type: "REMOVE_NODE", nodeId: n.id, name: n.name },
        confirm: running ? { reason: "running" } : null,
        actionCardLabel: "Suppression",
        actionCardTone: "remove",
        actionCardTarget: n.name,
      };
    }
    case "UPDATE_INSTRUCTIONS": {
      const n = intent.node;
      return {
        reply: `Modifications appliquées sur ${fmtNode(n)}. Voici le diff :`,
        action: { type: "UPDATE_INSTRUCTIONS", nodeId: n.id, name: n.name },
        confirm: n.status === "running" ? { reason: "running" } : null,
        actionCardLabel: "Instructions",
        actionCardTone: "update",
        actionCardTarget: n.name,
        diff: [
          { type: "ctx", text: "Implémente la couverture E2E des flows critiques." },
          { type: "del", text: "- Authentification (login, logout)" },
          { type: "add", text: "+ Authentification (login, logout, session expirée, MFA)" },
          { type: "ctx", text: "- Checkout complet (panier → paiement → confirmation)" },
          { type: "add", text: "+ Couverture mobile viewport (375px) sur les routes principales" },
        ],
      };
    }
    case "STOP_NODE": {
      const n = intent.node;
      return {
        reply: `Nœud ${fmtNode(n)} stoppé. Tu peux suivre l'évolution dans le panneau de détail au-dessus.`,
        action: { type: "STOP_NODE", nodeId: n.id, name: n.name },
        actionCardLabel: "Stop",
        actionCardTone: "warn",
        actionCardTarget: n.name,
      };
    }
    case "RESUME_NODE": {
      const n = intent.node;
      return {
        reply: `Nœud ${fmtNode(n)} repris. Démarrage imminent dès que les parents sont satisfaits.`,
        action: { type: "RESUME_NODE", nodeId: n.id, name: n.name },
        actionCardLabel: "Reprise",
        actionCardTone: "add",
        actionCardTarget: n.name,
      };
    }
    case "DIAGNOSE": {
      const n = intent.node || (ctx.nodes || []).find((x) => x.status === "failed");
      if (!n) {
        return {
          reply: `Aucun nœud en échec pour l'instant. Si tu vois un état suspect, donne-moi son nom et je creuse.`,
        };
      }
      return {
        reply: `Diagnostic de ${fmtNode(n)} :\n\n- L'erreur vient de **\`auth/middleware.ts:42\`** — le JWT n'est pas validé contre la nouvelle clé tournée hier.\n- Cause probable : la migration \`models\` n'a pas propagé la clé publique dans le secret store.\n- **Action proposée** : relancer ${fmtNode({ name: "models" })} avec l'option \`--rotate-keys\` puis reprendre ${fmtNode(n)}. Je le fais ?`,
        actionCardLabel: "Diagnostic",
        actionCardTone: "warn",
        actionCardTarget: n.name,
      };
    }
    case "REORDER": {
      return {
        reply: `Je peux reorganiser les nœuds. Précise quel ordre tu vises — par exemple "tests avant docs" ou "auth en parallèle de api".`,
      };
    }
    case "HELP":
    default: {
      return {
        reply: `Je peux modifier ton workflow en direct. Quelques exemples :\n\n- **Ajouter un nœud** : "ajoute un nœud testing-e2e"\n- **Supprimer** : "supprime le nœud docs"\n- **Modifier les instructions** : "change les instructions de api"\n- **Stopper / reprendre** : "stoppe ui-pages", "reprends auth"\n- **Diagnostic** : "pourquoi auth a échoué ?"`,
      };
    }
  }
}

export function suggestionsFor(workflowState: string): string[] {
  switch (workflowState) {
    case "running":
      return [
        "Ajoute un nœud testing-e2e",
        "Stoppe le nœud ui-pages",
        "Pourquoi auth a échoué ?",
        "Modifie les instructions de api",
      ];
    case "done":
      return [
        "Ajoute une feature à ce projet",
        "Génère un nouveau workflow",
        "Documente l'API",
      ];
    case "failed":
      return ["Diagnostique l'échec", "Reprends et corrige", "Supprime le nœud cassé"];
    default:
      return ["Ajoute un worker", "Modifie les instructions", "Aide"];
  }
}

/* ============================================================================
   Mock initial chat history — what Loom and the user already said.
   ============================================================================ */

export interface SeedMessage {
  id: string;
  from: "loom" | "user";
  ts: number;
  text: string;
  actionCardLabel?: string;
  actionCardTone?: "add" | "remove" | "update" | "warn";
  actionCardTarget?: string;
  diff?: DiffEntry[];
}

export const SEED_MESSAGES: SeedMessage[] = [
  {
    id: "s1",
    from: "loom",
    ts: Date.now() - 1000 * 60 * 38,
    text: `Workflow démarré. Je surveille les neuf workers et je peux intervenir si tu repères quelque chose. Demande-moi à n'importe quel moment.`,
  },
  {
    id: "s2",
    from: "user",
    ts: Date.now() - 1000 * 60 * 32,
    text: "Modifie les instructions de api : ajoute la validation Zod sur tous les endpoints.",
  },
  {
    id: "s3",
    from: "loom",
    ts: Date.now() - 1000 * 60 * 31.5,
    text: `Modifications appliquées sur \`api\`. La validation Zod est ajoutée comme contrainte transverse — je l'ai propagée aux 14 endpoints détectés.`,
    actionCardLabel: "Instructions",
    actionCardTone: "update",
    actionCardTarget: "api",
    diff: [
      { type: "ctx", text: "Endpoints CRUD + validation des requêtes." },
      { type: "del", text: "- Validation manuelle ad-hoc" },
      { type: "add", text: "+ Schémas Zod par endpoint, dans `src/api/schemas/*.ts`" },
      { type: "add", text: "+ Middleware `validate(schema)` réutilisable" },
    ],
  },
  {
    id: "s4",
    from: "user",
    ts: Date.now() - 1000 * 60 * 12,
    text: "Ok merci. Le nœud auth est bloqué, c'est normal ?",
  },
  {
    id: "s5",
    from: "loom",
    ts: Date.now() - 1000 * 60 * 11.8,
    text: `\`auth\` est en attente de \`models\` qui termine son ETA dans environ 90s. Rien d'anormal — je te ping si ça dépasse 3 min.`,
  },
];

export interface SeedHistoryEntry {
  id: string;
  by: "loom" | "user";
  kind: IntentKind | "REORDER";
  target: string;
  desc: string;
  ts: number;
  atomic: boolean;
}

export const SEED_HISTORY: SeedHistoryEntry[] = [
  {
    id: "h1",
    by: "loom",
    kind: "UPDATE_INSTRUCTIONS",
    target: "api",
    desc: "A modifié les instructions de `api`",
    ts: Date.now() - 1000 * 60 * 31,
    atomic: true,
  },
  {
    id: "h2",
    by: "user",
    kind: "STOP_NODE",
    target: "ui-components",
    desc: "A stoppé `ui-components`",
    ts: Date.now() - 1000 * 60 * 22,
    atomic: true,
  },
  {
    id: "h3",
    by: "user",
    kind: "RESUME_NODE",
    target: "ui-components",
    desc: "A repris `ui-components`",
    ts: Date.now() - 1000 * 60 * 19,
    atomic: true,
  },
  {
    id: "h4",
    by: "loom",
    kind: "ADD_NODE",
    target: "cache-layer",
    desc: "A ajouté le nœud `cache-layer`",
    ts: Date.now() - 1000 * 60 * 14,
    atomic: true,
  },
  {
    id: "h5",
    by: "loom",
    kind: "REORDER",
    target: "workflow",
    desc: "A réorganisé 3 nœuds (tests → docs)",
    ts: Date.now() - 1000 * 60 * 8,
    atomic: false,
  },
];
