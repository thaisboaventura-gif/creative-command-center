"use client";

import { useEffect, useState, useMemo } from "react";
import type { PerfTask, PerfSubtask } from "@/app/api/performance/route";

/* ─── Types ─── */

type View = "week" | "month";
type LoadState = "loading" | "ok" | "err";

/* ─── Constants ─── */

const JIRA_BASE  = "https://tiendanube.atlassian.net/browse";
const LABEL_W    = 220; // px — task name column

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

/**
 * Parse "YYYY-MM-DD" as LOCAL midnight.
 * new Date("YYYY-MM-DD") is UTC midnight — in UTC-3 that becomes the previous day
 * at 21:00 local, causing off-by-one errors in bar rendering.
 */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

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
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

function dayLabel(d: Date)  { return ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][d.getDay()]; }
function shortDate(d: Date) { return `${d.getDate()}/${d.getMonth() + 1}`; }

/* ─── Gantt helpers ─── */

function projectColor(title: string): string {
  const project = title.split("|")[0].split("—")[0].trim().split(" ").slice(0, 3).join(" ");
  let hash = 0;
  for (let i = 0; i < project.length; i++) hash = (hash * 31 + project.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[hash % PROJECT_PALETTE.length];
}

interface GanttBar {
  startCol: number;    // 1-based
  endCol: number;      // 1-based, inclusive (the due-date column)
  overdue: boolean;
  isDone: boolean;
  isWaiting: boolean;
  isDueToday: boolean;
  startsBefore: boolean;
  color: string;
  dueLabel: string;    // "18/05" — shown inside the deadline cell
}

function calcBar(
  dueDate: string | null,
  createdAt: string,
  status: string,
  days: Date[],
  title: string
): GanttBar | null {
  if (!dueDate) return null;

  const now     = new Date(); now.setHours(0, 0, 0, 0);
  // Use parseLocalDate to avoid UTC-offset off-by-one
  const due     = parseLocalDate(dueDate);
  const created = parseLocalDate(createdAt);
  const first   = new Date(days[0]);             first.setHours(0, 0, 0, 0);
  const last    = new Date(days[days.length - 1]); last.setHours(0, 0, 0, 0);

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

  // endCol: last displayed day that is <= due date (inclusive).
  // Iterates backward so we get the rightmost match.
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
  const color      = isDone     ? "#9ca3af"
                   : isWaiting  ? "#fca5a5"
                   : overdue    ? "#ef4444"
                   : isDueToday ? "#fbbf24"
                   : projectColor(title);

  const dueLabel = `${due.getDate()}/${due.getMonth() + 1}`;

  return {
    startCol: startCol + 1, endCol: endCol + 1,
    overdue, isDone, isWaiting, isDueToday, startsBefore, color, dueLabel,
  };
}

/* ─── Storage helpers ─── */

const HIDDEN_KEY    = "perf_hidden_v1";
const COLLAPSED_KEY = "perf_collapsed_v1";

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function saveSet(key: string, s: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* noop */ }
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
    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20,
      background: c.bg, color: c.color, whiteSpace: "nowrap", flexShrink: 0 }}>
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
  const [collapsed,  setCollapsed]  = useState<Set<string>>(new Set());
  const [addInput,   setAddInput]   = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError,   setAddError]   = useState("");

  // Load persisted state from localStorage on mount
  useEffect(() => {
    setHidden(loadSet(HIDDEN_KEY));
    setCollapsed(loadSet(COLLAPSED_KEY));
  }, []);

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

  const days  = useMemo(
    () => view === "week" ? getWeekDays(offset) : getMonthDays(offset),
    [view, offset]
  );
  const today = new Date();

  // CSS grid: task label column + N day columns, each filling available space (min 40px)
  const GRID_COLS = `${LABEL_W}px repeat(${days.length}, minmax(40px, 1fr))`;

  const visible = tasks.filter((t) => !hidden.has(t.key));

  /* ── Actions ── */

  function hideTask(key: string) {
    const next = new Set(hidden);
    next.add(key);
    setHidden(next);
    saveSet(HIDDEN_KEY, next);
  }

  function unhideAll() {
    const next = new Set<string>();
    setHidden(next);
    saveSet(HIDDEN_KEY, next);
  }

  function toggleCollapsed(key: string) {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
    saveSet(COLLAPSED_KEY, next);
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
      const next = new Set(hidden);
      next.delete(key);
      setHidden(next);
      saveSet(HIDDEN_KEY, next);
      setAddInput("");
    } catch {
      setAddError("Erro de conexão");
    } finally {
      setAddLoading(false);
    }
  }

  /* ── Month stats ── */

  const now = new Date(); now.setHours(0, 0, 0, 0);

  const monthStats = useMemo(() => {
    let statics = 0, videos = 0, delays = 0;
    const delayed: string[] = [];
    for (const t of visible) {
      const allItems = [t, ...t.subtasks];
      for (const item of allItems) {
        if (item.status === "done") {
          const tl = item.title.toLowerCase();
          if (tl.includes("motion") || tl.includes("video") || tl.includes("vídeo")) videos++;
          else statics++;
        }
        if (item.status !== "done" && item.dueDate) {
          const due = parseLocalDate(item.dueDate);
          if (due < now) { delays++; if (!delayed.includes(t.key)) delayed.push(t.key); }
        }
      }
    }
    return { statics, videos, delays, delayed };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /* ── TaskRow ── */

  function TaskRow({ task, indent = false }: { task: PerfTask | PerfSubtask; indent?: boolean }) {
    const bar      = calcBar(task.dueDate, task.createdAt, task.status, days, task.title);
    const isParent = !indent;
    const taskKey  = (task as PerfTask).key;
    const isCollapsed = isParent && collapsed.has(taskKey);

    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        borderBottom: "1px solid #f3f4f6",
        minHeight: 36,
        background: indent ? "#fafafa" : "white",
      }}>
        {/* ── Label cell ── */}
        <div style={{
          padding: indent ? "0 8px 0 26px" : "0 6px 0 8px",
          display: "flex", alignItems: "center", gap: 4, minWidth: 0,
        }}>
          {/* Collapse toggle — parent rows only */}
          {isParent && (
            <button
              onClick={() => toggleCollapsed(taskKey)}
              title={isCollapsed ? "Expandir subtasks" : "Recolher subtasks"}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#9ca3af", fontSize: 8, padding: "1px 2px",
                flexShrink: 0, lineHeight: 1, userSelect: "none",
              }}
            >
              {isCollapsed ? "▶" : "▼"}
            </button>
          )}
          {indent && <span style={{ color: "#d1d5db", fontSize: 10, flexShrink: 0 }}>↳</span>}

          <a
            href={`${JIRA_BASE}/${taskKey}`}
            target="_blank" rel="noopener noreferrer"
            title={task.title}
            style={{
              fontSize: indent ? 11 : 12, color: "#374151",
              fontWeight: isParent ? 600 : 400, textDecoration: "none",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
            }}
          >
            {task.title}
          </a>

          <StatusBadge status={task.status} />

          {isParent && (
            <button
              onClick={() => hideTask(taskKey)}
              title="Ocultar task"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#d1d5db", fontSize: 11, padding: "1px 3px",
                flexShrink: 0, lineHeight: 1,
              }}
            >✕</button>
          )}
        </div>

        {/* ── Day cells ── */}
        {days.map((d, i) => {
          const cellN     = i + 1;                                       // 1-based
          const isToday   = sameDay(d, today);
          const inRange   = bar ? cellN >= bar.startCol && cellN <= bar.endCol : false;
          const isStart   = bar ? cellN === bar.startCol : false;
          const isEnd     = bar ? cellN === bar.endCol   : false;
          const isDueCell = isEnd && inRange;

          // Vertical separator: solid on today/deadline col, dashed elsewhere
          const borderRight = isToday
            ? "1px solid #c4b5fd"
            : isDueCell
            ? `1px solid ${bar!.color}`
            : "1px dashed #d1d5db";

          // Bar border-radius (applied to inner bar div)
          const barRadius =
            isStart && !bar!.startsBefore && isEnd ? "8px"
            : isStart && !bar!.startsBefore        ? "8px 0 0 8px"
            : isEnd                                ? "0 8px 8px 0"
            : "0";

          return (
            <div
              key={i}
              style={{
                position: "relative",
                borderRight,
                minHeight: 36,
                background: !inRange && isToday ? "#f5f3ff" : "transparent",
                overflow: "hidden",
              }}
            >
              {/* Colored bar */}
              {inRange && (
                <div style={{
                  position: "absolute",
                  top: 5, bottom: 5, left: 0, right: 0,
                  background: bar!.color,
                  // Deadline cell: slightly darker to make it pop
                  filter: isDueCell ? "brightness(0.78)" : undefined,
                  opacity: bar!.isDone ? 0.45 : 1,
                  borderRadius: barRadius,
                }} />
              )}

              {/* Deadline label: "📦 DD/MM" right-aligned inside the last bar cell */}
              {isDueCell && (
                <span style={{
                  position: "absolute",
                  right: 4, top: "50%", transform: "translateY(-50%)",
                  fontSize: 9, fontWeight: 700,
                  color: "rgba(255,255,255,0.95)",
                  textShadow: "0 1px 2px rgba(0,0,0,.35)",
                  whiteSpace: "nowrap", zIndex: 1, pointerEvents: "none",
                  lineHeight: 1,
                }}>
                  📦 {bar!.dueLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  /* ── Render ── */

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

  const periodLabel = view === "week"
    ? `${shortDate(days[0])} – ${shortDate(days[days.length - 1])}`
    : days[0].toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <Shell>
      {/* ── Page header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#111", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: "#fef3c7", color: "#d97706", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>⚡</span>
          Performance Dashboard
          <span style={{ fontSize: 13, fontWeight: 400, color: "#9ca3af" }}>{periodLabel}</span>
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

          <button onClick={() => setOffset((o) => o - 1)}
            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: "white", cursor: "pointer", fontSize: 12, color: "#374151" }}>←</button>
          <button onClick={() => setOffset(0)}
            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: "white", cursor: "pointer", fontSize: 12, color: "#374151" }}>Hoje</button>
          <button onClick={() => setOffset((o) => o + 1)}
            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: "white", cursor: "pointer", fontSize: 12, color: "#374151" }}>→</button>

          <a href="/nova-demanda"
            style={{ background: "#d97706", color: "white", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, textDecoration: "none", display: "inline-block" }}>
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
        <div style={{ width: "100%" }}>

          {/* Column headers */}
          <div style={{
            display: "grid", gridTemplateColumns: GRID_COLS,
            borderBottom: "1px solid #eef0f3",
            position: "sticky", top: 0, background: "white", zIndex: 10,
          }}>
            <div style={{ padding: "10px 12px", fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase" }}>
              Task
            </div>
            {days.map((d, i) => {
              const isT = sameDay(d, today);
              return (
                <div key={i} style={{
                  padding: "8px 4px", textAlign: "center",
                  borderRight: isT ? "1px solid #c4b5fd" : "1px dashed #d1d5db",
                  background: isT ? "#f5f3ff" : "transparent",
                }}>
                  <div style={{ fontSize: 10, color: isT ? "#7c3aed" : "#9ca3af", fontWeight: isT ? 700 : 500 }}>
                    {dayLabel(d)}
                  </div>
                  <div style={{ fontSize: 11, color: isT ? "#7c3aed" : "#374151", fontWeight: isT ? 700 : 400 }}>
                    {shortDate(d)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Task rows */}
          {visible.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              Nenhuma task encontrada para o time de Performance.
            </div>
          )}

          {visible.map((task) => (
            <div key={task.key}>
              <TaskRow task={task} />
              {!collapsed.has(task.key) && task.subtasks.map((st) => (
                <TaskRow key={st.key} task={st as unknown as PerfTask} indent />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Color legend ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          { color: "#ef4444", label: "Atrasada ⚠️" },
          { color: "#fbbf24", label: "Entrega hoje 📅" },
          { color: "#fca5a5", label: "Aguardando ⏳" },
          { color: "#9ca3af", label: "Entregue ✅" },
          { color: "#5b6cff", label: "Em andamento" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
          </div>
        ))}
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
      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "24px 16px" }}>
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
