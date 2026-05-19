import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { useApi, useAppContext } from "../context/AppContext.js";
import { useProjectStore } from "../context/ProjectStoreContext.js";
import { useTheme } from "../context/ThemeContext.js";
import "./BrainstormPage.css";

/* ============================================================================
   Constants
   ============================================================================ */

const bsKey = (id: string) => `loomflo.brainstorm.${id}`;

interface ResonanceMode {
  id: "light" | "medium" | "deep";
  label: string;
  tag: string;
  /** Heuristic target number of Loom replies before the launch CTA unlocks. */
  questions: number;
  desc: string;
}

const RESONANCE_MODES: ResonanceMode[] = [
  { id: "light", label: "Léger", tag: "1–2 questions", questions: 2, desc: "Pour un MVP rapide." },
  { id: "medium", label: "Moyen", tag: "4–5 questions", questions: 5, desc: "Équilibré, défaut." },
  { id: "deep", label: "Profond", tag: "10+ questions", questions: 11, desc: "Exploration exhaustive." },
];

const THINKING_LABELS = [
  "Loom analyse…",
  "Loom rédige…",
  "Loom réfléchit…",
  "Loom structure sa réponse…",
];

const WELCOME_TEXT = `Salut. Je suis **Loom**, l'architecte. Mon job : **clarifier ta vision** avant que les agents génèrent la spec.

Décris-moi ton projet en quelques phrases — je te poserai ensuite des questions ciblées pour cadrer le tout.`;

const OFFLINE_NOTICE = `Daemon non connecté. Lance \`loomflo daemon\` et reviens sur ce projet pour démarrer le brainstorming avec Loom.`;

/* ============================================================================
   Tiny markdown renderer (paragraphs, **bold**, *italic*, `code`, lists, h2/h3)
   ============================================================================ */

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  const matches = Array.from(text.matchAll(re));
  let lastIdx = 0;
  let key = 0;
  for (const m of matches) {
    const idx = m.index;
    if (idx > lastIdx) parts.push(text.slice(lastIdx, idx));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    else parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    lastIdx = idx + tok.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

function Markdown({ source }: { source: string }) {
  const lines = (source || "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
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
    if (/^### /.test(line)) {
      out.push(<h3 key={key++}>{renderInline(line.replace(/^### /, ""))}</h3>);
      i++;
      continue;
    }
    if (/^## /.test(line)) {
      out.push(<h2 key={key++}>{renderInline(line.replace(/^## /, ""))}</h2>);
      i++;
      continue;
    }
    if (/^# /.test(line)) {
      out.push(<h1 key={key++}>{renderInline(line.replace(/^# /, ""))}</h1>);
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() &&
      !/^\s*[-*]\s+/.test(lines[i] ?? "") &&
      !/^#{1,3} /.test(lines[i] ?? "")
    ) {
      para.push(lines[i] ?? "");
      i++;
    }
    out.push(<p key={key++}>{renderInline(para.join(" "))}</p>);
  }
  return <>{out}</>;
}

/* ============================================================================
   Types
   ============================================================================ */

interface BsMessage {
  id: string;
  from: "loom" | "user";
  text: string;
  ts: number;
}

interface PersistedState {
  messages: BsMessage[];
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/* ============================================================================
   Sub-components
   ============================================================================ */

function MessageRow({ msg }: { msg: BsMessage }) {
  if (msg.from === "loom") {
    return (
      <div className="bs-msg-row" data-from="loom">
        <div className="bs-avatar" title="Loom — Architecte">
          L
        </div>
        <div className="bs-bubble-wrap">
          <div className="bs-byline">
            <span className="name">Loom</span>
            <span>·</span>
            <span className="time">{formatTime(msg.ts)}</span>
          </div>
          <div className="bs-bubble" data-from="loom">
            <Markdown source={msg.text} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="bs-msg-row" data-from="user">
      <div className="bs-bubble-wrap">
        <div className="bs-byline">
          <span className="time">{formatTime(msg.ts)}</span>
          <span>·</span>
          <span className="name">vous</span>
        </div>
        <div className="bs-bubble" data-from="user">
          <Markdown source={msg.text} />
        </div>
      </div>
      <div className="bs-avatar user" title="Vous">
        YO
      </div>
    </div>
  );
}

function ConfirmLaunch({
  projectName,
  projectType,
  messages,
  resonance,
  onCancel,
  onConfirm,
}: {
  projectName: string;
  projectType: "scratch" | "feature";
  messages: BsMessage[];
  resonance: ResonanceMode["id"];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const userMsgs = messages.filter((m) => m.from === "user").length;
  const loomMsgs = messages.filter((m) => m.from === "loom").length;
  const modeLabel = RESONANCE_MODES.find((m) => m.id === resonance)?.label ?? resonance;
  return (
    <div className="bs-modal-bg" onClick={onCancel}>
      <div className="bs-modal" onClick={(e) => { e.stopPropagation(); }} role="dialog" aria-modal="true">
        <div className="bs-modal-icon">
          <Icon.Sparkles width="22" height="22" />
        </div>
        <h3>Lancer la génération de la spec</h3>
        <p>
          Loom va envoyer toute cette conversation aux agents de génération de spec. Tu pourras
          suivre la progression en temps réel sur la page workflow. Tu peux toujours revenir au
          brainstorming plus tard.
        </p>
        <div className="bs-modal-recap">
          <div className="bs-modal-recap-row">
            <span className="k">projet</span>
            <span className="v">{projectName}</span>
          </div>
          <div className="bs-modal-recap-row">
            <span className="k">messages échangés</span>
            <span className="v">
              {userMsgs} envoyés · {loomMsgs} reçus
            </span>
          </div>
          <div className="bs-modal-recap-row">
            <span className="k">mode résonance</span>
            <span className="v">{modeLabel}</span>
          </div>
          <div className="bs-modal-recap-row">
            <span className="k">type</span>
            <span className="v">{projectType === "scratch" ? "from scratch" : "add feature"}</span>
          </div>
        </div>
        <div className="bs-modal-actions">
          <button className="bs-btn bs-btn--ghost" onClick={onCancel}>
            Annuler
          </button>
          <button className="bs-btn bs-btn--primary" onClick={onConfirm}>
            <Icon.Sparkles width="14" height="14" /> Lancer
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmSkip({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="bs-modal-bg" onClick={onCancel}>
      <div className="bs-modal" onClick={(e) => { e.stopPropagation(); }} role="dialog">
        <div
          className="bs-modal-icon"
          style={{
            background: "var(--status-waiting-bg)",
            borderColor: "color-mix(in oklab, var(--status-waiting-fg) 30%, transparent)",
            color: "var(--status-waiting-fg)",
          }}
        >
          <Icon.AlertTriangle width="20" height="20" />
        </div>
        <h3>Sauter le brainstorming ?</h3>
        <p>
          Lancer la spec sans questions clarifiantes ? Loom devra deviner ton intention à partir de
          ton prompt initial — la spec sera plus générique et nécessitera probablement plus de
          retouches.
        </p>
        <div className="bs-modal-actions">
          <button className="bs-btn bs-btn--ghost" onClick={onCancel}>
            Continuer le brainstorming
          </button>
          <button className="bs-btn" onClick={onConfirm}>
            Sauter quand même
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmReset({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="bs-modal-bg" onClick={onCancel}>
      <div className="bs-modal" onClick={(e) => { e.stopPropagation(); }} role="dialog">
        <div
          className="bs-modal-icon"
          style={{
            background: "var(--status-failed-bg)",
            borderColor: "color-mix(in oklab, var(--status-failed-fg) 30%, transparent)",
            color: "var(--status-failed-fg)",
          }}
        >
          <Icon.RotateCcw width="20" height="20" />
        </div>
        <h3>Réinitialiser la conversation ?</h3>
        <p>
          Toute la conversation actuelle avec Loom sera effacée. Cette action est irréversible.
        </p>
        <div className="bs-modal-actions">
          <button className="bs-btn bs-btn--ghost" onClick={onCancel}>
            Annuler
          </button>
          <button
            className="bs-btn"
            style={{
              color: "var(--status-failed-fg)",
              borderColor: "color-mix(in oklab, var(--status-failed-fg) 30%, transparent)",
            }}
            onClick={onConfirm}
          >
            Réinitialiser
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   BrainstormPage
   ============================================================================ */

export function BrainstormPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const api = useApi();
  const { token } = useAppContext();
  const { projects } = useProjectStore();
  const { theme, toggleTheme } = useTheme();

  const project = useMemo(() => {
    if (!projectId) return null;
    return projects.find((p) => p.id === projectId) ?? null;
  }, [projectId, projects]);

  const [projectType] = useState<"scratch" | "feature">("scratch");

  const [resonance, setResonance] = useState<ResonanceMode["id"]>("medium");
  const targetExchanges = useMemo(
    () => RESONANCE_MODES.find((m) => m.id === resonance)?.questions ?? 5,
    [resonance],
  );

  const initialState = useMemo<PersistedState | null>(() => {
    if (!projectId) return null;
    try {
      const raw = localStorage.getItem(bsKey(projectId));
      if (raw) return JSON.parse(raw) as PersistedState;
    } catch {
      /* localStorage unavailable */
    }
    return null;
  }, [projectId]);

  const [messages, setMessages] = useState(initialState?.messages ?? []);
  const [thinking, setThinking] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState(THINKING_LABELS[0] ?? "Loom réfléchit…");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [streamingFull, setStreamingFull] = useState("");
  const [hasBootstrapped, setHasBootstrapped] = useState(
    !!initialState?.messages.length,
  );
  const [inputVal, setInputVal] = useState("");
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [stickyScroll, setStickyScroll] = useState(true);
  const [launching, setLaunching] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const loomMessageCount = useMemo(
    () => messages.filter((m) => m.from === "loom").length,
    [messages],
  );

  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem(bsKey(projectId), JSON.stringify({ messages }));
    } catch {
      /* localStorage unavailable */
    }
  }, [messages, projectId]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => { setToast(null); }, 2400);
  }, []);

  const beginStream = useCallback((fullText: string, onDone?: () => void) => {
    const id = "m_" + Math.random().toString(36).slice(2, 9);
    setStreamingId(id);
    setStreamingText("");
    setStreamingFull(fullText);
    let i = 0;
    // ~40 chars/sec — matches the streaming UX from the constitution.
    const stepMs = 25;
    const tick = () => {
      i = Math.min(i + 1, fullText.length);
      setStreamingText(fullText.slice(0, i));
      if (i < fullText.length) {
        streamTimerRef.current = window.setTimeout(tick, stepMs);
      } else {
        setMessages((ms) => [...ms, { id, from: "loom", text: fullText, ts: Date.now() }]);
        setStreamingId(null);
        setStreamingText("");
        setStreamingFull("");
        if (onDone) onDone();
      }
    };
    streamTimerRef.current = window.setTimeout(tick, stepMs);
  }, []);

  const skipStream = useCallback(() => {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    if (!streamingId) return;
    const id = streamingId;
    const full = streamingFull;
    setMessages((ms) => [...ms, { id, from: "loom", text: full, ts: Date.now() }]);
    setStreamingId(null);
    setStreamingText("");
    setStreamingFull("");
  }, [streamingId, streamingFull]);

  useLayoutEffect(() => {
    if (!stickyScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, thinking, stickyScroll]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickyScroll(dist < 60);
  };

  // Hydrate from /chat/history on first mount when authenticated, falling back
  // to the persisted localStorage transcript if the daemon has nothing yet.
  useEffect(() => {
    if (hasBootstrapped || !projectId) return;
    setHasBootstrapped(true);
    if (!token) {
      // No daemon connection — show offline notice once and stop.
      beginStream(OFFLINE_NOTICE);
      return;
    }
    let cancelled = false;
    void api
      .getChatHistory(projectId)
      .then((res) => {
        if (cancelled) return;
        if (res.messages.length === 0) {
          beginStream(WELCOME_TEXT);
          return;
        }
        setMessages(
          res.messages.map((entry, idx) => ({
            id: `h_${String(idx)}`,
            from: entry.role === "user" ? "user" : "loom",
            text: entry.content,
            ts: new Date(entry.timestamp).getTime(),
          })),
        );
      })
      .catch(() => {
        if (cancelled) return;
        beginStream(WELCOME_TEXT);
      });
    return () => {
      cancelled = true;
    };
  }, [hasBootstrapped, projectId, token, api, beginStream]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streamingId || thinking) return;
    setMessages((ms) => [
      ...ms,
      { id: "u_" + Math.random().toString(36).slice(2, 9), from: "user", text: trimmed, ts: Date.now() },
    ]);
    setInputVal("");

    if (!token || !projectId) {
      beginStream(OFFLINE_NOTICE);
      return;
    }

    setThinking(true);
    setThinkingLabel(
      THINKING_LABELS[Math.floor(Math.random() * THINKING_LABELS.length)] ?? "Loom réfléchit…",
    );
    api
      .postChat(projectId, trimmed)
      .then((res) => {
        setThinking(false);
        beginStream(res.response);
      })
      .catch((err: unknown) => {
        setThinking(false);
        beginStream(
          `Loom n'a pas répondu — ${
            err instanceof Error ? err.message : String(err)
          }.`,
        );
      });
  };

  const onResonanceChange = (id: ResonanceMode["id"]) => {
    if (id === resonance) return;
    setResonance(id);
  };

  const doReset = () => {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    setMessages([]);
    setStreamingId(null);
    setStreamingText("");
    setStreamingFull("");
    setThinking(false);
    setHasBootstrapped(false);
    if (projectId) {
      try {
        localStorage.removeItem(bsKey(projectId));
      } catch {
        /* localStorage unavailable */
      }
    }
    setConfirmReset(false);
    showToast("Conversation réinitialisée");
  };

  const buildDescription = useCallback((): string => {
    // Concatenate the user-side conversation as the spec brief. Loom's own
    // replies are excluded so the description stays focused on the user's
    // intent — the daemon's spec agent will re-read history via /chat if
    // it needs more context.
    const userText = messages
      .filter((m) => m.from === "user")
      .map((m) => m.text.trim())
      .filter(Boolean)
      .join("\n\n");
    if (userText) return userText;
    return project ? `Projet ${project.name}` : "Nouveau projet";
  }, [messages, project]);

  const launchSpec = () => {
    setConfirmLaunch(false);
    if (!projectId || !project) return;
    if (!token) {
      showToast("Daemon non connecté — impossible de lancer la spec");
      return;
    }
    setLaunching(true);
    void api
      .initWorkflow(projectId, {
        description: buildDescription(),
        projectPath: project.projectPath,
      })
      .then(() => {
        showToast("Génération de spec lancée");
        void navigate(`/projects/${projectId}/workflow`);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Échec — ${msg}`);
      })
      .finally(() => {
        setLaunching(false);
      });
  };

  const skipBrainstorm = () => {
    setConfirmSkip(false);
    if (!projectId || !project) return;
    if (!token) {
      void navigate(`/projects/${projectId}/workflow`);
      return;
    }
    setLaunching(true);
    void api
      .initWorkflow(projectId, {
        description: buildDescription(),
        projectPath: project.projectPath,
      })
      .then(() => {
        void navigate(`/projects/${projectId}/workflow`);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Échec — ${msg}`);
      })
      .finally(() => {
        setLaunching(false);
      });
  };

  const onTextareaKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit(inputVal);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(inputVal);
    } else if (e.key === "Escape") {
      (e.target as HTMLTextAreaElement).blur();
    }
  };

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${String(Math.min(ta.scrollHeight, 168))}px`;
  }, [inputVal]);

  if (!projectId || !project) {
    return (
      <div className="bs-app">
        <header className="bs-header">
          <div className="bs-header-left">
            <Link to="/projects" className="bs-back">
              <Icon.ArrowLeft width="14" height="14" /> Projets
            </Link>
          </div>
        </header>
        <div className="bs-main" style={{ padding: 32 }}>
          <p>
            Projet introuvable. <Link to="/projects">Retour</Link>.
          </p>
        </div>
      </div>
    );
  }

  const ready = loomMessageCount >= targetExchanges && !streamingId && !thinking;

  return (
    <div className="bs-app">
      <header className="bs-header">
        <div className="bs-header-left">
          <Link to="/projects" className="bs-back">
            <Icon.ArrowLeft width="14" height="14" /> Projets
          </Link>
          <nav className="bs-crumbs" aria-label="fil d'ariane">
            <span className="seg">Projets</span>
            <span className="sep">›</span>
            <span className="seg proj">{project.name}</span>
            <span className="sep">›</span>
            <span className="seg curr">Brainstorming</span>
          </nav>
        </div>
        <div className="bs-header-center">
          <span className="bs-status-pill">
            <span className="pulse" /> Brainstorming en cours
          </span>
        </div>
        <div className="bs-header-right">
          <button className="bs-skip" onClick={() => { setConfirmSkip(true); }}>
            Sauter le brainstorming
          </button>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Passer au thème clair" : "Passer au thème sombre"}
            title={theme === "dark" ? "Thème clair" : "Thème sombre"}
          >
            {theme === "dark" ? (
              <Icon.Sun width="16" height="16" />
            ) : (
              <Icon.Moon width="16" height="16" />
            )}
          </button>
        </div>
      </header>

      <div className="bs-main">
        <section className="bs-chat" aria-label="Conversation avec Loom">
          <div className="bs-chat-scroll" ref={scrollRef} onScroll={onScroll}>
            <div className="bs-chat-stream">
              <div className="bs-greeting">
                Session brainstorming ·{" "}
                {new Date().toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </div>

              {messages.map((m) => (
                <MessageRow key={m.id} msg={m} />
              ))}

              {streamingId && (
                <div className="bs-msg-row" data-from="loom">
                  <div className="bs-avatar" title="Loom — Architecte">
                    L
                  </div>
                  <div className="bs-bubble-wrap">
                    <div className="bs-byline">
                      <span className="name">Loom</span>
                      <span>·</span>
                      <span className="time">architecte</span>
                    </div>
                    <div className="bs-bubble" data-from="loom" data-streaming="true">
                      <button
                        className="bs-skip-anim"
                        onClick={skipStream}
                        title="Afficher tout de suite"
                      >
                        skip ›
                      </button>
                      <span className="bs-stream-caret">
                        <Markdown source={streamingText} />
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {thinking && (
                <div className="bs-msg-row" data-from="loom">
                  <div className="bs-avatar" title="Loom">
                    L
                  </div>
                  <div className="bs-bubble-wrap">
                    <div className="bs-thinking">
                      <span className="bs-thinking-dots">
                        <span />
                        <span />
                        <span />
                      </span>
                      <span>{thinkingLabel}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {!stickyScroll && (
            <button
              className="bs-resume-scroll"
              onClick={() => {
                setStickyScroll(true);
                const el = scrollRef.current;
                if (el) el.scrollTop = el.scrollHeight;
              }}
            >
              <Icon.ChevronDown width="14" height="14" /> Reprendre le défilement
            </button>
          )}

          <div className="bs-composer">
            <div
              className="bs-input-wrap shimmer-host shimmer"
              data-phase="spec"
              style={{ "--shimmer-delay": "-2s" } as CSSProperties}
            >
              <textarea
                ref={textareaRef}
                className="bs-textarea"
                value={inputVal}
                onChange={(e) => { setInputVal(e.target.value); }}
                onKeyDown={onTextareaKey}
                placeholder="Décris ton projet, réponds aux questions, ou approfondis un point…"
                rows={1}
                spellCheck={true}
              />
              <div className="bs-input-actions">
                <button
                  className="bs-send"
                  onClick={() => { submit(inputVal); }}
                  disabled={!inputVal.trim() || !!streamingId || thinking}
                  aria-label="Envoyer"
                  title="Envoyer (⌘ Enter)"
                >
                  <Icon.Send width="14" height="14" />
                </button>
              </div>
            </div>

            <div className="bs-input-meta">
              <span>
                {streamingId ? "Loom écrit…" : thinking ? "Loom réfléchit…" : "Prêt"}
              </span>
              <span>
                <span className="kbd">⌘</span> <span className="kbd">↵</span> envoyer
              </span>
            </div>
          </div>
        </section>

        <aside className="bs-panel" aria-label="Contexte projet">
          <div className="bs-panel-scroll">
            <div className="bs-panel-title">
              <span>Contexte projet</span>
              <button
                className="reset-btn"
                onClick={() => { setConfirmReset(true); }}
                title="Réinitialiser la conversation"
              >
                <Icon.RotateCcw width="11" height="11" /> reset
              </button>
            </div>

            <div
              className="bs-panel-card shimmer"
              data-phase="worker"
              style={{ "--shimmer-delay": "-1.4s" } as CSSProperties}
            >
              <div className="bs-identity-name">{project.name}</div>
              <div className="bs-identity-rows">
                <div className="bs-identity-row">
                  <span className="label">dossier</span>
                  <span className="val" title={project.projectPath}>
                    {project.projectPath}
                  </span>
                </div>
                <div className="bs-identity-row">
                  <span className="label">id</span>
                  <span className="val">{project.id}</span>
                </div>
                <div className="bs-identity-row">
                  <span className="label">type</span>
                  <span className="type-badge" data-type={projectType}>
                    {projectType === "scratch" ? "from scratch" : "add feature"}
                  </span>
                </div>
              </div>
            </div>

            <div className="bs-panel-card">
              <div>
                <h3>Profondeur du brainstorming</h3>
                <p className="bs-resonance-help" style={{ margin: "4px 0 0" }}>
                  Loom adapte le nombre de questions clarifiantes selon le mode choisi.
                </p>
              </div>
              <div className="bs-segments" role="tablist">
                {RESONANCE_MODES.map((m) => (
                  <button
                    key={m.id}
                    className="bs-segment"
                    role="tab"
                    data-active={resonance === m.id}
                    onClick={() => { onResonanceChange(m.id); }}
                    aria-selected={resonance === m.id}
                  >
                    <span>{m.label}</span>
                    <span className="seg-tag">{m.tag}</span>
                  </button>
                ))}
              </div>

              <div className="bs-progress">
                <div className="bs-progress-row">
                  <span>Échanges avec Loom</span>
                  <span>
                    <span className="num">{Math.min(loomMessageCount, targetExchanges)}</span> /{" "}
                    {targetExchanges}
                  </span>
                </div>
                <div className="bs-progress-bar">
                  <div
                    className="bs-progress-fill"
                    style={{
                      width: `${String(
                        Math.min(100, (loomMessageCount / Math.max(1, targetExchanges)) * 100),
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="bs-panel-card">
              <h3>Configuration</h3>
              <div className="bs-config-rows">
                <div className="bs-config-row">
                  <span className="label">niveau</span>
                  <span className="val">{project.config.level}</span>
                </div>
                <div className="bs-config-row">
                  <span className="label">stack</span>
                  <span className="val">
                    {project.config.stack.length > 0 ? project.config.stack.join(", ") : "—"}
                  </span>
                </div>
                <div className="bs-config-row">
                  <span className="label">template</span>
                  <span className="val">{project.config.template}</span>
                </div>
              </div>
              <button
                className="bs-config-link"
                onClick={() => { void navigate(`/projects/${project.id}/settings`); }}
              >
                Modifier dans les paramètres <Icon.ChevronRight width="14" height="14" />
              </button>
            </div>
          </div>

          <div className="bs-launch" data-ready={ready}>
            <button
              className="bs-launch-btn"
              disabled={!ready || launching}
              onClick={() => { setConfirmLaunch(true); }}
            >
              <Icon.Sparkles width="14" height="14" />{" "}
              {launching ? "Lancement…" : "Lancer la génération de la spec"}
            </button>
            <span className="bs-launch-hint">
              {ready
                ? "Tu as assez échangé pour cadrer la spec. Tu peux continuer ou lancer."
                : `Encore ${String(Math.max(0, targetExchanges - loomMessageCount))} échange${
                    targetExchanges - loomMessageCount > 1 ? "s" : ""
                  } avant de pouvoir lancer la spec.`}
            </span>
          </div>
        </aside>
      </div>

      {confirmLaunch && (
        <ConfirmLaunch
          projectName={project.name}
          projectType={projectType}
          messages={messages}
          resonance={resonance}
          onCancel={() => { setConfirmLaunch(false); }}
          onConfirm={launchSpec}
        />
      )}
      {confirmSkip && (
        <ConfirmSkip onCancel={() => { setConfirmSkip(false); }} onConfirm={skipBrainstorm} />
      )}
      {confirmReset && (
        <ConfirmReset onCancel={() => { setConfirmReset(false); }} onConfirm={doReset} />
      )}

      {toast && <div className="bs-toast">{toast}</div>}
    </div>
  );
}
