"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import type { PerfTask, PerfSubtask } from "@/app/api/performance/route";

/* ─── Types ─── */

type View = "week" | "month";
type LoadState = "loading" | "ok" | "err";

/* ─── Constants ─── */

const JIRA_BASE      = "https://tiendanube.atlassian.net/browse";
const LABEL_W_DEFAULT = 220; // px — task name column (default)
const LABEL_W_KEY     = "perf_label_w_v1";

interface PaletteEntry {
  bg: string; text: string;
  subtle: string; subtleText: string;
  border: string;
}

const PALETTE: PaletteEntry[] = [
  { bg:'#80B0E8', text:'#1a3a5c', subtle:'rgba(128,176,232,0.25)', subtleText:'#1a3a5c', border:'#5a8fc7' },
  { bg:'#008471', text:'#ffffff', subtle:'rgba(0,132,113,0.20)',   subtleText:'#005a4d', border:'#006057' },
  { bg:'#D1CAEA', text:'#3b2d6e', subtle:'rgba(209,202,234,0.35)', subtleText:'#3b2d6e', border:'#9b90c9' },
  { bg:'#F4D242', text:'#5c3d00', subtle:'rgba(244,210,66,0.25)',  subtleText:'#5c3d00', border:'#c9a800' },
  { bg:'#C45F3F', text:'#ffffff', subtle:'rgba(196,95,63,0.20)',   subtleText:'#7a2e10', border:'#9a3e22' },
  { bg:'#898E46', text:'#ffffff', subtle:'rgba(137,142,70,0.22)',  subtleText:'#3a3d10', border:'#5f6230' },
  { bg:'#FFC0C0', text:'#7a1c1c', subtle:'rgba(255,192,192,0.35)', subtleText:'#7a1c1c', border:'#e07070' },
  { bg:'#F29CC3', text:'#6b0a3a', subtle:'rgba(242,156,195,0.30)', subtleText:'#6b0a3a', border:'#c9609a' },
];

// PROJECT_PALETTE kept for projectColor() used by calcBar
const PROJECT_PALETTE = PALETTE.map((e) => e.bg);

const STATUS_LABEL: Record<string, string> = {
  done:        "✅ Entregue",
  in_review:   "⏳ Entr. p/ feedb.",
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

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface BarDragState {
  key:         string;
  startX:      number;
  dueDateIdx:  number;   // 0-based index in days[] corresponding to the bar's endCol
  originalDue: string;   // "YYYY-MM-DD" — used for rollback
  jiraHref:    string;
}

/** Returns 10 working days (Mon–Fri × 2 weeks) starting from the current Monday + offset.
 *  Each offset unit = 7 calendar days (1 week), so the arrow scrolls by 1 week at a time. */
function getTwoWeekDays(offsetWeeks: number): Date[] {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offsetWeeks * 7);
  mon.setHours(0, 0, 0, 0);
  return Array.from({ length: 10 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i + (i >= 5 ? 2 : 0)); // skip weekend
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

/** Daily capacity per team member (hours) */
const PERSON_CAP: Record<string, number> = {
  eduardo: 13.5,
  larissa: 13.5,
  joão: 5.5,
  joao: 5.5,
  beatriz: 5.5,
  rafa: 8,
  gaspareto: 8,
};

/** Members always shown in the Gantt even without active tasks */
const STATIC_MEMBERS = ["Eduardo Gaspareto"];

function normFirst(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(" ")[0];
}

function personCapacity(displayName: string): number {
  return PERSON_CAP[normFirst(displayName)] ?? 5.5;
}

function subWorkDays(date: Date, n: number): Date {
  const r = new Date(date);
  let i = 0;
  while (i < n) {
    r.setDate(r.getDate() - 1);
    if (r.getDay() !== 0 && r.getDay() !== 6) i++;
  }
  return r;
}

function projectKey(title: string): string {
  return title.split("|")[0].split("—")[0].trim().split(" ").slice(0, 3).join(" ");
}

function projectColor(title: string): string {
  const key = projectKey(title);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[hash % PROJECT_PALETTE.length];
}

/** Darkens a hex color by `factor` (0–1). factor=0.3 → 30% darker. */
function darkenHex(hex: string, factor: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - factor)));
  const g = Math.max(0, Math.round(((n >>  8) & 0xff) * (1 - factor)));
  const b = Math.max(0, Math.round(( n        & 0xff) * (1 - factor)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${alpha})`;
}

interface GanttBar {
  startCol: number;      // 1-based
  endCol: number;        // 1-based, inclusive (the due-date column)
  execStartCol: number;  // 1-based — where execution begins (before = "No pipeline")
  overdue: boolean;
  isDone: boolean;
  isWaiting: boolean;
  isDueToday: boolean;
  startsBefore: boolean;
  color: string;
  dueLabel: string;      // "18/05" — shown inside the deadline cell
}

function calcBar(
  dueDate: string | null,
  createdAt: string,
  status: string,
  days: Date[],
  title: string,
  estimatedHours?: number,
  assignee?: string,
): GanttBar | null {
  if (!dueDate) return null;

  const now     = new Date(); now.setHours(0, 0, 0, 0);
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

  let endCol = -1;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = new Date(days[i]); d.setHours(0, 0, 0, 0);
    if (d <= due) { endCol = i; break; }
  }
  if (endCol === -1) endCol = startCol;
  if (endCol < startCol) endCol = startCol;

  // ── Execution start (Jeito A) ─────────────────────────────────────────
  // Go backwards from dueDate by the number of workdays needed.
  // Before execStart = "No pipeline" (task waiting to be picked up).
  let execStartCol = startCol + 1; // default: start executing from first visible day
  if (estimatedHours !== undefined && assignee) {
    const cap        = personCapacity(assignee);
    const daysNeeded = Math.max(1, Math.ceil(estimatedHours / cap));
    const execDate   = subWorkDays(due, daysNeeded - 1);
    execDate.setHours(0, 0, 0, 0);

    if (execDate <= first) {
      execStartCol = startCol + 1; // already executing before window
    } else {
      let found = false;
      for (let i = 0; i < days.length; i++) {
        const d = new Date(days[i]); d.setHours(0, 0, 0, 0);
        if (d >= execDate) { execStartCol = i + 1; found = true; break; }
      }
      if (!found) execStartCol = endCol + 1; // execution outside visible window
    }
  }
  // ─────────────────────────────────────────────────────────────────────

  const isDone     = status === "done";
  const isWaiting  = status === "in_review";
  const overdue    = !isDone && due < now;
  const isDueToday = !isDone && !isWaiting && due.getTime() === now.getTime();
  // Color is always the project color — status display is handled in TaskRow
  const color      = projectColor(title);

  const dueLabel = `${due.getDate()}/${due.getMonth() + 1}`;

  return {
    startCol: startCol + 1, endCol: endCol + 1, execStartCol,
    overdue, isDone, isWaiting, isDueToday, startsBefore, color, dueLabel,
  };
}

/* ─── Storage helpers ─── */

const HIDDEN_KEY       = "perf_hidden_v1";
const COLLAPSED_KEY    = "perf_collapsed_v1";
const DONE_MONTHS_KEY  = "perf_done_months_v1";
const MANUAL_KEY       = "perf_manual_tasks_v1";
const PERF_ORDER_KEY   = "perf_task_order_v1";

const PT_MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                   "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function saveSet(key: string, s: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* noop */ }
}

function loadArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveArray(key: string, arr: string[]) {
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* noop */ }
}

/* ─── Delivery helpers ─── */

function isFullyDone(task: PerfTask): boolean {
  // Parent marked Done in Jira → always delivered
  if (task.status === "done") return true;
  // Parent still open but all subtasks are done → also delivered
  if (task.subtasks.length > 0) return task.subtasks.every((st) => st.status === "done");
  return false;
}

/** Returns the latest subtask dueDate, falling back to the parent's dueDate. */
function getDeliveryDate(task: PerfTask): Date | null {
  const dates = task.subtasks
    .filter((st) => st.dueDate)
    .map((st) => parseLocalDate(st.dueDate!));
  if (dates.length === 0) return task.dueDate ? parseLocalDate(task.dueDate) : null;
  return dates.reduce((a, b) => (b > a ? b : a));
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelOf(d: Date): string {
  return `${PT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

interface MonthGroup {
  key: string;
  label: string;
  tasks: PerfTask[];
}

function groupByMonth(tasks: PerfTask[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>();
  for (const t of tasks) {
    const d = getDeliveryDate(t);
    if (!d) continue;
    const key   = monthKey(d);
    const label = monthLabelOf(d);
    if (!map.has(key)) map.set(key, { key, label, tasks: [] });
    map.get(key)!.tasks.push(t);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a)) // newest month first
    .map(([, v]) => v);
}

/* ─── Sub-components ─── */

function StatusBadge({ status, isOverdue = false }: { status: string; isOverdue?: boolean }) {
  const colors: Record<string, { bg: string; color: string }> = {
    done:        { bg: "#f3f4f6", color: "#6b7280" },
    in_review:   { bg: "#fff7ed", color: "#c2410c" },  // orange
    in_progress: { bg: "#eff6ff", color: "#1d4ed8" },
    to_do:       { bg: "#f9fafb", color: "#9ca3af" },
    overdue:     { bg: "#fee2e2", color: "#991b1b" },  // red
  };
  const key = isOverdue ? "overdue" : status;
  const c = colors[key] ?? colors.to_do;
  const label = isOverdue ? "⚠️ Em atraso" : (STATUS_LABEL[status] ?? status);
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20,
      background: c.bg, color: c.color, whiteSpace: "nowrap", flexShrink: 0 }}>
      {label}
    </span>
  );
}

/* ─── Types ─── */

interface TooltipState {
  title: string;
  dateLabel: string;
  link: string;
  x: number;
  y: number;
  isDone: boolean;
}

/* ─── Main component ─── */

export default function PerformanceDashboard() {
  const [tasks,      setTasks]      = useState<PerfTask[]>([]);
  const [src,        setSrc]        = useState<LoadState>("loading");
  const [view,       setView]       = useState<View>("week");
  const [offset,     setOffset]     = useState(0);
  const [hidden,     setHidden]     = useState<Set<string>>(new Set());
  const [collapsed,  setCollapsed]  = useState<Set<string>>(new Set());
  const [manualKeys, setManualKeys] = useState<string[]>([]);
  const [addInput,   setAddInput]   = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError,   setAddError]   = useState("");
  const [tooltip,           setTooltip]           = useState<TooltipState | null>(null);
  const [doneMonthsCollapsed, setDoneMonthsCollapsed] = useState<Set<string>>(new Set());
  const [deliveredSearch,   setDeliveredSearch]   = useState("");
  const [labelWidth,        setLabelWidth]        = useState(LABEL_W_DEFAULT);
  const [isResizingLabel,   setIsResizingLabel]   = useState(false);
  const [barDragState,      setBarDragState]      = useState<BarDragState | null>(null);
  const [barDragOffset,     setBarDragOffset]     = useState(0);
  const [commentedKeys,     setCommentedKeys]     = useState<Set<string>>(new Set());
  // Vertical reorder state
  const [perfOrder,     setPerfOrder]     = useState<string[]>([]);
  interface PerfVertDrag { taskKey: string; fromIdx: number; }
  const [perfVertDrag,  setPerfVertDrag]  = useState<PerfVertDrag | null>(null);
  const [perfDropIdx,   setPerfDropIdx]   = useState<number | null>(null);
  const tooltipTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelResizeRef    = useRef<{ startX: number; startW: number } | null>(null);
  const barDragOffsetRef  = useRef(0);
  const ganttContainerRef  = useRef<HTMLDivElement | null>(null);
  const ganttHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const perfDropIdxRef    = useRef<number | null>(null);
  const perfOrderedRef    = useRef<string[]>([]);
  const perfRowRefsMap    = useRef<Map<string, HTMLDivElement>>(new Map());

  // Load persisted state from localStorage on mount
  useEffect(() => {
    setHidden(loadSet(HIDDEN_KEY));
    setCollapsed(loadSet(COLLAPSED_KEY));
    const savedW = parseInt(localStorage.getItem(LABEL_W_KEY) ?? "");
    if (!isNaN(savedW) && savedW >= 120) setLabelWidth(savedW);
    const savedOrder = loadArray(PERF_ORDER_KEY);
    if (savedOrder.length > 0) setPerfOrder(savedOrder);
  }, []);

  // Label column resize — global mouse events while dragging
  useEffect(() => {
    if (!isResizingLabel) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (e: MouseEvent) => {
      if (!labelResizeRef.current) return;
      const delta = e.clientX - labelResizeRef.current.startX;
      const newW  = Math.max(120, Math.min(560, labelResizeRef.current.startW + delta));
      setLabelWidth(newW);
    };

    const onMouseUp = () => {
      setIsResizingLabel(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setLabelWidth((w) => {
        localStorage.setItem(LABEL_W_KEY, String(w));
        return w;
      });
      labelResizeRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
    };
  }, [isResizingLabel]);

  // Fetch tasks
  useEffect(() => {
    setSrc("loading");
    fetch("/api/performance")
      .then((r) => r.json())
      .then(async (d) => {
        if (!d.tasks) { setSrc("err"); return; }

        let allTasks: PerfTask[] = d.tasks;

        // Re-fetch manually added tasks saved in localStorage
        const savedKeys = loadArray(MANUAL_KEY);
        setManualKeys(savedKeys);
        if (savedKeys.length > 0) {
          const fetched = await Promise.all(
            savedKeys.map((k) =>
              fetch(`/api/performance?key=${k}`)
                .then((r) => r.json())
                .then((data) => data.task ?? null)
                .catch(() => null)
            )
          );
          const valid = fetched.filter(Boolean) as PerfTask[];
          const existing = new Set(allTasks.map((t) => t.key));
          const newOnes = valid.filter((t) => !existing.has(t.key));
          allTasks = [...newOnes, ...allTasks];
        }

        setTasks(allTasks);
        setSrc("ok");

        // Initialize done-months collapse state on first visit
        const stored = localStorage.getItem(DONE_MONTHS_KEY);
        if (stored) {
          setDoneMonthsCollapsed(new Set(JSON.parse(stored)));
        } else {
          const curKey = monthKey(new Date());
          const toCollapse = new Set<string>(
            (allTasks as PerfTask[])
              .filter(isFullyDone)
              .map(getDeliveryDate)
              .filter(Boolean)
              .map((dt) => monthKey(dt as Date))
              .filter((k) => k !== curKey)
          );
          setDoneMonthsCollapsed(toCollapse);
          saveSet(DONE_MONTHS_KEY, toCollapse);
        }
      })
      .catch(() => setSrc("err"));
  }, []);

  const days  = useMemo(
    () => view === "week" ? getTwoWeekDays(offset) : getMonthDays(offset),
    [view, offset]
  );
  const today = new Date();

  // CSS grid: task label column + N day columns, each filling available space (min 50px)
  const GRID_COLS = `${labelWidth}px repeat(${days.length}, minmax(50px, 1fr))`;

  // Visible window: first and last calendar day currently shown
  const windowStart = useMemo(() => { const d = new Date(days[0]); d.setHours(0,0,0,0); return d; }, [days]);
  const windowEnd   = useMemo(() => { const d = new Date(days[days.length - 1]); d.setHours(0,0,0,0); return d; }, [days]);

  /** True when the task's delivery date falls inside the currently visible gantt window */
  function isInVisibleWindow(task: PerfTask): boolean {
    const d = getDeliveryDate(task);
    if (!d) return false;
    return d >= windowStart && d <= windowEnd;
  }

  // Entregas concluídas: from Jan 1 of current year (same window as Jira query)
  const sectionStart = new Date(new Date().getFullYear(), 0, 1); // Jan 1

  const visible       = tasks.filter((t) => !hidden.has(t.key));

  // Gantt: active tasks + done tasks whose delivery is still in the visible window (gray ✅ bar)
  const visibleActive = visible.filter((t) => !isFullyDone(t) || isInVisibleWindow(t));

  // Done section: fully done, delivery outside the visible window, from May onwards
  const doneTasks     = visible.filter((t) => {
    if (!isFullyDone(t)) return false;
    if (isInVisibleWindow(t)) return false; // it stays in the gantt
    const d = getDeliveryDate(t);
    return d !== null && d >= sectionStart;
  });

  const monthGroups = useMemo(() => {
    const q = deliveredSearch.toLowerCase();
    const filtered = q ? doneTasks.filter((t) => t.title.toLowerCase().includes(q)) : doneTasks;
    return groupByMonth(filtered);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneTasks, deliveredSearch]);

  const orderedVisibleActive = useMemo(() => {
    if (perfOrder.length === 0) return visibleActive;
    const keySet = new Set(visibleActive.map((t) => t.key));
    const ordered = perfOrder.filter((k) => keySet.has(k)).map((k) => visibleActive.find((t) => t.key === k)!);
    const rest = visibleActive.filter((t) => !perfOrder.includes(t.key));
    return [...ordered, ...rest];
  }, [visibleActive, perfOrder]);

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

  function toggleDoneMonth(key: string) {
    const next = new Set(doneMonthsCollapsed);
    if (next.has(key)) next.delete(key); else next.add(key);
    setDoneMonthsCollapsed(next);
    saveSet(DONE_MONTHS_KEY, next);
  }

  /* ── Tooltip helpers ── */

  function showTooltip(data: TooltipState) {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltip(data);
  }

  function hideTooltip() {
    tooltipTimer.current = setTimeout(() => setTooltip(null), 160);
  }

  function cancelHide() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
  }

  // Bar drag-and-drop — global mouse events while dragging
  useEffect(() => {
    if (!barDragState) return;

    document.body.style.cursor     = "grabbing";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      const el = ganttContainerRef.current;
      if (!el) return;
      const colWidth = (el.offsetWidth - labelWidth) / days.length;
      const deltaCols = Math.round((e.clientX - barDragState.startX) / colWidth);
      const clamped = Math.max(
        -barDragState.dueDateIdx,
        Math.min(days.length - 1 - barDragState.dueDateIdx, deltaCols)
      );
      barDragOffsetRef.current = clamped;
      setBarDragOffset(clamped);
    };

    const onMouseUp = async () => {
      const offset = barDragOffsetRef.current;
      const state  = barDragState;

      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
      setBarDragState(null);
      setBarDragOffset(0);
      barDragOffsetRef.current = 0;

      if (offset === 0) {
        // No movement → treat as click, open Jira
        window.open(state.jiraHref, "_blank");
        return;
      }

      const newIdx     = Math.max(0, Math.min(days.length - 1, state.dueDateIdx + offset));
      const newDateStr = formatLocalDate(days[newIdx]);

      // Optimistic UI update
      setTasks((prev) => prev.map((t) => {
        if (t.key === state.key) return { ...t, dueDate: newDateStr };
        return {
          ...t,
          subtasks: t.subtasks.map((st) =>
            st.key === state.key ? { ...st, dueDate: newDateStr } : st
          ),
        };
      }));

      // Persist to Jira
      const res = await fetch("/api/jira/update-deadline", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ issueKey: state.key, newDate: newDateStr }),
      });

      if (!res.ok) {
        // Rollback on error
        setTasks((prev) => prev.map((t) => {
          if (t.key === state.key) return { ...t, dueDate: state.originalDue };
          return {
            ...t,
            subtasks: t.subtasks.map((st) =>
              st.key === state.key ? { ...st, dueDate: state.originalDue } : st
            ),
          };
        }));
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
    };
  }, [barDragState, days, labelWidth]);

  // Fetch assignee comments for visible subtasks
  useEffect(() => {
    const subtasks: { key: string; assignee: string }[] = [];
    for (const task of orderedVisibleActive) {
      if (collapsed.has(task.key)) continue;
      for (const st of task.subtasks) {
        if (st.assignee) subtasks.push({ key: st.key, assignee: st.assignee });
      }
    }
    if (subtasks.length === 0) return;
    fetch("/api/performance/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subtasks),
    })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.keysWithComment))
          setCommentedKeys(new Set(d.keysWithComment as string[]));
      })
      .catch(() => { /* silent — 💬 just won't appear */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedVisibleActive, collapsed]);

  // Vertical reorder — global mouse events while dragging a task row
  useEffect(() => {
    if (!perfVertDrag) return;
    document.body.style.cursor     = "ns-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      const keys = perfOrderedRef.current;
      let dropIdx = keys.length;
      for (let i = 0; i < keys.length; i++) {
        const el = perfRowRefsMap.current.get(keys[i]);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) { dropIdx = i; break; }
      }
      perfDropIdxRef.current = dropIdx;
      setPerfDropIdx(dropIdx);
    };

    const onMouseUp = () => {
      const drop = perfDropIdxRef.current;
      const drag = perfVertDrag;
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
      setPerfVertDrag(null);
      setPerfDropIdx(null);
      perfDropIdxRef.current = null;

      if (drop === null) return;
      const keys = [...perfOrderedRef.current];
      const fromIdx = drag.fromIdx;
      const toIdx   = Math.min(keys.length, drop);
      if (toIdx === fromIdx || toIdx === fromIdx + 1) return;
      const moved = keys.splice(fromIdx, 1)[0];
      keys.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
      setPerfOrder(keys);
      saveArray(PERF_ORDER_KEY, keys);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
    };
  }, [perfVertDrag]);

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

      // Persist manual key so it survives refresh
      const nextKeys = [...manualKeys.filter((k) => k !== key), key];
      setManualKeys(nextKeys);
      saveArray(MANUAL_KEY, nextKeys);

      // Remove from hidden if it was there
      const nextHidden = new Set(hidden);
      nextHidden.delete(key);
      setHidden(nextHidden);
      saveSet(HIDDEN_KEY, nextHidden);

      setAddInput("");
    } catch {
      setAddError("Erro de conexão");
    } finally {
      setAddLoading(false);
    }
  }

  function removeManualTask(key: string) {
    setTasks((prev) => prev.filter((t) => t.key !== key));
    const nextKeys = manualKeys.filter((k) => k !== key);
    setManualKeys(nextKeys);
    saveArray(MANUAL_KEY, nextKeys);
  }

  /* ── Month stats ── */

  const now = new Date(); now.setHours(0, 0, 0, 0);

  const monthStats = useMemo(() => {
    let delays = 0;
    const delayed: string[] = [];
    for (const t of visible) {
      const allItems = [t, ...t.subtasks];
      for (const item of allItems) {
        if (item.status !== "done" && item.dueDate) {
          const due = parseLocalDate(item.dueDate);
          if (due < now) { delays++; if (!delayed.includes(t.key)) delayed.push(t.key); }
        }
      }
    }
    return { delays, delayed };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /* ── TaskRow ── */

  function TaskRow({ task, indent = false, colorIdx = 0, onVertDragStart, isVertDragging }: {
    task: PerfTask | PerfSubtask;
    indent?: boolean;
    colorIdx?: number;
    onVertDragStart?: (e: React.MouseEvent) => void;
    isVertDragging?: boolean;
  }) {
    const isParent    = !indent;
    const taskKey     = (task as PerfTask).key;
    const isCollapsed = isParent && collapsed.has(taskKey);

    // For parent tasks: if any subtask has a dueDate, extend bar to the latest one
    const subtasks = isParent ? ((task as PerfTask).subtasks ?? []) : [];
    const subWithDue = subtasks.filter((st) => st.dueDate);
    const hasSubDeadlines = subWithDue.length > 0;

    const effectiveDueDate: string | null = (() => {
      if (!hasSubDeadlines) return task.dueDate;
      const latest = subWithDue.reduce<Date | null>((max, st) => {
        const d = parseLocalDate(st.dueDate!);
        return !max || d > max ? d : max;
      }, null);
      if (!latest) return task.dueDate;
      return `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, "0")}-${String(latest.getDate()).padStart(2, "0")}`;
    })();

    const bar = calcBar(
      effectiveDueDate, task.createdAt, task.status, days, task.title,
      task.estimatedHours,
      (task as PerfTask).assignee ?? (task as PerfSubtask).assignee,
    );

    // ── Color system — index-based palette ───────────────────────────────────
    const colorTokens = PALETTE[colorIdx % PALETTE.length];

    interface BarStyles {
      barBg: string; barOpacity: number;
      labelColor: string; leftBorder: string;
      prefix: string | null;
    }
    const styles: BarStyles = (() => {
      if (!bar) return { barBg:"#F3F4F6", barOpacity:1, labelColor:"#9ca3af", leftBorder:"#D1D5DB", prefix:null };

      // Task mãe — sempre usa a cor da paleta, sem override de status
      if (isParent) return {
        barBg:      colorTokens.bg,
        barOpacity: 1,
        labelColor: colorTokens.text,
        leftBorder: colorTokens.border,
        prefix:     null,
      };

      // Subtask — estados especiais têm prioridade sobre a cor da paleta
      if (bar.isDone)     return { barBg:"#F3F4F6", barOpacity:1, labelColor:"#6B7280", leftBorder:"#9CA3AF", prefix:"✅" };
      if (bar.isWaiting)  return { barBg:"#D1FAE5", barOpacity:1, labelColor:"#065F46", leftBorder:"#34D399", prefix:"⏳" };
      if (bar.isDueToday) return { barBg:"#FEF3C7", barOpacity:1, labelColor:"#92400E", leftBorder:"#F59E0B", prefix:"📅" };
      if (bar.overdue)    return { barBg:"#FEE2E2", barOpacity:1, labelColor:"#991B1B", leftBorder:"#EF4444", prefix:"⚠️" };

      // Subtask normal — cor sutil da paleta, borda a 50% de opacidade
      return {
        barBg:      colorTokens.subtle,
        barOpacity: 1,
        labelColor: colorTokens.subtleText,
        leftBorder: colorTokens.border + "80", // hex alpha = 50% opacity
        prefix:     null,
      };
    })();
    // ─────────────────────────────────────────────────────────────────────────

    // Globally overdue: past dueDate, not done, not waiting — persists across all weeks
    const todayMidnight = new Date(today); todayMidnight.setHours(0, 0, 0, 0);
    const taskDue = task.dueDate ? parseLocalDate(task.dueDate) : null;
    const isGloballyOverdue = !isParent &&
      taskDue !== null &&
      taskDue < todayMidnight &&
      task.status !== "done" &&
      task.status !== "in_review";

    const jiraHref = `${JIRA_BASE}/${taskKey}`;

    // ── Drag preview ──
    const isDragging     = barDragState?.key === taskKey;
    const previewOffset  = isDragging ? barDragOffset : 0;
    const dispStartCol   = bar ? Math.max(1, Math.min(days.length, bar.startCol      + previewOffset)) : null;
    const dispEndCol     = bar ? Math.max(1, Math.min(days.length, bar.endCol        + previewOffset)) : null;
    const dispExecCol    = bar ? Math.max(1, Math.min(days.length, bar.execStartCol  + previewOffset)) : null;

    // Subtask: column index where resolvedAt falls
    const subResolvedAtCol: number | null = !isParent
      ? (() => {
          const ra = (task as PerfSubtask).resolvedAt;
          if (!ra) return null;
          const raDate = parseLocalDate(ra); raDate.setHours(0, 0, 0, 0);
          for (let j = 0; j < days.length; j++) {
            const dj = new Date(days[j]); dj.setHours(0, 0, 0, 0);
            if (dj.getTime() === raDate.getTime()) return j + 1;
          }
          return null;
        })()
      : null;

    // Correção 2: parent ✅ on the day ALL subtasks are done (latest completion date)
    // True when every subtask is done — drives deadline vs ✅ on parent row
    const allSubsDone = isParent && subtasks.length > 0 && subtasks.every((st) => st.status === "done");

    const allDoneCol: number | null = (() => {
      if (!isParent || subtasks.length === 0) return null;
      if (!subtasks.every((st) => st.status === "done")) return null;
      let latest: Date | null = null;
      for (const st of subtasks) {
        const dateStr = st.resolvedAt ?? st.dueDate;
        if (!dateStr) continue;
        const d = parseLocalDate(dateStr); d.setHours(0, 0, 0, 0);
        if (!latest || d > latest) latest = d;
      }
      if (!latest) return null;
      for (let j = 0; j < days.length; j++) {
        const dj = new Date(days[j]); dj.setHours(0, 0, 0, 0);
        if (dj.getTime() === latest.getTime()) return j + 1;
      }
      return null;
    })();

    return (
      <div
        onClick={(e) => {
          // Exec cells stop propagation on mousedown, so clicks there won't reach here.
          // For all other cells, open Jira normally.
          window.open(jiraHref, "_blank");
        }}
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLS,
          borderBottom: "1px solid #f3f4f6",
          minHeight: isParent ? 32 : 28,
          background: isParent
            ? hexToRgba(colorTokens.bg, 0.15)
            : hexToRgba(colorTokens.bg, 0.06),
          cursor: "pointer",
          opacity: isVertDragging ? 0.3 : 1,
          transition: "opacity 0.1s",
        }}
      >
        {/* ── Label cell ── */}
        <div style={{
          padding: indent ? "0 8px 0 26px" : "0 6px 0 8px",
          display: "flex", alignItems: "center", gap: 4, minWidth: 0,
          borderLeft: isParent ? `4px solid ${colorTokens.bg}` : undefined,
        }}>
          {/* Vertical reorder handle — parent tasks only */}
          {isParent && onVertDragStart && (
            <div
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onVertDragStart(e); }}
              title="Arrastar para reordenar"
              style={{
                cursor: "ns-resize", flexShrink: 0, display: "flex",
                flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 2, height: 14, padding: "0 2px",
              }}
            >
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 8, height: 1.5, background: "#d1d5db", borderRadius: 1 }} />
              ))}
            </div>
          )}
          {isParent && (
            <button
              onClick={e => { e.stopPropagation(); toggleCollapsed(taskKey); }}
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

          <span
            title={task.title}
            style={{
              fontSize: indent ? 11 : 12, color: "#374151",
              fontWeight: isParent ? 600 : 400,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
            }}
          >
            {task.title}
          </span>

          <StatusBadge status={task.status} isOverdue={isGloballyOverdue} />

          {isParent && (
            <button
              onClick={e => {
                e.stopPropagation();
                if (manualKeys.includes(taskKey)) removeManualTask(taskKey);
                else hideTask(taskKey);
              }}
              title={manualKeys.includes(taskKey) ? "Remover task incluída manualmente" : "Ocultar task"}
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
          const cellN       = i + 1;
          const isToday     = sameDay(d, today);
          const inRange     = dispStartCol !== null && dispEndCol !== null
            ? cellN >= dispStartCol && cellN <= dispEndCol : false;
          const isPipeline  = dispExecCol !== null && inRange && cellN < dispExecCol;
          const isExec      = dispExecCol !== null && inRange && cellN >= dispExecCol;
          const isExecStart = isExec && dispExecCol !== null && cellN === dispExecCol;
          const isStart     = dispStartCol !== null && cellN === dispStartCol;
          const isEnd       = dispEndCol   !== null && cellN === dispEndCol;
          const isDueCell   = isEnd && inRange;
          const isPipeStart  = isPipeline && dispStartCol !== null && cellN === dispStartCol;
          const isAfterDue   = !inRange && dispEndCol !== null && cellN > dispEndCol;
          const isResolvedCell = subResolvedAtCol !== null && cellN === subResolvedAtCol;
          const hasComment   = commentedKeys.has(taskKey);

          // Subtask cell emoji (Melhoria 1 + 2)
          // isOverdue: past deadline, not done, not waiting feedback
          const isSubOverdue = !isParent && !!bar && bar.overdue && !bar.isDone && !bar.isWaiting;

          // Fix: ❗ only on days that already passed (≤ today), never on future days
          const isTodayOrPast = d <= today;

          const subEmoji: string | null = !isParent ? (() => {
            if (!bar && !isGloballyOverdue) return null;
            // 📦 removed — deadline label already shows "✅ · DD/M" for done cells (no overlap)
            // 📦⏳ handled separately as waiting-feedback cell
            // ❗ when overdue after deadline, ≤ today
            // Case A: deadline in this window → after due date
            if (isAfterDue && isSubOverdue && isTodayOrPast) return hasComment ? "❗💬" : "❗";
            // Case B: deadline was in a PAST week (bar=null) → all cells ≤ today are "after deadline"
            if (isGloballyOverdue && !bar && isTodayOrPast) return hasComment ? "❗💬" : "❗";
            return null;
          })() : null;

          // Fix 1: double-height cell for waiting-feedback subtask on due date
          const isWaitingDueCell = isDueCell && !isParent && !!bar?.isWaiting;

          // Subtask due cell bg override
          const subDueBg = !isParent && isDueCell && bar?.overdue && !bar.isDone && !bar.isWaiting
            ? "#FEE2E2" : undefined;

          const isWeekEnd   = i < days.length - 1 && days[i + 1].getDay() === 1;
          const borderRight = isToday
            ? "1px solid #c4b5fd"
            : isDueCell
            ? `1px solid ${styles.leftBorder}`
            : isWeekEnd
            ? "2px solid #9ca3af"
            : "1px dashed #d1d5db";

          // Border radius — only round the corners at the edge of the exec phase
          const execBarRadius = !bar ? "0"
            : isStart && !bar.startsBefore && isEnd ? "8px"
            : isStart && !bar.startsBefore          ? "8px 0 0 8px"
            : isEnd                                 ? "0 8px 8px 0"
            : "0";

          // For pipeline portion, use the same rounding at start
          const pipeBarRadius = !bar ? "0"
            : isStart && !bar.startsBefore ? "8px 0 0 8px"
            : "0";

          return (
            <div
              key={i}
              style={{
                position: "relative",
                borderRight,
                // Parent: borda no início do pipeline (primeiro cell do range), Subtask: no início do exec
                borderLeft: (isParent ? (isStart && !bar?.startsBefore) : isExecStart)
                  ? `${isParent ? 4 : 3}px solid ${styles.leftBorder}` : undefined,
                minHeight: isParent ? 32 : 28,
                background: subDueBg ?? (!inRange && isToday ? "#f5f3ff" : "transparent"),
                overflow: "visible",
              }}
            >
              {/* Pipeline phase — task mãe: sólido (cor da paleta). Subtask: translúcido 10% */}
              {isPipeline && (
                <div style={{
                  position: "absolute",
                  top: 5, bottom: 5, left: 0, right: 0,
                  background: colorTokens.bg,
                  opacity: isParent ? 1 : 0.1,
                  borderRadius: pipeBarRadius,
                }} />
              )}

              {/* "No pipeline" label — apenas subtasks (task mãe tem barra sólida) */}
              {isPipeStart && !isParent && (
                <span style={{
                  position: "absolute",
                  left: 4, top: "50%", transform: "translateY(-50%)",
                  fontSize: 8, fontWeight: 500, color: "#9ca3af",
                  whiteSpace: "nowrap", zIndex: 1, pointerEvents: "none",
                  maxWidth: "calc(100% - 8px)", overflow: "hidden", textOverflow: "ellipsis",
                  display: "block",
                }}>
                  No pipeline
                </span>
              )}

              {/* Execution phase — full-color bar (draggable) */}
              {isExec && (
                <div
                  onMouseDown={(e) => {
                    if (e.button !== 0 || bar!.isDone) return;
                    e.preventDefault();
                    e.stopPropagation(); // prevent row onClick
                    const dueIdx = (bar?.endCol ?? 1) - 1;
                    setBarDragState({
                      key:         taskKey,
                      startX:      e.clientX,
                      dueDateIdx:  dueIdx,
                      originalDue: task.dueDate ?? "",
                      jiraHref,
                    });
                    setBarDragOffset(0);
                    barDragOffsetRef.current = 0;
                  }}
                  style={{
                    position: "absolute",
                    top: 5, bottom: 5, left: 0, right: 0,
                    background: styles.barBg,
                    opacity: styles.barOpacity,
                    borderRadius: execBarRadius,
                    cursor: bar!.isDone ? "default" : isDragging ? "grabbing" : "grab",
                  }}
                />
              )}

              {/* Subtask cell emoji (deadline status + comment indicator) */}
              {subEmoji && !isDragging && (
                <span style={{
                  position: "absolute",
                  top: "50%", left: "50%",
                  transform: "translate(-50%, -50%)",
                  fontSize: 11, lineHeight: 1,
                  zIndex: 3, pointerEvents: "none", userSelect: "none",
                  whiteSpace: "nowrap",
                }}>
                  {subEmoji}
                </span>
              )}

              {/* Correção 2: ✅ on parent row when ALL subtasks are done */}
              {isParent && allDoneCol !== null && cellN === allDoneCol && (
                <span style={{
                  position: "absolute",
                  top: "50%", left: "50%",
                  transform: "translate(-50%, -50%)",
                  fontSize: 14, lineHeight: 1,
                  zIndex: 3, pointerEvents: "none", userSelect: "none",
                }}>
                  ✅
                </span>
              )}

              {/* Drag date indicator — shown in due cell while dragging */}
              {isDueCell && isDragging && previewOffset !== 0 && (
                <span style={{
                  position: "absolute",
                  right: 4, top: "50%", transform: "translateY(-50%)",
                  fontSize: 9, fontWeight: 700, color: "white",
                  textShadow: "0 1px 2px rgba(0,0,0,.4)",
                  whiteSpace: "nowrap", zIndex: 4, pointerEvents: "none",
                  background: "rgba(0,0,0,0.25)", borderRadius: 4, padding: "1px 5px",
                }}>
                  {`${days[(bar?.endCol ?? 1) - 1 + previewOffset]?.getDate()}/${(days[(bar?.endCol ?? 1) - 1 + previewOffset]?.getMonth() ?? 0) + 1}`}
                </span>
              )}

              {/* Waiting-feedback subtask due cell — only emojis, centered, tooltip on hover */}
              {isWaitingDueCell && (
                <div
                  title="Entregue · Aguardando feedback"
                  style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, zIndex: 1, pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  📦⏳
                </div>
              )}

              {/* Deadline / Em atraso label — only on own due date, not waiting subtask (handled above) */}
              {isDueCell && !hasSubDeadlines && !isWaitingDueCell && (
                <span style={{
                  position: "absolute",
                  right: 4, top: "50%", transform: "translateY(-50%)",
                  fontSize: 9, fontWeight: 700,
                  color: styles.labelColor,
                  textShadow: "none",
                  whiteSpace: "nowrap", zIndex: 1, pointerEvents: "none", lineHeight: 1,
                  maxWidth: "calc(100% - 8px)", overflow: "hidden", textOverflow: "ellipsis",
                  display: "block",
                }}>
                  {[
                    styles.prefix,
                    bar!.overdue ? "Em atraso"
                      : bar!.isDueToday ? "Entrega hoje"
                      : bar!.isDone ? "Entregue"
                      : "Deadline",
                    `· ${bar!.dueLabel}`,
                  ].filter(Boolean).join(" ")}
                </span>
              )}

              {/* Parent task deadline / done label on the due cell */}
              {isDueCell && isParent && bar && (() => {
                // allSubsDone + allDoneCol in window → ✅ already rendered by the block above
                if (allSubsDone && allDoneCol !== null) return false;
                return true;
              })() && (
                <span style={{
                  position: "absolute",
                  right: 4, top: "50%", transform: "translateY(-50%)",
                  fontSize: 9, fontWeight: 700,
                  color: styles.labelColor,
                  textShadow: "none",
                  whiteSpace: "nowrap", zIndex: 2, pointerEvents: "none", lineHeight: 1,
                  maxWidth: "calc(100% - 8px)", overflow: "hidden", textOverflow: "ellipsis",
                  display: "block",
                }}>
                  {allSubsDone ? `✅ Entregue · ${bar.dueLabel}` : `Deadline · ${bar.dueLabel}`}
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
    <>
    {/* ── Subtask deadline tooltip ── */}
    {tooltip && (
      <a
        href={tooltip.link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        onMouseEnter={cancelHide}
        onMouseLeave={hideTooltip}
        style={{
          position: "fixed",
          left: tooltip.x,
          top: tooltip.y,
          transform: "translateX(-50%)",
          zIndex: 9999,
          background: "#1f2937",
          color: "white",
          padding: "7px 11px",
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 500,
          textDecoration: "none",
          boxShadow: "0 4px 14px rgba(0,0,0,.28)",
          whiteSpace: "nowrap",
          pointerEvents: "all",
          lineHeight: 1.5,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <span style={{ fontWeight: 700, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
          {tooltip.title}
        </span>
        <span style={{ color: "#9ca3af", fontSize: 10 }}>
          Entrega: {tooltip.dateLabel} &nbsp;↗
        </span>
        {tooltip.isDone && (
          <span style={{ color: "#6ee7b7", fontSize: 10, fontWeight: 600 }}>
            ✅ Concluída
          </span>
        )}
      </a>
    )}
    <Shell>
      {/* ── Page header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#111", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: "#fef3c7", color: "#d97706", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>⚡</span>
          Performance Dashboard
          <span style={{ fontSize: 13, fontWeight: 400, color: "#9ca3af" }}>{periodLabel}</span>
        </h1>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {/* View toggle + navigation */}
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
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #eef0f3", marginBottom: 16 }}>

        {/* Sticky date header — own overflowX scroll, bar hidden by parent overflow:hidden */}
        <div style={{ position: "sticky", top: 0, zIndex: 10, overflow: "hidden", background: "white", borderBottom: "1px solid #eef0f3" }}>
          <div
            ref={ganttHeaderScrollRef}
            onScroll={(e) => { if (ganttContainerRef.current) ganttContainerRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
            style={{ overflowX: "auto", paddingBottom: 20, marginBottom: -20 }}
          >
            <div style={{ width: "100%" }}>
          {/* Column headers */}
          <div style={{
            display: "grid", gridTemplateColumns: GRID_COLS,
          }}>
            <div style={{ padding: "10px 12px", fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", position: "relative" }}>
              Task
              {/* Resize handle */}
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  labelResizeRef.current = { startX: e.clientX, startW: labelWidth };
                  setIsResizingLabel(true);
                }}
                title="Arrastar para redimensionar coluna"
                style={{
                  position: "absolute",
                  right: 0, top: 0, bottom: 0,
                  width: 8,
                  cursor: "col-resize",
                  zIndex: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{
                  width: 3, height: 18,
                  background: isResizingLabel ? "#7c3aed" : "#e5e7eb",
                  borderRadius: 2,
                  transition: "background 0.1s",
                }} />
              </div>
            </div>
            {days.map((d, i) => {
              const isT = sameDay(d, today);
              // Thicker solid separator between weeks (last day before a Monday)
              const isWeekEnd = i < days.length - 1 && days[i + 1].getDay() === 1;
              const headerBorder = isT ? "1px solid #c4b5fd"
                : isWeekEnd ? "2px solid #9ca3af"
                : "1px dashed #d1d5db";
              return (
                <div key={i} style={{
                  padding: "8px 4px", textAlign: "center",
                  borderRight: headerBorder,
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
            </div>{/* end width:100% inner */}
          </div>{/* end ganttHeaderScrollRef */}
        </div>{/* end sticky header wrapper */}

        {/* Scrollable body */}
        <div
          ref={ganttContainerRef}
          onScroll={(e) => { if (ganttHeaderScrollRef.current) ganttHeaderScrollRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
          style={{ overflowX: "auto" }}
        >
          <div style={{ width: "100%" }}>

          {/* Task rows */}
          {orderedVisibleActive.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              Nenhuma task ativa encontrada para o time de Performance.
            </div>
          )}

          {/* Sync ordered keys ref so vertical drag useEffect can read them */}
          {(perfOrderedRef.current = orderedVisibleActive.map((t) => t.key), null)}

          {orderedVisibleActive.map((task, idx) => (
            <div
              key={task.key}
              ref={(el) => {
                if (el) perfRowRefsMap.current.set(task.key, el);
                else perfRowRefsMap.current.delete(task.key);
              }}
              style={{
                borderTop: perfDropIdx === idx && perfVertDrag
                  ? "2px solid #7c3aed" : "2px solid transparent",
              }}
            >
              <TaskRow
                task={task}
                colorIdx={idx}
                onVertDragStart={() => setPerfVertDrag({ taskKey: task.key, fromIdx: idx })}
                isVertDragging={perfVertDrag?.taskKey === task.key}
              />
              {!collapsed.has(task.key) && task.subtasks.map((st) => (
                <TaskRow key={st.key} task={st as unknown as PerfTask} indent colorIdx={idx} />
              ))}
            </div>
          ))}

          {/* Drop indicator at end of list */}
          {perfDropIdx === orderedVisibleActive.length && perfVertDrag && (
            <div style={{ height: 2, background: "#7c3aed", margin: 0 }} />
          )}

          {/* Static members with no active tasks */}
          {STATIC_MEMBERS.filter((name) =>
            !orderedVisibleActive.some((t) =>
              t.assignee === name ||
              t.subtasks.some((st) => st.assignee === name)
            )
          ).map((name) => (
            <div key={name} style={{
              display: "grid",
              gridTemplateColumns: GRID_COLS,
              borderBottom: "1px solid #f3f4f6",
              minHeight: 32,
              background: "transparent",
              opacity: 0.55,
            }}>
              <div style={{ padding: "0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500 }}>{name}</span>
                <span style={{ fontSize: 10, color: "#d1d5db", fontStyle: "italic" }}>sem demandas</span>
              </div>
              {days.map((_, i) => (
                <div key={i} style={{ borderRight: "1px dashed #f3f4f6", minHeight: 32 }} />
              ))}
            </div>
          ))}
          </div>{/* end width:100% body */}
        </div>{/* end ganttContainerRef scroll div */}
      </div>{/* end gantt card */}

      {/* ── Color legend ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          { color: "#fecaca", label: "Em atraso ⚠️", textColor: "#b91c1c" },
          { color: "#fbbf24", label: "Entrega hoje 📅" },
          { color: "#fbcfe8", label: "Entr. p/ feedb. ⏳" },
          { color: "#9ca3af", label: "Entregue ✅" },
          { color: "#5b6cff", label: "Em andamento" },
        ].map(({ color, label, textColor }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: textColor ?? "#6b7280" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ── Entregas concluídas ── */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #eef0f3", marginBottom: 16, overflow: "hidden" }}>

          {/* Section header + search */}
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#374151" }}>📦 Entregas concluídas</span>
            <span style={{ fontSize: 11, color: "#9ca3af", background: "#f3f4f6", padding: "2px 8px", borderRadius: 10 }}>
              {doneTasks.length} {doneTasks.length === 1 ? "task" : "tasks"}
            </span>
            <input
              value={deliveredSearch}
              onChange={(e) => setDeliveredSearch(e.target.value)}
              placeholder="Buscar tarefas entregues..."
              style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12, color: "#111", outline: "none", background: "#fafafa", width: 220 }}
            />
          </div>

          {monthGroups.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              {deliveredSearch ? "Nenhum resultado para essa busca." : "Nenhuma task concluída ainda."}
            </div>
          )}

          {monthGroups.map((group) => {
            // When searching: always expand. Otherwise: use saved collapse state.
            const expanded = deliveredSearch ? true : !doneMonthsCollapsed.has(group.key);

            return (
              <div key={group.key} style={{ borderBottom: "1px solid #f3f4f6" }}>

                {/* Month row */}
                <button
                  onClick={() => { if (!deliveredSearch) toggleDoneMonth(group.key); }}
                  style={{
                    width: "100%", padding: "10px 16px",
                    display: "flex", alignItems: "center", gap: 8,
                    background: expanded ? "#fafafa" : "white",
                    border: "none", cursor: deliveredSearch ? "default" : "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 9, color: "#9ca3af", minWidth: 10, userSelect: "none" }}>
                    {expanded ? "▼" : "▶"}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>{group.label}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 2 }}>
                    — {group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}
                  </span>
                </button>

                {/* Task list */}
                {expanded && (
                  <div>
                    {group.tasks.map((t) => {
                      const delivDate = getDeliveryDate(t);
                      return (
                        <div key={t.key} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "7px 16px 7px 34px",
                          borderTop: "1px solid #f9fafb",
                        }}>
                          <a
                            href={`${JIRA_BASE}/${t.key}`}
                            target="_blank" rel="noopener noreferrer"
                            title={t.title}
                            style={{ flex: 1, fontSize: 12, color: "#374151", fontWeight: 500, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >
                            {t.title}
                          </a>
                          {delivDate && (
                            <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>
                              {shortDate(delivDate)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      {/* ── Month summary ── */}
      {view === "month" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #eef0f3", padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Resumo do mês
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
            <Stat label="Atrasos" value={monthStats.delays} color="#dc2626" />
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
    </>
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
