import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "../Icon.js";
import type {
  BrainContext,
  BrainNode,
  BrainResponse,
  DiffEntry,
  SeedHistoryEntry,
  SeedMessage,
} from "../../lib/loomBrain.js";
import { buildResponse, detectIntent, suggestionsFor } from "../../lib/loomBrain.js";
import "./LoomChatPanel.css";

/* ============================================================================
   Time helpers
   ============================================================================ */

function fmtClock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 5);
}

function fmtAgo(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `il y a ${String(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `il y a ${String(m)} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${String(h)}h`;
  const d = Math.floor(h / 24);
  return `il y a ${String(d)}j`;
}

/* ============================================================================
   Tiny markdown renderer (paragraphs, **bold**, `code`, lists)
   ============================================================================ */

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let key = 0;
  let rest = text;
  while (rest.length > 0) {
    const boldMatch = rest.match(/^(.*?)\*\*([^*]+)\*\*/);
    const codeMatch = rest.match(/^(.*?)`([^`]+)`/);
    const boldIdx = boldMatch?.index ?? Number.POSITIVE_INFINITY;
    const codeIdx = codeMatch?.index ?? Number.POSITIVE_INFINITY;
    const next =
      boldMatch && boldIdx <= codeIdx
        ? { type: "bold" as const, m: boldMatch }
        : codeMatch
          ? { type: "code" as const, m: codeMatch }
          : null;
    if (!next) {
      parts.push(rest);
      break;
    }
    if (next.m[1]) parts.push(next.m[1]);
    if (next.type === "bold") parts.push(<strong key={key++}>{next.m[2]}</strong>);
    else parts.push(<code key={key++}>{next.m[2]}</code>);
    rest = rest.slice(next.m[0].length);
  }
  return parts;
}

function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const out: ReactNode[] = [];
  let key = 0;
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]?.trim()) {
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(lines[i] ?? "")) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={key++}>
          {items.map((it, k) => (
            <li key={k}>{renderInline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^\s*[-*]\s+/.test(lines[i] ?? "")) {
      para.push(lines[i] ?? "");
      i++;
    }
    out.push(<p key={key++}>{renderInline(para.join(" "))}</p>);
  }
  return <>{out}</>;
}

/* ============================================================================
   Action card + diff block
   ============================================================================ */

function ActionCard({
  tone,
  label,
  target,
}: {
  tone: "add" | "remove" | "update" | "warn";
  label: string;
  target: string;
}) {
  const Glyph =
    tone === "add"
      ? Icon.Plus
      : tone === "remove"
        ? Icon.Trash
        : tone === "update"
          ? Icon.Edit
          : Icon.Pause;
  return (
    <div className="lc-action-card">
      <span className="ic" data-tone={tone}>
        <Glyph width="11" height="11" />
      </span>
      <span className="label">{label}</span>
      <span className="target">·</span>
      <span className="target">
        <code>{target}</code>
      </span>
    </div>
  );
}

function DiffBlock({ lines }: { lines: DiffEntry[] }) {
  return (
    <div className="lc-diff">
      {lines.map((l, i) => (
        <div key={i} className={`line ${l.type}`}>
          <span className="marker">{l.type === "add" ? "+" : l.type === "del" ? "−" : " "}</span>
          <span>{l.text.replace(/^[-+]\s*/, "")}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   Single message bubble
   ============================================================================ */

function Msg({ m }: { m: SeedMessage }) {
  return (
    <div className="lc-msg" data-from={m.from}>
      {m.from === "loom" && <div className="lc-mini-avatar">Lo</div>}
      <div className="lc-bubble-wrap">
        <span className="lc-byline">
          <span>{m.from === "loom" ? "Loom" : "Toi"}</span>
          <span>·</span>
          <span>{fmtClock(m.ts)}</span>
        </span>
        <div className="lc-bubble" data-from={m.from}>
          <Markdown source={m.text} />
          {m.actionCardLabel && m.actionCardTone && m.actionCardTarget && (
            <ActionCard
              tone={m.actionCardTone}
              label={m.actionCardLabel}
              target={m.actionCardTarget}
            />
          )}
          {m.diff && <DiffBlock lines={m.diff} />}
        </div>
      </div>
      {m.from === "user" && <div className="lc-mini-avatar user">Toi</div>}
    </div>
  );
}

/* ============================================================================
   History drawer (timeline of applied actions)
   ============================================================================ */

function HistoryDrawer({
  open,
  history,
  onClose,
}: {
  open: boolean;
  history: SeedHistoryEntry[];
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "loom" | "user">("all");
  const [q, setQ] = useState("");
  if (!open) return null;
  const filtered = history.filter((h) => {
    if (filter !== "all" && h.by !== filter) return false;
    if (
      q &&
      !(
        h.desc.toLowerCase().includes(q.toLowerCase()) ||
        h.target.toLowerCase().includes(q.toLowerCase())
      )
    )
      return false;
    return true;
  });
  return (
    <>
      <div className="lc-drawer-bg" onClick={onClose} />
      <div className="lc-drawer" role="dialog" aria-label="Timeline des actions">
        <div className="lc-drawer-head">
          <div>
            <h3>Timeline des actions</h3>
            <div className="meta">
              {history.length} entrées ·{" "}
              {history.filter((h) => h.by === "loom").length} par Loom
            </div>
          </div>
          <button className="lc-mini-btn" onClick={onClose} aria-label="Fermer">
            <Icon.X width="14" height="14" />
          </button>
        </div>
        <div className="lc-drawer-filters">
          <div className="lc-drawer-search">
            <Icon.Search width="13" height="13" />
            <input
              type="text"
              placeholder="Rechercher une action…"
              value={q}
              onChange={(e) => { setQ(e.target.value); }}
            />
          </div>
          <div className="lc-drawer-tabs">
            {(["all", "loom", "user"] as const).map((f) => (
              <button
                key={f}
                className="lc-drawer-tab"
                data-active={filter === f}
                onClick={() => { setFilter(f); }}
              >
                {f === "all" ? "Tout" : f === "loom" ? "Loom" : "Toi"}
              </button>
            ))}
          </div>
        </div>
        <ul className="lc-drawer-list">
          {filtered.length === 0 && (
            <li className="lc-drawer-empty">Aucune action correspondante.</li>
          )}
          {filtered.map((h) => (
            <li key={h.id} className="lc-drawer-item">
              <div className="lc-drawer-item-head">
                <span className="lc-drawer-by" data-by={h.by}>
                  {h.by === "loom" ? "Lo" : "Toi"}
                </span>
                <span className="lc-drawer-desc">{h.desc}</span>
              </div>
              <div className="lc-drawer-item-meta">
                <span>{fmtAgo(Date.now() - h.ts)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/* ============================================================================
   Confirm modal — running node modification
   ============================================================================ */

function ConfirmModal({
  open,
  target,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  target: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="lc-modal-bg" onClick={onCancel}>
      <div className="lc-modal" onClick={(e) => { e.stopPropagation(); }}>
        <div className="head">
          <div className="ic">
            <Icon.AlertTriangle width="20" height="20" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h3>Modifier un nœud en cours</h3>
            <p>
              Loom souhaite modifier le nœud <code>{target}</code> actuellement en cours
              d'exécution. Cela nécessite de le stopper d'abord. Continuer ?
            </p>
          </div>
        </div>
        <div className="lc-modal-actions">
          <button className="lc-btn" onClick={onCancel}>
            Annuler
          </button>
          <button className="lc-btn lc-btn--primary" onClick={onConfirm}>
            <Icon.Pause width="11" height="11" /> Stopper et modifier
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   Public LoomChatPanel — drives detectIntent / buildResponse against props.nodes
   ============================================================================ */

export interface LoomChatPanelProps {
  nodes: BrainNode[];
  workflowState: string;
  initialMessages: SeedMessage[];
  initialHistory?: SeedHistoryEntry[];
  focusToken?: number;
  onApplyAction?: (response: BrainResponse) => void;
  /**
   * When provided, user submissions are sent through this callback instead of
   * going through the local intent detector. The string returned is streamed
   * back as Loom's reply. Used by WorkflowPage to route messages through
   * POST /chat.
   */
  onSendMessage?: (text: string) => Promise<string>;
  /**
   * When provided, displayed messages mirror this prop (controlled mode).
   * Used by callers that already track chat history via useChat — the panel
   * shows whatever they hand over rather than maintaining its own copy.
   */
  liveMessages?: SeedMessage[];
}

export function LoomChatPanel({
  nodes,
  workflowState,
  initialMessages,
  initialHistory = [],
  focusToken,
  onApplyAction,
  onSendMessage,
  liveMessages,
}: LoomChatPanelProps) {
  const controlled = liveMessages !== undefined;
  const [localMessages, setLocalMessages] = useState(initialMessages);
  const messages = controlled ? liveMessages : localMessages;
  const setMessages = controlled
    ? (_updater: SeedMessage[] | ((prev: SeedMessage[]) => SeedMessage[])): void => {
        // Controlled mode: parent owns the message list — we cannot append.
        void _updater;
      }
    : setLocalMessages;
  const [history] = useState(initialHistory);
  const [streamingText, setStreamingText] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<BrainResponse | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [stick, setStick] = useState(true);
  const [input, setInput] = useState("");

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${String(Math.min(96, el.scrollHeight))}px`;
  }, [input]);

  useEffect(() => {
    if (!focusToken) return;
    taRef.current?.focus();
  }, [focusToken]);

  useLayoutEffect(() => {
    if (!stick) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, thinking, stick]);

  const streamReply = (reply: string, onDone?: () => void): void => {
    const id = "lo_" + Math.random().toString(36).slice(2, 9);
    setStreamingId(id);
    setStreamingText("");
    let acc = "";
    let idx = 0;
    const tick = () => {
      acc += reply[idx] ?? "";
      idx++;
      setStreamingText(acc);
      if (idx >= reply.length) {
        clearInterval(handle);
        setStreamingId(null);
        setStreamingText("");
        if (onDone) onDone();
      }
    };
    const handle = window.setInterval(tick, 25);
  };

  const handleSubmit = (text: string) => {
    if (!controlled) {
      const userMsg: SeedMessage = {
        id: "u_" + Math.random().toString(36).slice(2, 9),
        from: "user",
        ts: Date.now(),
        text,
      };
      setMessages((prev) => [...prev, userMsg]);
    }
    setThinking(true);

    // Daemon-backed path: route to /chat via the supplied callback. The user
    // and assistant messages are owned by the parent's useChat hook.
    if (onSendMessage) {
      void onSendMessage(text)
        .then((reply) => {
          setThinking(false);
          streamReply(reply);
        })
        .catch((err: unknown) => {
          setThinking(false);
          streamReply(
            `Loom n'a pas répondu — ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      return;
    }

    const ctx: BrainContext = { nodes };
    const intent = detectIntent(text, ctx);
    const response = buildResponse(intent, ctx);

    if (response.confirm) {
      setThinking(false);
      setPendingConfirm(response);
      return;
    }

    streamReply(response.reply, () => {
      setThinking(false);
      const loomMsg: SeedMessage = {
        id: "lo_" + Math.random().toString(36).slice(2, 9),
        from: "loom",
        ts: Date.now(),
        text: response.reply,
        ...(response.actionCardLabel ? { actionCardLabel: response.actionCardLabel } : {}),
        ...(response.actionCardTone ? { actionCardTone: response.actionCardTone } : {}),
        ...(response.actionCardTarget ? { actionCardTarget: response.actionCardTarget } : {}),
        ...(response.diff ? { diff: response.diff } : {}),
      };
      setMessages((prev) => [...prev, loomMsg]);
      if (onApplyAction) onApplyAction(response);
    });
  };

  const submit = () => {
    const v = input.trim();
    if (!v) return;
    handleSubmit(v);
    setInput("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStick(dist < 40);
  };

  const suggestions = suggestionsFor(workflowState);

  return (
    <div className="lc-chat">
      <div className="lc-chat-header">
        <div className="lc-loom-avatar" aria-label="Loom">
          Lo
        </div>
        <div className="id">
          <span className="name">
            Loom
            <span className="lc-online">
              <span className="dot" />
              En ligne
            </span>
          </span>
          <span className="role">architecte du workflow</span>
        </div>
        <div className="lc-chat-actions">
          <button
            className="lc-mini-btn"
            data-active={historyOpen}
            onClick={() => { setHistoryOpen((o) => !o); }}
            aria-label="Timeline des actions"
            title="Timeline des actions"
          >
            <Icon.Clock width="14" height="14" />
          </button>
        </div>
      </div>

      <div className="lc-stream" ref={scrollRef} onScroll={onScroll}>
        <div className="lc-day">aujourd'hui</div>
        {messages.map((m) => (
          <Msg key={m.id} m={m} />
        ))}
        {streamingId && (
          <div className="lc-msg" data-from="loom">
            <div className="lc-mini-avatar">Lo</div>
            <div className="lc-bubble-wrap">
              <span className="lc-byline">
                <span>Loom</span>
              </span>
              <div className="lc-bubble" data-from="loom" data-streaming="true">
                <span className="lc-caret">
                  <Markdown source={streamingText} />
                </span>
              </div>
            </div>
          </div>
        )}
        {thinking && (
          <div className="lc-msg" data-from="loom">
            <div className="lc-mini-avatar">Lo</div>
            <div className="lc-typing">
              Loom réfléchit
              <span className="lc-typing-dots">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="lc-composer">
        <div className="lc-suggestions">
          {suggestions.slice(0, 4).map((s, i) => (
            <button key={i} className="lc-chip" onClick={() => { setInput(s); }}>
              <Icon.Sparkles width="11" height="11" /> {s}{" "}
              <Icon.ChevronRight className="arrow" width="11" height="11" />
            </button>
          ))}
        </div>
        <div className="lc-input-wrap">
          <textarea
            ref={taRef}
            className="lc-textarea"
            rows={1}
            placeholder="Demande à Loom de modifier le workflow…"
            value={input}
            onChange={(e) => { setInput(e.target.value); }}
            onKeyDown={onKeyDown}
          />
          <button
            className="lc-send"
            onClick={submit}
            disabled={!input.trim()}
            aria-label="Envoyer"
          >
            <Icon.Send width="14" height="14" />
          </button>
        </div>
        <div className="lc-input-meta">
          <span>
            <span className="lc-kbd">⌘</span> <span className="lc-kbd">L</span> pour focus
          </span>
          <span>
            <span className="lc-kbd">↵</span> envoyer ·{" "}
            <span className="lc-kbd">⇧↵</span> nouvelle ligne
          </span>
        </div>
      </div>

      <HistoryDrawer
        open={historyOpen}
        history={history}
        onClose={() => { setHistoryOpen(false); }}
      />

      <ConfirmModal
        open={!!pendingConfirm}
        target={pendingConfirm?.actionCardTarget ?? ""}
        onCancel={() => { setPendingConfirm(null); }}
        onConfirm={() => {
          if (pendingConfirm) {
            const id = "lo_" + Math.random().toString(36).slice(2, 9);
            const msg: SeedMessage = {
              id,
              from: "loom",
              ts: Date.now(),
              text: pendingConfirm.reply,
              ...(pendingConfirm.actionCardLabel
                ? { actionCardLabel: pendingConfirm.actionCardLabel }
                : {}),
              ...(pendingConfirm.actionCardTone
                ? { actionCardTone: pendingConfirm.actionCardTone }
                : {}),
              ...(pendingConfirm.actionCardTarget
                ? { actionCardTarget: pendingConfirm.actionCardTarget }
                : {}),
              ...(pendingConfirm.diff ? { diff: pendingConfirm.diff } : {}),
            };
            setMessages((prev) => [...prev, msg]);
            if (onApplyAction) onApplyAction(pendingConfirm);
          }
          setPendingConfirm(null);
        }}
      />
    </div>
  );
}
