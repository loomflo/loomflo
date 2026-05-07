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
  questions: number;
  desc: string;
}

const RESONANCE_MODES: ResonanceMode[] = [
  { id: "light", label: "Léger", tag: "1–2 questions", questions: 2, desc: "Pour un MVP rapide." },
  { id: "medium", label: "Moyen", tag: "4–5 questions", questions: 5, desc: "Équilibré, défaut." },
  { id: "deep", label: "Profond", tag: "10+ questions", questions: 11, desc: "Exploration exhaustive." },
];

interface Question {
  q: string;
  suggestions: string[];
}
interface PlanQuestion extends Question {
  category: string;
}

const QUESTION_POOL: Record<string, Question[]> = {
  scope: [
    {
      q: "Quel est le **périmètre minimum viable** ? Ce que le projet doit absolument faire dès la v1.",
      suggestions: ["MVP très réduit", "Tout l'essentiel", "Je n'ai pas encore tranché"],
    },
    {
      q: "Y a-t-il des features que tu veux **explicitement exclure** pour cette première itération ?",
      suggestions: ["Pas d'auth pour l'instant", "Pas de paiement", "Rien à exclure"],
    },
  ],
  users: [
    {
      q: "À **quel utilisateur** s'adresse ce projet ? Décris une persona type si possible.",
      suggestions: ["Moi-même", "Une équipe interne", "Grand public"],
    },
    {
      q: "Combien d'**utilisateurs simultanés** anticipes-tu sur les 6 premiers mois ?",
      suggestions: ["Quelques dizaines", "Quelques centaines", "Pas critique"],
    },
  ],
  stack: [
    {
      q: "As-tu une **préférence pour la stack technique** ? Sinon je pars sur React + Node.",
      suggestions: ["React + Node", "Next.js", "À toi de décider"],
    },
    {
      q: "Y a-t-il des **contraintes d'hébergement** (auto-hébergé, cloud spécifique, edge) ?",
      suggestions: ["Vercel / cloud public", "Auto-hébergé", "Aucune contrainte"],
    },
  ],
  data: [
    {
      q: "Quels **types de données** doivent être stockés ? Sensibles, volumineuses, structurées ?",
      suggestions: ["Données utilisateur classiques", "Documents / fichiers", "Pas de stockage critique"],
    },
    {
      q: "Y a-t-il des exigences **RGPD ou de souveraineté** des données ?",
      suggestions: ["RGPD strict", "Nice-to-have", "Aucune"],
    },
  ],
  ux: [
    {
      q: "Quel est le **flow utilisateur principal** que tu vises ? Décris-le en quelques étapes.",
      suggestions: ["Voir un exemple", "Plusieurs flows en parallèle", "Encore flou"],
    },
    {
      q: "Y a-t-il un **design existant** ou une référence esthétique à respecter ?",
      suggestions: ["Linear-like", "Notion-like", "Pas de réf précise"],
    },
  ],
  deadline: [
    {
      q: "Quelle est ta **deadline** ou la cadence souhaitée pour livrer la v1 ?",
      suggestions: ["Cette semaine", "Ce mois-ci", "Pas de pression"],
    },
  ],
  constraints: [
    {
      q: "Y a-t-il des **contraintes budgétaires** ou techniques à connaître dès maintenant ?",
      suggestions: ["Budget serré", "Stack imposée", "Aucune"],
    },
  ],
};

const ORDER_BY_MODE: Record<ResonanceMode["id"], string[]> = {
  light: ["scope", "deadline"],
  medium: ["scope", "users", "stack", "ux", "deadline"],
  deep: [
    "scope",
    "scope",
    "users",
    "users",
    "stack",
    "data",
    "ux",
    "ux",
    "deadline",
    "constraints",
    "constraints",
  ],
};

function buildQuestionPlan(mode: ResonanceMode["id"]): PlanQuestion[] {
  const order = ORDER_BY_MODE[mode] ?? ORDER_BY_MODE.medium;
  const seen: Record<string, number> = {};
  const plan: PlanQuestion[] = [];
  for (const cat of order) {
    seen[cat] = seen[cat] ?? 0;
    const pool = QUESTION_POOL[cat];
    if (!pool) continue;
    const item = pool[seen[cat] % pool.length];
    if (!item) continue;
    seen[cat] += 1;
    plan.push({ category: cat, ...item });
  }
  return plan;
}

const TRANSITIONS = ["Compris.", "Noté.", "Ok, ça m'aide.", "Bien. Continuons.", "Parfait, je note ça."];
const THINKING_LABELS = [
  "Loom analyse…",
  "Loom rédige…",
  "Loom réfléchit…",
  "Loom structure sa réponse…",
];
const FEATURE_ANALYSIS = [
  "Lecture de l'arborescence du projet",
  "Identification des patterns et conventions",
  "Analyse des dépendances et de l'architecture",
];
const FEATURE_REPORT_MD = `Analyse terminée. Voici ce que j'ai identifié :

- **Stack** : React 19 + Vite, TypeScript strict
- **Framework** : React Router v7, Tailwind v4
- **Patterns** : composants atomiques dans \`src/components/ui/\`, store via \`projectStore\`
- **Couverture tests** : ~62% (vitest)

Maintenant, quelques questions sur la **nouvelle feature** :`;

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
    const idx = m.index ?? 0;
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

interface AnalysisLine {
  label: string;
  done: boolean;
  key: string;
}

interface PersistedState {
  messages: BsMessage[];
  questionsAsked: number;
  analysis: AnalysisLine[];
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
      <div className="bs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
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
      <div className="bs-modal" onClick={(e) => e.stopPropagation()} role="dialog">
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
      <div className="bs-modal" onClick={(e) => e.stopPropagation()} role="dialog">
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

  const projectType: "scratch" | "feature" = "scratch";

  const [resonance, setResonance] = useState<ResonanceMode["id"]>("medium");
  const plan = useMemo(() => buildQuestionPlan(resonance), [resonance]);
  const totalQ = plan.length;

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

  const [messages, setMessages] = useState<BsMessage[]>(initialState?.messages ?? []);
  const [questionsAsked, setQuestionsAsked] = useState<number>(initialState?.questionsAsked ?? 0);
  const [thinking, setThinking] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState<string>(THINKING_LABELS[0] ?? "Loom réfléchit…");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [streamingFull, setStreamingFull] = useState("");
  const [hasBootstrapped, setHasBootstrapped] = useState<boolean>(
    !!(initialState?.messages?.length),
  );
  const [inputVal, setInputVal] = useState("");
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [stickyScroll, setStickyScroll] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisLine[]>(initialState?.analysis ?? []);
  const [currentSuggestions, setCurrentSuggestions] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem(
        bsKey(projectId),
        JSON.stringify({ messages, questionsAsked, analysis }),
      );
    } catch {
      /* localStorage unavailable */
    }
  }, [messages, questionsAsked, analysis, projectId]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  const beginStream = useCallback((fullText: string, onDone?: () => void) => {
    const id = "m_" + Math.random().toString(36).slice(2, 9);
    setStreamingId(id);
    setStreamingText("");
    setStreamingFull(fullText);
    let i = 0;
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
  }, [messages, streamingText, thinking, analysis, stickyScroll]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickyScroll(dist < 60);
  };

  const askNextQuestion = useCallback(
    (atIdx: number, currentPlan: PlanQuestion[]) => {
      const item = currentPlan[atIdx];
      if (!item) return;
      setThinking(true);
      setThinkingLabel(
        THINKING_LABELS[Math.floor(Math.random() * THINKING_LABELS.length)] ?? "Loom réfléchit…",
      );
      window.setTimeout(
        () => {
          setThinking(false);
          const intro =
            atIdx > 0
              ? (TRANSITIONS[Math.floor(Math.random() * TRANSITIONS.length)] ?? "") + " "
              : "";
          beginStream(`${intro}${item.q}`, () => {
            setQuestionsAsked((n) => n + 1);
          });
          setCurrentSuggestions(item.suggestions ?? []);
        },
        700 + Math.random() * 500,
      );
    },
    [beginStream],
  );

  const runIntroSequence = useCallback(
    (type: "scratch" | "feature") => {
      if (type === "feature") {
        window.setTimeout(() => {
          setThinking(true);
          setThinkingLabel("Loom analyse le projet existant…");
          window.setTimeout(() => {
            setThinking(false);
            beginStream(
              `Avant de te poser des questions, je vais analyser ton projet existant à \`${
                project?.projectPath ?? ""
              }\`.`,
              () => {
                FEATURE_ANALYSIS.forEach((label, idx) => {
                  window.setTimeout(() => {
                    setAnalysis((a) => [...a, { label, done: false, key: "a_" + idx }]);
                  }, idx * 900);
                  window.setTimeout(
                    () => {
                      setAnalysis((a) =>
                        a.map((it) => (it.key === "a_" + idx ? { ...it, done: true } : it)),
                      );
                    },
                    idx * 900 + 850,
                  );
                });
                window.setTimeout(
                  () => {
                    setThinking(true);
                    setThinkingLabel("Loom rédige le compte-rendu…");
                    window.setTimeout(() => {
                      setThinking(false);
                      beginStream(FEATURE_REPORT_MD, () => askNextQuestion(0, plan));
                    }, 800);
                  },
                  FEATURE_ANALYSIS.length * 900 + 600,
                );
              },
            );
          }, 700);
        }, 250);
      } else {
        window.setTimeout(() => {
          setThinking(true);
          setThinkingLabel(THINKING_LABELS[0] ?? "Loom réfléchit…");
          window.setTimeout(() => {
            setThinking(false);
            beginStream(
              `Salut. Je suis **Loom**, l'architecte. Mon job : **clarifier ta vision** avant que les agents génèrent la spec.\n\nDécris-moi ton projet en quelques phrases — je vais ensuite te poser quelques questions ciblées pour cadrer le tout.`,
            );
          }, 700);
        }, 250);
      }
    },
    [askNextQuestion, beginStream, plan, project?.projectPath],
  );

  useEffect(() => {
    if (hasBootstrapped) return;
    setHasBootstrapped(true);
    runIntroSequence(projectType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streamingId || thinking) return;
    setMessages((ms) => [
      ...ms,
      { id: "u_" + Math.random().toString(36).slice(2, 9), from: "user", text: trimmed, ts: Date.now() },
    ]);
    setInputVal("");
    setCurrentSuggestions([]);
    const idx = questionsAsked;
    if (idx < plan.length) {
      window.setTimeout(() => askNextQuestion(idx, plan), 350);
      return;
    }

    // Open-dialogue phase: if we have a daemon connection, route the
    // user's free-form message through POST /chat. Otherwise fall back
    // to the scripted closing message.
    if (token && projectId) {
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
        .catch((err) => {
          setThinking(false);
          beginStream(
            `Loom n'a pas répondu — ${
              err instanceof Error ? err.message : String(err)
            }. On peut continuer en local ou réessayer.`,
          );
        });
      return;
    }

    window.setTimeout(() => {
      setThinking(true);
      setThinkingLabel(
        THINKING_LABELS[Math.floor(Math.random() * THINKING_LABELS.length)] ?? "Loom réfléchit…",
      );
      window.setTimeout(() => {
        setThinking(false);
        beginStream(
          `Bien noté. On a couvert l'essentiel — tu peux **lancer la génération de la spec** quand tu es prêt, ou continuer à approfondir ici.\n\nUn point que tu voudrais creuser ?`,
        );
      }, 700);
    }, 300);
  };

  const onResonanceChange = (id: ResonanceMode["id"]) => {
    if (id === resonance) return;
    const newPlan = buildQuestionPlan(id);
    setResonance(id);
    if (questionsAsked > 0) {
      const remaining = Math.max(0, newPlan.length - questionsAsked);
      window.setTimeout(() => {
        beginStream(
          `Mode ajusté à **${
            RESONANCE_MODES.find((m) => m.id === id)?.label.toLowerCase() ?? ""
          }**. Je vais ${
            remaining > 0
              ? `poser ${remaining} question${remaining > 1 ? "s" : ""} supplémentaire${
                  remaining > 1 ? "s" : ""
                }`
              : "arrêter de poser des questions, tu as déjà ce qu'il faut"
          }.`,
        );
      }, 200);
    }
  };

  const doReset = () => {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    setMessages([]);
    setQuestionsAsked(0);
    setStreamingId(null);
    setStreamingText("");
    setStreamingFull("");
    setThinking(false);
    setAnalysis([]);
    setCurrentSuggestions([]);
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
    window.setTimeout(() => {
      setHasBootstrapped(true);
      runIntroSequence(projectType);
    }, 200);
  };

  const launchSpec = () => {
    setConfirmLaunch(false);
    showToast("Génération de spec lancée — redirection vers /workflow");
    if (projectId) navigate(`/projects/${projectId}/workflow`);
  };
  const skipBrainstorm = () => {
    setConfirmSkip(false);
    if (projectId) navigate(`/projects/${projectId}/workflow`);
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
    ta.style.height = Math.min(ta.scrollHeight, 168) + "px";
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

  const ready = questionsAsked >= plan.length && !streamingId && !thinking;

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
          <button className="bs-skip" onClick={() => setConfirmSkip(true)}>
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

              {analysis.length > 0 && (
                <div className="bs-msg-row" data-from="system">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {analysis.map((a) => (
                      <div className="bs-analyze-line" key={a.key} data-done={a.done}>
                        <span className="spinner" />
                        <span>
                          {a.label}
                          {a.done ? "" : "…"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
            {currentSuggestions.length > 0 && !streamingId && !thinking && (
              <div className="bs-suggestions">
                {currentSuggestions.map((s, i) => (
                  <button
                    key={i}
                    className="bs-chip"
                    onClick={() => setInputVal((v) => (v ? v + " " + s : s))}
                  >
                    {s} <span className="arrow">→</span>
                  </button>
                ))}
              </div>
            )}

            <div
              className="bs-input-wrap shimmer-host shimmer"
              data-phase="spec"
              style={{ "--shimmer-delay": "-2s" } as CSSProperties}
            >
              <textarea
                ref={textareaRef}
                className="bs-textarea"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={onTextareaKey}
                placeholder="Décris ton projet, réponds aux questions, ou approfondis un point…"
                rows={1}
                spellCheck={true}
              />
              <div className="bs-input-actions">
                <button
                  className="bs-send"
                  onClick={() => submit(inputVal)}
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
                onClick={() => setConfirmReset(true)}
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
                    onClick={() => onResonanceChange(m.id)}
                    aria-selected={resonance === m.id}
                  >
                    <span>{m.label}</span>
                    <span className="seg-tag">{m.tag}</span>
                  </button>
                ))}
              </div>

              <div className="bs-progress">
                <div className="bs-progress-row">
                  <span>Questions posées</span>
                  <span>
                    <span className="num">{Math.min(questionsAsked, totalQ)}</span> / {totalQ}
                  </span>
                </div>
                <div className="bs-progress-bar">
                  <div
                    className="bs-progress-fill"
                    style={{
                      width: `${Math.min(100, (questionsAsked / Math.max(1, totalQ)) * 100)}%`,
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
                onClick={() => navigate(`/projects/${project.id}/settings`)}
              >
                Modifier dans les paramètres <Icon.ChevronRight width="14" height="14" />
              </button>
            </div>
          </div>

          <div className="bs-launch" data-ready={ready}>
            <button
              className="bs-launch-btn"
              disabled={!ready}
              onClick={() => setConfirmLaunch(true)}
            >
              <Icon.Sparkles width="14" height="14" /> Lancer la génération de la spec
            </button>
            <span className="bs-launch-hint">
              {ready
                ? "Loom a posé toutes ses questions. Tu peux continuer ou lancer."
                : `Disponible après ${Math.max(0, totalQ - questionsAsked)} question${
                    totalQ - questionsAsked > 1 ? "s" : ""
                  } restante${totalQ - questionsAsked > 1 ? "s" : ""}.`}
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
          onCancel={() => setConfirmLaunch(false)}
          onConfirm={launchSpec}
        />
      )}
      {confirmSkip && (
        <ConfirmSkip onCancel={() => setConfirmSkip(false)} onConfirm={skipBrainstorm} />
      )}
      {confirmReset && (
        <ConfirmReset onCancel={() => setConfirmReset(false)} onConfirm={doReset} />
      )}

      {toast && <div className="bs-toast">{toast}</div>}
    </div>
  );
}
