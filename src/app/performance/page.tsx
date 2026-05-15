"use client";

import { useEffect, useRef, useState } from "react";
import type { PerfTask, PerfSubtask } from "@/app/api/performance/route";

/* ─── Types ─── */

type View = "week" | "month";
type LoadState = "loading" | "ok" | "err";

/* ─── Constants ─── */

const JIRA_BASE = "https://tiendanube.atlassian.net/browse";

const PROJECT_PALETTE = [
  "#5b6cff", "#6dd49e", "#ee8094", "#fb923c",
  "#a78bfa", "#2dd4bf", "#38bdf8", "#facc15",
  "#f472b6", "#84cc16",
];

const STATUS_LABEL: Record<string, string> = {
  done:        "✅ Entregue",
  in_review:   "⏳ Aguardando",
  in_progress: "🔵 Em andamento",
  to_do:       "⚪ A fazer",
};

/* ─── Date helpers ─── */

function getWeekDays(offsetWeeks: number): Date[] {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offsetWeeks * 5);
  mon.setHours(0, 0, 0, 0);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

function getMonthDays(offsetMonths: number): Date[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const days: Date[] = [];
  const cur = new Date(start);
  while (cur.getMonth() === start.getMonth()) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function dayLabel(d: Date) {
  return ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][d.getDay()];
}

function shortDate(d: Date) {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/* ─── Gantt helpers ─── */

function projectColor(title: string): string {
  const project = title.split("|")[0].split("—")[0].trim().split(" ").slice(0, 3).join(" ");
  let hash = 0;
  for (let i = 0; i < project.length; i++) hash = (hash * 31 + project.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[hash % PROJECT_PALETTE.length];
}

interface GanttBar {
  startCol: number;   // 1-based
  endCol: number;     // 1-based
  overdue: boolean;
  isDone: boolean;
  isWaiting: boolean;
  isDueToday: boolean;
  startsBefore: boolean;
  color: string;
}

function calcBar(
  dueDate: string | null,
  createdAt: string,
  status: string,
  days: Date[],
  title: string
): GanttBar | null {
  if (!dueDate) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
  const created = new Date(createdAt); created.setHours(0, 0, 0, 0);
  const first = new Date(days[0]); first.setHours(0, 0, 0, 0);
  const last = new Date(days[days.length - 1]); last.setHours(0, 0, 0, 0);

  if (due < first) return null;
  if (created > last) return null;

  const startsBefore = created < first;
  let startCol = startsBefore ? 0 : -1;
  if (!startsBefore) {
    for (let i = 0; i < days.length; i++) {
      const d = new Date(days[i]); d.setHours(0, 0, 0, 0);
      if (d >= created) { startCol = i; break; }
    }
  }
  if (startCol === -1) return null;

  let endCol = -1;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = new Date(days[i]); d.setHours(0, 0, 0, 0);
    if (d <= due) { endCol = i; break; }
  }
  if (endCol === -1) endCol = startCol;
  if (endCol < startCol) endCol = startCol;

  const isDone     = status === "done";
  const isWaiting  = status === "in_review";
  const overdue    = !isDone && due < now;
  const isDueToday = !isDone && due.getTime() === now.getTime();
  const color      = isDone    ? "#9ca3af"
                   : isWaiting ? "#fca5a5"
                   : overdue   ? "#ef4444"
                   : isDueToday ? "#fbbf24"
                   : projectColor(title);

  return { startCol: startCol + 1, endCol: endCol + 1, overdue, isDone, isWaiting, isDueToday, startsBefore, color };
}

/* ─── Storage helpers ─── */

const HIDDEN_KEY = "perf_hidden_v1";

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function saveHidden(s: Set<string>) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s])); } catch { /* noop */ }
}

/* ─── Sub-components ─── */

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    done:        { bg: "#f3f4f6", color: "#6b7280" },
    in_review:   { bg: "#fff1f2", color: "#e11d48" },
    in_progress: { bg: "#eff6ff", color: "#1d4ed8" },
    to_do:       { bg: "#f9fafb", color: "#9ca3af" },
  };
  const c = colors[status] ?? colors.to_do;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: c.bg, color: c.color, whiteSpace: "nowrap" }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/* ─── Main component ─── */

export default function PerformanceDashboard() {
  const [tasks,      setTasks]      = useState<PerfTask[]>([]);
  const [src,        setSrc]        = useState<LoadState>("loading");
  const [view,       setView]       = useState<View>("week");
  const [offset,     setOffset]     = useState(0);
  const [hidden,     setHidden]     = useState<Set<string>>(new Set());
  const [addInput,   setAddInput]   = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError,   setAddError]   = useState("");

  // Load hidden keys from localStorage on mount
  useEffect(() => { setHidden(loadHidden()); }, []);

  // Fetch tasks
  useEffect(() => {
    setSrc("loading");
    fetch("/api/performance")
      .then((r) => r.json())
      .then((d) => {
        if (d.tasks) { setTasks(d.tasks); setSrc("ok"); }
        else setSrc("err");
      })
      .catch(() => setSrc("err"));
  }, []);

  const days = view === "week" ? getWeekDays(offset) : getMonthDays(offset);
  const today = new Date();

  // Visible tasks (hidden keys removed)
  const visible = tasks.filter((t) => !hidden.has(t.key));

  function hideTask(key: string) {
    const next = new Set(hidden);
    next.add(key);
    setHidden(next);
    saveHidden(next);
  }

  function unhideAll() {
    setHidden(new Set());
    saveHidden(new Set());
  }

  async function handleAdd() {
    const key = addInput.trim().toUpperCase();
    if (!key.startsWith("BDSL-")) { setAddError("Use o formato BDSL-XXXXX"); return; }
    if (tasks.some((t) => t.key === key)) { setAddError("Task já está na lista"); return; }

    setAddLoading(true);
    setAddError("");
    try {
      const res = await fetch(`/api/performance?key=${key}`);
      const data = await res.json();
      if (!res.ok || data.error) { setAddError(data.error || "Não encontrada"); return; }
      setTasks((prev) => [data.task, ...prev]);
      // Also remove from hidden if it was hidden before
      const next = new Set(hidden);
      next.delete(key);
      setHidden(next);
      saveHidden(next);
      setAddInput("");
    } catch {
      setAddError("Erro de conexão");
    } finally {
      setAddLoading(false);
    }
  }

  // Month stats
  const now = new Date(); now.setHours(0,0,0,0);
  const monthStats = (() => {
    let statics = 0, videos = 0, delays = 0;
    const delayed: string[] = [];
    for (const t of visible) {
      const allItems = [t, ...t.subtasks];
      for (const item of allItems) {
        if (item.status === "done") {
          const title = item.title.toLowerCase();
          if (title.includes("motion") || title.includes("video") || title.includes("vídeo")) videos++;
          else statics++;
        }
        if (item.status !== "done" && item.dueDate) {
          const due = new Date(item.dueDate); due.setHours(0,0,0,0);
          if (due < now) { delays++; if (!delayed.includes(t.key)) delayed.push(t.key); }
        }
      }
    }
    return { statics, videos, delays, delayed };
  })();

  // Column width for Gantt
  const COL_W = view === "month" ? 36 : 120;
  const LABEL_W = 280;
  const GRID_COLS = `${LABEL_W}px repeat(${days.length}, ${COL_W}px)`;

  const headerStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: GRID_COLS,
    borderBottom: "1px solid #eef0f3",
    position: "sticky",
    top: 0,
    background: "white",
    zIndex: 10,
  };

  function renderBar(bar: GanttBar, days: Date[], colW: number) {
    const span = bar.endCol - bar.startCol + 1;
    return (
      <div style={{
        gridColumn: `${bar.startCol + 1} / span ${span}`,
        gridRow: 1,
        display: "flex",
        alignItems: "center",
        padding: "0 2px",
      }}>
        <div style={{
          height: 16,
          width: "100%",
          borderRadius: bar.startsBefore ? "0 8px 8px 0" : 8,
          background: bar.color,
          opacity: bar.isDone ? 0.5 : 1,
          minWidth: 8,
        }} />
      </div>
    );
  }

  function TaskRow({ task, indent = false }: { task: PerfTask | PerfSubtask; indent?: boolean }) {
    const bar = calcBar(task.dueDate, task.createdAt, task.status, days, task.title);
    const isParent = !indent;
    const key = (task as PerfTask).key;

    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        borderBottom: "1px solid #f3f4f6",
        minHeight: 38,
        alignItems: "center",
        background: indent ? "#fafafa" : "white",
      }}>
        {/* Label cell */}
        <div style={{ padding: indent ? "6px 8px 6px 28px" : "6px 8px 6px 12px", display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {indent && <span style={{ color: "#d1d5db", fontSize: 10, flexShrink: 0 }}>↳</span>}
          <a
            href={`${JIRA_BASE}/${(task as PerfTask).key || key}`}
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: indent ? 11 : 12, color: "#374151", fontWeight: isParent ? 600 : 400, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
            title={task.title}
          >
            {task.title}
          </a>
          <StatusBadge status={task.status} />
          {isParent && (
            <button
              onClick={() => hideTask((task as PerfTask).key)}
              title="Ocultar task"
              style={{ background: "none", border: "none", cursor: "pointer", color: "#d1d5db", fontSize: 14, padding: "2px 4px", flexShrink: 0, lineHeight: 1 }}
            >🗑</button>
          )}
        </div>

        {/* Bar cells — span the day columns via a sub-grid trick */}
        {bar ? (
          Array.from({ length: days.length }, (_, i) => {
            const isStart = i + 1 === bar.startCol;
            const isEnd   = i + 1 === bar.endCol;
            const inRange = i + 1 >= bar.startCol && i + 1 <= bar.endCol;
            const isToday = sameDay(days[i], today);

            return (
              <div key={i} style={{
                height: "100%",
                background: inRange ? bar.color : "transparent",
                opacity: bar.isDone ? 0.45 : 1,
                borderRadius: isStart && !bar.startsBefore && isEnd ? 8
                            : isStart && !bar.startsBefore ? "8px 0 0 8px"
                            : isEnd ? "0 8px 8px 0"
                            : 0,
                borderLeft: isToday ? "2px solid #7c3aed" : undefined,
                minHeight: 24,
                alignSelf: "center",
                margin: "0",
              }} />
            );
          })
        ) : (
          <>
            {days.map((d, i) => (
              <div key={i} style={{ height: "100%", background: sameDay(d, today) ? "#f5f3ff" : "transparent" }} />
            ))}
          </>
        )}
      </div>
    );
  }

  if (src === "loading") return (
    <Shell>
      <p style={{ color: "#9ca3af", textAlign: "center", padding: 80 }}>Conectando ao Jira...</p>
    </Shell>
  );
  if (src === "err") return (
    <Shell>
      <p style={{ color: "#dc2626", textAlign: "center", padding: 80 }}>Erro ao conectar. Recarregue a página.</p>
    </Shell>
  );

  return (
    <Shell>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#111", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: "#fef3c7", color: "#d97706", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>⚡</span>
          Performance Dashboard
        </h1>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {/* View toggle */}
          <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 8, padding: 2 }}>
            {(["week", "month"] as View[]).map((v) => (
              <button key={v} onClick={() => { setView(v); setOffset(0); }}
                style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: view === v ? "white" : "transparent", color: view === v ? "#111" : "#9ca3af", boxShadow: view === v ? "0 1px 3px rgba(0,0,0,.1)" : "none", transition: "all 0.15s" }}>
                {v === "week" ? "Semana" : "Mês"}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <button onClick={() => setOffset((o) => o - 1)}
            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: "white", cursor: "pointer", fontSize: 12, color: "#374151" }}>
            ←
          </button>
          <button onClick={() => setOffset(0)}
            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: "white", cursor: "pointer", fontSize: 12, color: "#374151" }}>
            Hoje
          </button>
          <button onClick={() => setOffset((o) => o + 1)}
            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: "white", cursor: "pointer", fontSize: 12, color: "#374151" }}>
            →
          </button>

          <a href="/nova-demanda"
            style={{ background: "#d97706", color: "white", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, textDecoration: "none", display: "inline-block" }}>
            + Nova demanda
          </a>
        </div>
      </div>

      {/* ── Add by ticket ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        <input
          value={addInput}
          onChange={(e) => { setAddInput(e.target.value); setAddError(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Incluir task: BDSL-XXXXX"
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12, color: "#111", outline: "none", background: "#fafafa", width: 220 }}
        />
        <button onClick={handleAdd} disabled={addLoading || !addInput.trim()}
          style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: addInput.trim() ? "#374151" : "#e5e7eb", color: addInput.trim() ? "white" : "#9ca3af", fontSize: 12, fontWeight: 600, cursor: addInput.trim() ? "pointer" : "not-allowed" }}>
          {addLoading ? "..." : "Incluir"}
        </button>
        {addError && <span style={{ fontSize: 11, color: "#dc2626" }}>{addError}</span>}
        {hidden.size > 0 && (
          <button onClick={unhideAll}
            style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
            Mostrar {hidden.size} oculta{hidden.size > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* ── Gantt ── */}
      <div style={{ overflowX: "auto", background: "white", borderRadius: 12, border: "1px solid #eef0f3", marginBottom: 16 }}>
        <div style={{ minWidth: LABEL_W + days.length * COL_W }}>

          {/* Day header */}
          <div style={headerStyle}>
            <div style={{ padding: "10px 12px", fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase" }}>
              Task
            </div>
            {days.map((d, i) => {
              const isT = sameDay(d, today);
              return (
                <div key={i} style={{ padding: "10px 4px", textAlign: "center", borderLeft: "1px solid #f3f4f6", background: isT ? "#f5f3ff" : "transparent" }}>
                  <div style={{ fontSize: 10, color: isT ? "#7c3aed" : "#9ca3af", fontWeight: isT ? 700 : 500 }}>{dayLabel(d)}</div>
                  <div style={{ fontSize: 11, color: isT ? "#7c3aed" : "#374151", fontWeight: isT ? 700 : 400 }}>{shortDate(d)}</div>
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {visible.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              Nenhuma task encontrada para o time de Performance.
            </div>
          )}
          {visible.map((task) => (
            <div key={task.key}>
              <TaskRow task={task} />
              {task.subtasks.map((st) => (
                <TaskRow key={st.key} task={st as unknown as PerfTask} indent />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Month summary ── */}
      {view === "month" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #eef0f3", padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Resumo do mês
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
            <Stat label="Estáticos entregues" value={monthStats.statics} color="#7c3aed" />
            <Stat label="Vídeos entregues"    value={monthStats.videos}  color="#ea580c" />
            <Stat label="Atrasos"             value={monthStats.delays}  color="#dc2626" />
          </div>
          {monthStats.delayed.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", marginBottom: 4 }}>Tasks atrasadas:</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {monthStats.delayed.map((k) => (
                  <a key={k} href={`${JIRA_BASE}/${k}`} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "#dc2626", background: "#fef2f2", padding: "2px 8px", borderRadius: 12, textDecoration: "none", fontWeight: 600 }}>
                    {k}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

/* ─── Layout ─── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f8f9fb", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ marginBottom: 8 }}>
          <a href="/" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "none" }}>← Painel principal</a>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{label}</div>
    </div>
  );
}
