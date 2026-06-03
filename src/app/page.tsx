"use client";

import { useEffect, useRef, useState } from "react";

interface TaskItem {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  dueDate: string | null;
  estimatedHours: number;
  estimatedDetail: string;
  createdAt: string;
  parentKey?: string;
}

interface IncomingItem {
  id: string;
  key: string;
  title: string;
  status: string;
  assignee: string;
  dueDate: string | null;
  estimatedHours: number;
  createdAt: string;
}

interface MemberItem {
  name: string;
  avatar: string;
  totalHours: number;
  tasks: TaskItem[];
}

const JIRA = "https://tiendanube.atlassian.net/browse";

/* ── Team config ── */

const TEAM: Record<string, { role: string; area: string; dailyH: number; hasFreela: boolean }> = {
  eduardo: { role: "Design", area: "design", dailyH: 5.5, hasFreela: true },
  lucas: { role: "Design", area: "design", dailyH: 5.5, hasFreela: false },
  joao: { role: "Design", area: "design", dailyH: 5.5, hasFreela: false },
  beatriz: { role: "Copy", area: "copy", dailyH: 5.5, hasFreela: false },
  larissa: { role: "Motion & Vídeo", area: "motion", dailyH: 5.5, hasFreela: true },
  francisco: { role: "Motion & Vídeo", area: "motion", dailyH: 5.5, hasFreela: false },
};

function getConfig(name: string) {
  const key = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(" ")[0].split(".")[0];
  return TEAM[key] || { role: "", area: "", dailyH: 5.5, hasFreela: false };
}

/* ── Helpers ── */

function firstName(n: string): string {
  const p = n.split(" ")[0].split(".")[0];
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getOneWeekDays(offset: number): Date[] {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  mon.setHours(0, 0, 0, 0);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

function getTwoWeekDays(offset: number): Date[] {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  mon.setHours(0, 0, 0, 0);
  // 10 working days (Mon–Fri × 2 weeks), skipping the weekend between them
  return Array.from({ length: 10 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i + (i >= 5 ? 2 : 0));
    return d;
  });
}

function dayLabel(d: Date): string {
  return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d.getDay()];
}

/** Parse "YYYY-MM-DD" as LOCAL midnight — avoids UTC-offset off-by-one in BR timezone. */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/** Format a Date as "YYYY-MM-DD" in local timezone. */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Human-readable date in PT-BR for the confirmation modal. */
function fmtDatePT(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  const wd = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];
  const mo = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"][d.getMonth()];
  return `${wd}, ${d.getDate()} ${mo}`;
}

/* ── Gantt bars layout ── */

interface Bar {
  task: TaskItem;
  startCol: number;     // 1..10
  endCol: number;       // 1..10 (inclusive)
  lane: number;         // 0, 1, 2…
  startsBefore: boolean; // task started before visible window
  overdue: boolean;
  isDone: boolean;
  project: string;
  color: string;
}

function extractProject(title: string): string {
  // "LUMI MERCHANTS | COPY" → "LUMI MERCHANTS"
  // "Banner Black Friday — landing" → "Banner Black Friday"
  const pipe = title.split("|")[0];
  const dash = pipe.split(" — ")[0];
  const cleaned = dash.trim();
  if (cleaned.length <= 30) return cleaned;
  return cleaned.split(" ").slice(0, 3).join(" ");
}

const MAIN_LABEL_W_DEFAULT = 180;
const MAIN_LABEL_W_KEY     = "main_label_w_v1";

interface PaletteEntry { bg: string; text: string; subtleText: string; border: string; }

const PALETTE: PaletteEntry[] = [
  { bg: '#80B0E8', text: '#1a3a5c', subtleText: '#1a3a5c', border: '#5a8fc7' },
  { bg: '#008471', text: '#ffffff', subtleText: '#005a4d', border: '#006057' },
  { bg: '#D1CAEA', text: '#3b2d6e', subtleText: '#3b2d6e', border: '#9b90c9' },
  { bg: '#F4D242', text: '#5c3d00', subtleText: '#5c3d00', border: '#c9a800' },
  { bg: '#C45F3F', text: '#ffffff', subtleText: '#7a2e10', border: '#9a3e22' },
  { bg: '#898E46', text: '#ffffff', subtleText: '#3a3d10', border: '#5f6230' },
  { bg: '#FFC0C0', text: '#7a1c1c', subtleText: '#7a1c1c', border: '#e07070' },
  { bg: '#F29CC3', text: '#6b0a3a', subtleText: '#6b0a3a', border: '#c9609a' },
];

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${alpha})`;
}

// Keep projectColor for layoutBars backward compatibility
function projectColor(project: string): string {
  let hash = 0;
  for (let i = 0; i < project.length; i++) hash = (hash * 31 + project.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length].bg;
}

function dayIndex(d: Date, days: Date[]): number {
  for (let i = 0; i < days.length; i++) {
    if (sameDay(d, days[i])) return i;
  }
  return -1;
}

function layoutBars(
  tasks: TaskItem[],
  days: Date[],
  startOverrides: Record<string, number> = {},
): Bar[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const nowMs = now.getTime();
  const firstDay = new Date(days[0]); firstDay.setHours(0, 0, 0, 0);
  const lastDay = new Date(days[days.length - 1]); lastDay.setHours(0, 0, 0, 0);

  const candidates = tasks
    .filter((t) => {
      if (!t.dueDate) return false;
      const due = new Date(t.dueDate); due.setHours(0, 0, 0, 0);
      // Show done tasks only if they were due in the past (greyed out)
      if (t.status === "done") return due.getTime() < nowMs;
      return true;
    })
    .map((task) => {
      const due = parseLocalDate(task.dueDate!);
      const created = parseLocalDate(task.createdAt);

      // Skip if entirely outside visible window
      if (due.getTime() < firstDay.getTime()) return null;
      if (created.getTime() > lastDay.getTime()) return null;

      // Find closest visible day index for start
      let startCol = -1;
      let startsBefore = false;

      // Check for user-overridden start column (from left-handle drag)
      const overrideCol = startOverrides[task.id];
      if (overrideCol !== undefined) {
        startCol = overrideCol - 1; // stored as 1-based, convert to 0-based
        startsBefore = false;
      } else if (created.getTime() < firstDay.getTime()) {
        startsBefore = true;
        startCol = 0;
      } else {
        // walk forward to find first visible day >= created
        for (let i = 0; i < days.length; i++) {
          const di = new Date(days[i]); di.setHours(0, 0, 0, 0);
          if (di.getTime() >= created.getTime()) { startCol = i; break; }
        }
        if (startCol === -1) return null;
      }

      // Find end col (clamp to last visible day)
      let endCol = -1;
      for (let i = days.length - 1; i >= 0; i--) {
        const di = new Date(days[i]); di.setHours(0, 0, 0, 0);
        if (di.getTime() <= due.getTime()) { endCol = i; break; }
      }
      if (endCol === -1) endCol = startCol;
      if (endCol < startCol) endCol = startCol;

      const isDone = task.status === "done";
      const overdue = !isDone && due.getTime() < nowMs;
      const project = extractProject(task.title);
      return {
        task,
        startCol: startCol + 1,
        endCol: endCol + 1,
        lane: 0,
        startsBefore,
        overdue,
        isDone,
        project,
        color: projectColor(project),
      } as Bar;
    })
    .filter((x): x is Bar => x !== null);
  // One task per line — preserve input order, assign sequential lanes
  candidates.forEach((b, i) => { b.lane = i; });
  return candidates;
}

function fmtH(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}min`;
  const f = Math.floor(h);
  const m = Math.round((h - f) * 60);
  return m > 0 ? `${f}h${String(m).padStart(2, "0")}` : `${f}h`;
}

const AREA_COLORS: Record<string, string> = { design: "#7c3aed", copy: "#2563eb", motion: "#ea580c" };

function statusChipProps(status: string, isOverdue: boolean): { label: string; bg: string; color: string } {
  if (isOverdue) return { label: "⚠️ Em atraso",    bg: "#fee2e2", color: "#991b1b" };
  const map: Record<string, { label: string; bg: string; color: string }> = {
    done:        { label: "✅ Entregue",      bg: "#f3f4f6", color: "#6b7280" },
    in_review:   { label: "⏳ Aguardando",    bg: "#fff7ed", color: "#c2410c" },
    in_progress: { label: "🔵 Em andamento",  bg: "#eff6ff", color: "#1d4ed8" },
    to_do:       { label: "⚪ A fazer",        bg: "#f9fafb", color: "#9ca3af" },
  };
  return map[status] ?? map.to_do;
}

/* ── Component ── */

export default function Dashboard() {
  const [team, setTeam] = useState<MemberItem[]>([]);
  const [incoming, setIncoming] = useState<IncomingItem[]>([]);
  const [src, setSrc] = useState<"loading" | "ok" | "err">("loading");
  const [page, setPage] = useState(0);

  // ── Drag-resize state ──
  const [startOverrides, setStartOverrides] = useState<Record<string, number>>({});
  const [mainCollapsed, setMainCollapsed] = useState<Set<string>>(new Set());
  // ── Vertical reorder state ──
  const [taskOrders, setTaskOrders] = useState<Record<string, string[]>>({});
  const [vertDrag, setVertDrag] = useState<{ memberName: string; taskId: string; fromIdx: number } | null>(null);
  const [vertDropIdx, setVertDropIdx] = useState<{ memberName: string; idx: number } | null>(null);
  const barZoneRefs    = useRef<Map<string, HTMLDivElement>>(new Map());
  const vertDropIdxRef = useRef<{ memberName: string; idx: number } | null>(null);
  const rowsRef        = useRef<Array<{ member: MemberItem; bars: Bar[] }>>([]);
  const [dragState, setDragState] = useState<{
    key: string;
    handle: "left" | "right";
    startX: number;
    initialCol: number;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ key: string; col: number } | null>(null);
  const [pendingModal, setPendingModal] = useState<{
    key: string;
    title: string;
    newDate: string;
    prevDate: string | null;
  } | null>(null);
  const barZoneRef     = useRef<HTMLDivElement | null>(null);
  const dragPreviewRef = useRef<{ key: string; col: number } | null>(null);
  const ganttHeaderRef    = useRef<HTMLDivElement | null>(null);
  const ganttBodyRef      = useRef<HTMLDivElement | null>(null);
  const [labelWidth,      setLabelWidth]      = useState(MAIN_LABEL_W_DEFAULT);
  const [isResizingLabel, setIsResizingLabel] = useState(false);
  const labelResizeRef    = useRef<{ startX: number; startW: number } | null>(null);

  type UndoAction =
    | { type: "start"; key: string; prevCol: number | undefined }
    | { type: "deadline"; key: string; prevDate: string | null };
  const undoStackRef = useRef<UndoAction[]>([]);

  function loadJira() {
    fetch("/api/jira")
      .then((r) => r.json())
      .then((d) => {
        if (d.team?.length) { setTeam(d.team); setSrc("ok"); } else setSrc("err");
        if (d.newDemands?.length) setIncoming(d.newDemands);
      })
      .catch(() => setSrc("err"));
  }

  useEffect(() => {
    loadJira();
  }, []);

  const days = getTwoWeekDays(page);
  // Refs so drag effects always read current values without stale closure
  const daysRef = useRef(days);
  daysRef.current = days;
  const labelWidthRef = useRef(labelWidth);
  labelWidthRef.current = labelWidth;

  // Load start overrides from localStorage
  useEffect(() => {
    const saved: Record<string, number> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("gantt_start_")) {
        const col = parseInt(localStorage.getItem(k)!);
        if (!isNaN(col)) saved[k.replace("gantt_start_", "")] = col;
      }
    }
    if (Object.keys(saved).length > 0) setStartOverrides(saved);

    // Load vertical order overrides
    const orders: Record<string, string[]> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("gantt_order_")) {
        try { orders[k.slice("gantt_order_".length)] = JSON.parse(localStorage.getItem(k)!); }
        catch { /* ignore */ }
      }
    }
    if (Object.keys(orders).length > 0) setTaskOrders(orders);

    try {
      const raw = localStorage.getItem("main_collapsed_v1");
      if (raw) setMainCollapsed(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }

    const savedW = parseInt(localStorage.getItem(MAIN_LABEL_W_KEY) ?? "");
    if (!isNaN(savedW) && savedW >= 120) setLabelWidth(savedW);
  }, []);

  // Label column resize
  useEffect(() => {
    if (!isResizingLabel) return;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMouseMove = (e: MouseEvent) => {
      if (!labelResizeRef.current) return;
      const delta = e.clientX - labelResizeRef.current.startX;
      const newW  = Math.max(120, Math.min(480, labelResizeRef.current.startW + delta));
      setLabelWidth(newW);
    };
    const onMouseUp = () => {
      setIsResizingLabel(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setLabelWidth((w) => {
        localStorage.setItem(MAIN_LABEL_W_KEY, String(w));
        return w;
      });
      labelResizeRef.current = null;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizingLabel]);

  // Global drag mouse events
  useEffect(() => {
    if (!dragState) return;

    document.body.style.cursor     = "grabbing";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      // ganttBodyRef is the scrollable body — subtract current labelWidth to get day-columns width
      const bodyWidth = ganttBodyRef.current?.offsetWidth ?? 800;
      const numCols = daysRef.current.length;
      const colWidth = (bodyWidth - labelWidthRef.current) / numCols;
      const deltaX = e.clientX - dragState.startX;
      const deltaCols = Math.round(deltaX / colWidth);
      let newCol = dragState.initialCol + deltaCols;
      newCol = Math.max(1, Math.min(numCols, newCol));
      const dp = { key: dragState.key, col: newCol };
      dragPreviewRef.current = dp;
      setDragPreview(dp);
    };

    const onMouseUp = () => {
      const dp = dragPreviewRef.current;
      if (dp) {
        if (dragState.handle === "left") {
          // Push undo before applying change
          setStartOverrides((prev) => {
            undoStackRef.current = [
              ...undoStackRef.current,
              { type: "start", key: dragState.key, prevCol: prev[dragState.key] },
            ];
            const next = { ...prev, [dragState.key]: dp.col };
            localStorage.setItem(`gantt_start_${dragState.key}`, String(dp.col));
            return next;
          });
        } else {
          // Right handle: map column → date → open confirmation modal
          const dayIdx = dp.col - 1;
          const day = days[dayIdx];
          if (day) {
            const dateStr = formatLocalDate(day);
            const allTasks = team.flatMap((m) => m.tasks);
            const task = allTasks.find((t) => t.id === dragState.key);
            setPendingModal({
              key: dragState.key,
              title: task?.title ?? dragState.key,
              newDate: dateStr,
              prevDate: task?.dueDate ?? null,
            });
          }
        }
      }
      dragPreviewRef.current = null;
      setDragState(null);
      setDragPreview(null);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
    };
  }, [dragState, days, team]);

  // Prevent text selection while dragging
  useEffect(() => {
    if (dragState) {
      document.body.style.userSelect = "none";
    } else {
      document.body.style.userSelect = "";
    }
  }, [dragState]);

  // ── Vertical drag-to-reorder ──
  useEffect(() => {
    if (!vertDrag) return;
    document.body.style.cursor     = "ns-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      const el = barZoneRefs.current.get(vertDrag.memberName);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const relY  = e.clientY - rect.top - 10; // 10px top padding
      const idx   = Math.max(0, Math.round(relY / 32));
      const dp    = { memberName: vertDrag.memberName, idx };
      vertDropIdxRef.current = dp;
      setVertDropIdx(dp);
    };

    const onMouseUp = () => {
      const drop = vertDropIdxRef.current;
      const drag = vertDrag;
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
      setVertDrag(null);
      setVertDropIdx(null);
      vertDropIdxRef.current = null;
      if (!drop) return;

      const rowData = rowsRef.current.find(r => r.member.name === drag.memberName);
      if (!rowData) return;
      const numBars = rowData.bars.length;
      const toIdx   = Math.min(numBars, drop.idx);
      const fromIdx = drag.fromIdx;
      if (toIdx === fromIdx || toIdx === fromIdx + 1) return;

      const ids   = rowData.bars.map(b => b.task.id);
      const moved = ids.splice(fromIdx, 1)[0];
      ids.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);

      setTaskOrders(prev => {
        const next = { ...prev, [drag.memberName]: ids };
        localStorage.setItem(`gantt_order_${drag.memberName}`, JSON.stringify(ids));
        return next;
      });
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
    };
  }, [vertDrag]);

  function toggleMainCollapsed(key: string) {
    setMainCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem("main_collapsed_v1", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  async function confirmDeadline() {
    if (!pendingModal) return;
    // Push undo before API call
    undoStackRef.current = [
      ...undoStackRef.current,
      { type: "deadline", key: pendingModal.key, prevDate: pendingModal.prevDate },
    ];
    const res = await fetch("/api/jira/update-deadline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueKey: pendingModal.key, newDate: pendingModal.newDate }),
    });
    if (res.ok) {
      setPendingModal(null);
      setSrc("loading");
      loadJira();
    } else {
      undoStackRef.current = undoStackRef.current.slice(0, -1); // rollback push on error
      const data = await res.json().catch(() => ({ error: "Erro desconhecido" }));
      alert(`Erro ao atualizar prazo: ${data.error}`);
    }
  }

  // ── Cmd+Z / Ctrl+Z undo ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const stack = undoStackRef.current;
        if (stack.length === 0) return;
        const last = stack[stack.length - 1];
        undoStackRef.current = stack.slice(0, -1);

        if (last.type === "start") {
          // Restore previous startCol (or remove override entirely)
          setStartOverrides((prev) => {
            const next = { ...prev };
            if (last.prevCol === undefined) {
              delete next[last.key];
              localStorage.removeItem(`gantt_start_${last.key}`);
            } else {
              next[last.key] = last.prevCol;
              localStorage.setItem(`gantt_start_${last.key}`, String(last.prevCol));
            }
            return next;
          });
          // (lane overrides no longer used — one-task-per-line layout)
        } else if (last.type === "deadline") {
          // Restore previous dueDate in Jira
          if (last.prevDate) {
            fetch("/api/jira/update-deadline", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ issueKey: last.key, newDate: last.prevDate }),
            }).then((r) => {
              if (r.ok) {
                setSrc("loading");
                fetch("/api/jira")
                  .then((r2) => r2.json())
                  .then((d) => {
                    if (d.team?.length) { setTeam(d.team); setSrc("ok"); } else setSrc("err");
                    if (d.newDemands?.length) setIncoming(d.newDemands);
                  })
                  .catch(() => setSrc("err"));
              }
            });
          }
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []); // empty deps: uses refs + stable setState functions

  const today = new Date();
  const now = Date.now();
  // todayMidnight: para comparação de prazo — só é "em atraso" se passou do dia (< midnight de hoje)
  const todayMidnight = new Date(today); todayMidnight.setHours(0, 0, 0, 0);
  const GRID_COLS = `${labelWidth}px repeat(${days.length}, 1fr)`;

  const order = ["eduardo", "lucas", "joao", "beatriz", "larissa", "francisco"];
  const sorted = [...team].sort((a, b) => {
    const ka = firstName(a.name).toLowerCase();
    const kb = firstName(b.name).toLowerCase();
    const ia = order.indexOf(ka);
    const ib = order.indexOf(kb);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const rows = sorted.map((m) => {
    const cfg = getConfig(m.name);
    const areaC = AREA_COLORS[cfg.area] || "#6b7280";

    // Build parent-child map
    const taskMap = new Map(m.tasks.map(t => [t.key, t]));
    const parentTasks = m.tasks.filter(t => !t.parentKey || !taskMap.has(t.parentKey));
    const childMap = new Map<string, TaskItem[]>();
    m.tasks.filter(t => t.parentKey && taskMap.has(t.parentKey)).forEach(t => {
      const arr = childMap.get(t.parentKey!) ?? [];
      arr.push(t);
      childMap.set(t.parentKey!, arr);
    });

    function effectiveDue(t: TaskItem): Date | null {
      const subs = childMap.get(t.key) ?? [];
      const dates: Date[] = [];
      if (t.dueDate) dates.push(parseLocalDate(t.dueDate));
      subs.forEach(s => { if (s.dueDate) dates.push(parseLocalDate(s.dueDate)); });
      if (dates.length === 0) return null;
      return dates.reduce((a, b) => b > a ? b : a);
    }

    // Hide done tasks AND backlog (to_do with no effective deadline — unscheduled)
    const activeParents = parentTasks.filter(t => {
      if (t.status === "done") return false;
      // Backlog = to_do with no deadline on the task or any of its children
      if (t.status === "to_do" && effectiveDue(t) === null) return false;
      return true;
    });

    const sortedParents = [...activeParents].sort((a, b) => {
      const da = effectiveDue(a)?.getTime() ?? Infinity;
      const db = effectiveDue(b)?.getTime() ?? Infinity;
      return da - db;
    });

    const backlog = m.tasks.filter(t => !t.dueDate && t.status !== "done").length;
    return { member: m, cfg, areaC, orderedParents: sortedParents, childMap, backlog };
  });
  rowsRef.current = []; // reset (vertical reorder refs no longer needed in new layout)

  if (src === "loading") return <Shell><p style={{ color: "#9ca3af", textAlign: "center", padding: 80 }}>Conectando ao Jira...</p></Shell>;
  if (src === "err") return <Shell><p style={{ color: "#dc2626", textAlign: "center", padding: 80 }}>Erro ao conectar. Recarregue.</p></Shell>;

  return (
    <Shell>
      {/* Deadline confirmation modal */}
      {pendingModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            background: "white", borderRadius: 14, padding: "28px 32px",
            maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 6 }}>
              Alterar prazo
            </div>
            <div style={{
              fontSize: 11, color: "#7c3aed", fontWeight: 700, marginBottom: 4,
              background: "#ede9fe", display: "inline-block", padding: "2px 8px", borderRadius: 6,
            }}>
              {pendingModal.key}
            </div>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 16, marginTop: 6, lineHeight: 1.4 }}>
              {pendingModal.title.slice(0, 80)}{pendingModal.title.length > 80 ? "…" : ""}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Novo prazo:</span>
              <input
                type="date"
                value={pendingModal.newDate}
                onChange={(e) => setPendingModal(prev => prev ? { ...prev, newDate: e.target.value } : null)}
                style={{
                  fontSize: 13, fontWeight: 600, color: "#111",
                  background: "#f3f4f6", padding: "6px 12px", borderRadius: 8,
                  border: "1px solid #e5e7eb", cursor: "pointer", outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setPendingModal(null)}
                style={{
                  padding: "8px 18px", borderRadius: 8, border: "1px solid #e5e7eb",
                  background: "white", fontSize: 13, cursor: "pointer", color: "#374151",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeadline}
                style={{
                  padding: "8px 20px", borderRadius: 8, border: "none",
                  background: "#7c3aed", color: "white", fontSize: 13,
                  fontWeight: 700, cursor: "pointer",
                }}
              >
                Confirmar →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#111", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: "#ede9fe", color: "#7c3aed", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>✦</span>
          Creative Command Center
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <a href="/performance" style={{ background: "#0ea5e9", color: "white", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, textDecoration: "none", display: "inline-block" }}>📊 Performance</a>
          <a href="/nova-demanda" style={{ background: "#7c3aed", color: "white", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, textDecoration: "none", display: "inline-block" }}>+ Nova demanda</a>
          <Btn onClick={() => setPage((p) => p - 1)}>← 1 sem</Btn>
          <Btn onClick={() => setPage((p) => p + 1)}>1 sem →</Btn>
          {page !== 0 && <Btn onClick={() => setPage(0)}>Hoje</Btn>}
        </div>
      </div>

      {/* Gantt */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #eef0f3" }}>

        {/* Sticky date header — own overflow-x scroll, scrollbar hidden by outer overflow:hidden */}
        <div style={{ position: "sticky", top: 0, zIndex: 10, overflow: "hidden", background: "white", borderBottom: "1px solid #eef0f3" }}>
          <div
            ref={ganttHeaderRef}
            onScroll={(e) => { if (ganttBodyRef.current) ganttBodyRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
            style={{ overflowX: "auto", paddingBottom: 20, marginBottom: -20 }}
          >
            <div style={{ minWidth: 680 }}>
          {/* Header: day columns */}
          <div style={{ display: "grid", gridTemplateColumns: GRID_COLS }}>
            <div style={{ padding: "14px 16px", fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, position: "relative" }}>
              Time
              {/* Resize handle */}
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  labelResizeRef.current = { startX: e.clientX, startW: labelWidth };
                  setIsResizingLabel(true);
                }}
                title="Arrastar para redimensionar coluna"
                style={{
                  position: "absolute", right: 0, top: 0, bottom: 0, width: 8,
                  cursor: "col-resize", zIndex: 2,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <div style={{
                  width: 3, height: 18,
                  background: isResizingLabel ? "#7c3aed" : "#e5e7eb",
                  borderRadius: 2, transition: "background 0.1s",
                }} />
              </div>
            </div>
            {days.map((d, i) => {
              const isT = sameDay(d, today);
              const isMonday = d.getDay() === 1 && i > 0;
              return (
                <div
                  key={i}
                  style={{
                    padding: "8px 2px",
                    textAlign: "center",
                    borderRight: isT ? "1px solid #c4b5fd"
                      : (i < days.length - 1 && days[i + 1].getDay() === 1) ? "2px solid #9ca3af"
                      : i < days.length - 1 ? "1px solid #eef0f3" : "none",
                    background: isT ? "#f5f3ff" : "transparent",
                    position: "relative",
                  }}
                >
                  <div style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.3 }}>
                    {dayLabel(d)}
                  </div>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: isT ? "white" : "#111",
                    marginTop: 2,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: isT ? "#5b6cff" : "transparent",
                  }}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
            </div>{/* end minWidth */}
          </div>{/* end ganttHeaderRef scroll div */}
        </div>{/* end sticky header wrapper */}

        {/* Scrollable body */}
        <div
          ref={ganttBodyRef}
          onScroll={(e) => { if (ganttHeaderRef.current) ganttHeaderRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
          style={{ overflowX: "auto" }}
        >
          <div style={{ minWidth: 680 }}>

          {/* Member rows */}
          {rows.map(({ member, cfg, areaC, orderedParents, childMap, backlog }) => {
  return (
    <div key={member.name}>
      {/* ── Person header ── */}
      <div style={{
        display: "grid", gridTemplateColumns: GRID_COLS,
        borderBottom: "2px solid #e5e7eb",
        background: "#f9fafb", minHeight: 40,
      }}>
        <div style={{ padding: "6px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: areaC, color: "white",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}>{member.avatar}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#111", lineHeight: 1.2 }}>{firstName(member.name)}</div>
            <div style={{ fontSize: 10, color: "#9ca3af" }}>{cfg.role}</div>
            {backlog > 0 && <div style={{ fontSize: 9, color: "#d1d5db" }}>+{backlog} sem prazo</div>}
          </div>
        </div>
        {days.map((d, i) => {
          const isT = sameDay(d, today);
          const isLast = i === days.length - 1;
          return (
            <div key={i} style={{
              borderRight: isT ? "1px solid #c4b5fd"
                : (!isLast && days[i + 1].getDay() === 1) ? "2px solid #9ca3af"
                : isLast ? "none" : "1px dashed #e5e7eb",
              background: isT ? "#f0edff" : "transparent",
            }} />
          );
        })}
      </div>

      {/* ── Task hierarchy ── */}
      {orderedParents.map((parent, pIdx) => {
        const ct = PALETTE[pIdx % PALETTE.length];
        const parentBars = layoutBars([parent], days, startOverrides);
        const parentBar = parentBars[0] ?? null;
        const children = childMap.get(parent.key) ?? [];
        const isCollapsed = mainCollapsed.has(parent.key);

        // Parent bar display
        let parentStartIdx = parentBar ? parentBar.startCol - 1 : -1;
        let parentEndIdx   = parentBar ? parentBar.endCol   - 1 : -1;
        const isBeingDraggedParent = dragPreview?.key === parent.id;
        if (isBeingDraggedParent && dragState?.handle === "left") parentStartIdx = Math.min(dragPreview!.col, parentBar!.endCol) - 1;
        if (isBeingDraggedParent && dragState?.handle === "right") parentEndIdx = Math.max(dragPreview!.col, parentBar!.startCol) - 1;
        const parentLeftPct  = parentBar ? (parentStartIdx / days.length) * 100 : 0;
        const parentWidthPct = parentBar ? ((parentEndIdx - parentStartIdx + 1) / days.length) * 100 : 0;

        // All subs done → find latest delivery date column
        const allSubsDone = children.length > 0 && children.every(c => c.status === "done");
        const allDoneColIdx: number | null = (() => {
          if (!allSubsDone) return null;
          let latest: Date | null = null;
          for (const c of children) {
            const ds = c.dueDate;
            if (!ds) continue;
            const d = parseLocalDate(ds); d.setHours(0,0,0,0);
            if (!latest || d > latest) latest = d;
          }
          if (!latest) return null;
          for (let j = 0; j < days.length; j++) {
            const dj = new Date(days[j]); dj.setHours(0,0,0,0);
            if (dj.getTime() === latest.getTime()) return j;
          }
          return null;
        })();

        // suppress unused warning
        void parentLeftPct; void parentWidthPct;

        return (
          <div key={parent.key}>
            {/* Parent task row */}
            <div style={{
              display: "grid", gridTemplateColumns: GRID_COLS,
              borderBottom: "1px solid #e9ecef",
              minHeight: 32,
              background: hexToRgba(ct.bg, 0.15),
            }}>
              {/* Label cell */}
              <div style={{
                padding: "0 6px 0 8px", borderLeft: `4px solid ${ct.bg}`,
                display: "flex", alignItems: "center", gap: 4, minWidth: 0,
              }}>
                {children.length > 0 && (
                  <button onClick={() => toggleMainCollapsed(parent.key)}
                    style={{ background: "none", border: "none", cursor: "pointer",
                      color: "#9ca3af", fontSize: 8, padding: "1px 2px", flexShrink: 0, lineHeight: 1 }}>
                    {isCollapsed ? "▶" : "▼"}
                  </button>
                )}
                <a href={`${JIRA}/${parent.key}`} target="_blank" rel="noopener noreferrer"
                  style={{
                    fontSize: 11, fontWeight: 700, color: ct.subtleText,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    flex: 1, textDecoration: "none", minWidth: 0,
                  }}
                  title={parent.title}>
                  {parent.title}
                </a>
                {(() => {
                  const parentDue = parent.dueDate ? parseLocalDate(parent.dueDate) : null;
                  const parentOverdue = parentDue !== null && parentDue < todayMidnight && parent.status !== "done" && parent.status !== "in_review";
                  const chip = statusChipProps(parent.status, parentOverdue);
                  return (
                    <>
                      {/* Past-week deadline label (bar not visible in current window) */}
                      {!parentBar && parentDue && parentOverdue && (
                        <span style={{ fontSize: 9, color: "#991b1b", flexShrink: 0, whiteSpace: "nowrap" }}>
                          📅 {parentDue.getDate()}/{parentDue.getMonth()+1}
                        </span>
                      )}
                      <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 20,
                        background: chip.bg, color: chip.color, whiteSpace: "nowrap", flexShrink: 0 }}>
                        {chip.label}
                      </span>
                    </>
                  );
                })()}
              </div>

              {/* Day cells */}
              {days.map((d, i) => {
                const isT = sameDay(d, today);
                const cellN = i + 1;
                // Use preview-adjusted start/end for live drag movement
                const dispStart = parentStartIdx + 1;
                const dispEnd   = parentEndIdx + 1;
                const inParentRange = parentBar && cellN >= dispStart && cellN <= dispEnd;
                const isDueCell = parentBar && cellN === dispEnd && inParentRange;
                const isDeadlineCell = isDueCell && !allSubsDone;
                const isAllDoneCell = allDoneColIdx !== null && i === allDoneColIdx;
                const isLast = i === days.length - 1;

                const isWeekEnd = !isLast && days[i + 1].getDay() === 1;
                const borderRight = isT
                  ? "1px solid #c4b5fd"
                  : isDeadlineCell ? `2px solid ${ct.border}`
                  : isWeekEnd ? "2px solid #9ca3af"
                  : isLast ? "none"
                  : "1px dashed #e5e7eb";

                return (
                  <div key={i} style={{
                    position: "relative",
                    borderRight,
                    minHeight: 32,
                    background: isT && !inParentRange ? "#f5f3ff" : "transparent",
                  }}>
                    {/* Parent bar */}
                    {inParentRange && (
                      <div
                        onMouseDown={(e) => {
                          if (e.button !== 0 || parentBar.isDone) return;
                          e.preventDefault();
                          setDragState({ key: parent.id, handle: cellN === dispStart ? "left" : "right", startX: e.clientX, initialCol: cellN === dispStart ? dispStart : dispEnd });
                        }}
                        style={{
                          position: "absolute", top: 4, bottom: 4, left: 0, right: 0,
                          background: ct.bg,
                          borderRadius: (cellN === dispStart && !parentBar.startsBefore) && cellN === dispEnd ? "4px"
                            : (cellN === dispStart && !parentBar.startsBefore) ? "4px 0 0 4px"
                            : cellN === dispEnd ? "0 4px 4px 0" : "0",
                          opacity: parentBar.isDone ? 0.5 : 1,
                          cursor: parentBar.isDone ? "default" : isBeingDraggedParent ? "grabbing" : "grab",
                        }}
                      />
                    )}
                    {/* Deadline label — centered in the due-date cell */}
                    {isDeadlineCell && parentBar && (
                      <span style={{
                        position: "absolute", left: "50%", top: "50%",
                        transform: "translate(-50%, -50%)",
                        fontSize: 9, fontWeight: 700, color: ct.text,
                        whiteSpace: "nowrap", zIndex: 2, pointerEvents: "none",
                        maxWidth: "calc(100% - 6px)", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {`Deadline · ${parseLocalDate(parent.dueDate!).getDate()}/${parseLocalDate(parent.dueDate!).getMonth()+1}`}
                      </span>
                    )}
                    {/* ✅ when all subtasks done */}
                    {isAllDoneCell && (
                      <span style={{
                        position: "absolute", top: "50%", left: "50%",
                        transform: "translate(-50%,-50%)",
                        fontSize: 14, zIndex: 2, pointerEvents: "none",
                      }}>✅</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Subtask rows */}
            {!isCollapsed && children.map((sub) => {
              const subBars = layoutBars([sub], days, startOverrides);
              const subBar = subBars[0] ?? null;
              const isBeingDraggedSub = dragPreview?.key === sub.id;
              let subStartIdx = subBar ? subBar.startCol - 1 : -1;
              let subEndIdx   = subBar ? subBar.endCol   - 1 : -1;
              if (isBeingDraggedSub && dragState?.handle === "left") subStartIdx = Math.min(dragPreview!.col, subBar!.endCol) - 1;
              if (isBeingDraggedSub && dragState?.handle === "right") subEndIdx = Math.max(dragPreview!.col, subBar!.startCol) - 1;

              // Display-adjusted columns for live drag preview
              const dispSubStart = subStartIdx + 1;
              const dispSubEnd   = subEndIdx + 1;

              const isWaiting = sub.status === "in_review";
              const _today2 = new Date(); _today2.setHours(0,0,0,0);
              const _subDue = sub.dueDate ? parseLocalDate(sub.dueDate) : null;
              const subIsDueToday = !!_subDue && _subDue.getTime() === _today2.getTime();

              const subBg = sub.status === "done" ? "#F3F4F6"
                : isWaiting ? "#D1FAE5"
                : subBar?.overdue ? "#FEE2E2"
                : subIsDueToday ? "#FEF3C7"
                : hexToRgba(ct.bg, 0.22);
              const subBorder = sub.status === "done" ? "#9CA3AF"
                : isWaiting ? "#34D399"
                : subBar?.overdue ? "#EF4444"
                : subIsDueToday ? "#F59E0B"
                : ct.border + "80";
              const subTextColor = sub.status === "done" ? "#6B7280"
                : isWaiting ? "#065F46"
                : subBar?.overdue ? "#991B1B"
                : subIsDueToday ? "#92400E"
                : ct.subtleText; // dark readable on translucent background

              return (
                <div key={sub.key} style={{
                  display: "grid", gridTemplateColumns: GRID_COLS,
                  borderBottom: "1px solid #f0f0f0",
                  minHeight: 28,
                  background: hexToRgba(ct.bg, 0.06),
                }}>
                  {/* Subtask label */}
                  <div style={{
                    padding: "0 6px 0 20px",
                    display: "flex", alignItems: "center", gap: 4, minWidth: 0,
                  }}>
                    <span style={{ color: "#d1d5db", fontSize: 10, flexShrink: 0 }}>↳</span>
                    <a href={`${JIRA}/${sub.key}`} target="_blank" rel="noopener noreferrer"
                      style={{
                        fontSize: 10, fontWeight: 400, color: "#374151",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        flex: 1, textDecoration: "none", minWidth: 0,
                      }}
                      title={sub.title}>
                      {sub.title}
                    </a>
                    {(() => {
                      const subDue2 = sub.dueDate ? parseLocalDate(sub.dueDate) : null;
                      const subOverdue2 = subDue2 !== null && subDue2 < todayMidnight && sub.status !== "done" && sub.status !== "in_review";
                      const chip = statusChipProps(sub.status, subOverdue2);
                      return (
                        <>
                          {/* Past-week deadline label */}
                          {!subBar && subDue2 && subOverdue2 && (
                            <span style={{ fontSize: 9, color: "#991b1b", flexShrink: 0, whiteSpace: "nowrap" }}>
                              📅 {subDue2.getDate()}/{subDue2.getMonth()+1}
                            </span>
                          )}
                          <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 20,
                            background: chip.bg, color: chip.color, whiteSpace: "nowrap", flexShrink: 0 }}>
                            {chip.label}
                          </span>
                        </>
                      );
                    })()}
                  </div>

                  {/* Subtask day cells */}
                  {days.map((d, i) => {
                    const isT = sameDay(d, today);
                    const cellN = i + 1;
                    const inSubRange = subBar && cellN >= dispSubStart && cellN <= dispSubEnd;
                    const isAfterDue = subBar && !inSubRange && cellN > dispSubEnd;
                    const isOverdueDay = !!subBar?.overdue && !sub.status.includes("done") && !isWaiting;
                    const isSubDueCell = subBar && cellN === dispSubEnd && inSubRange;
                    const isLastCell = i === days.length - 1;

                    // ❗ on days after deadline ≤ today (not done, not waiting)
                    const showExcl = isAfterDue && isOverdueDay && d <= today;
                    // 📦⏳ on due cell when waiting
                    const showWaiting = isSubDueCell && isWaiting;

                    const isSubWeekEnd = !isLastCell && days[i + 1].getDay() === 1;
                    const subCellBorder = isT
                      ? "1px solid #c4b5fd"
                      : isSubDueCell && !isWaiting ? `2px solid ${subBorder}`
                      : isSubWeekEnd ? "2px solid #9ca3af"
                      : isLastCell ? "none"
                      : "1px dashed #e5e7eb";

                    return (
                      <div key={i} style={{
                        position: "relative",
                        borderRight: subCellBorder,
                        minHeight: 28,
                        background: (subBar?.overdue && !isWaiting && isSubDueCell) ? "#FEE2E2"
                          : isT && !inSubRange ? "#f5f3ff" : "transparent",
                      }}>
                        {/* Subtask bar */}
                        {inSubRange && (
                          <div
                            onMouseDown={(e) => {
                              if (e.button !== 0 || sub.status === "done") return;
                              e.preventDefault();
                              setDragState({ key: sub.id, handle: cellN === dispSubStart ? "left" : "right", startX: e.clientX, initialCol: cellN === dispSubStart ? dispSubStart : dispSubEnd });
                            }}
                            style={{
                              position: "absolute", top: 3, bottom: 3, left: 0, right: 0,
                              background: subBg,
                              borderLeft: cellN === subBar.startCol ? `3px solid ${subBorder}` : undefined,
                              borderRadius: (cellN === dispSubStart && !subBar.startsBefore) && cellN === dispSubEnd ? "3px"
                                : (cellN === dispSubStart && !subBar.startsBefore) ? "3px 0 0 3px"
                                : cellN === dispSubEnd ? "0 3px 3px 0" : "0",
                              opacity: sub.status === "done" ? 0.7 : 1,
                              cursor: sub.status === "done" ? "default" : isBeingDraggedSub ? "grabbing" : "grab",
                            }}
                          />
                        )}
                        {/* Deadline label — centered in due-date cell */}
                        {subBar && cellN === subBar.endCol && inSubRange && !isWaiting && (
                          <span style={{
                            position: "absolute", left: "50%", top: "50%",
                            transform: "translate(-50%, -50%)",
                            fontSize: 9, fontWeight: 700, color: subTextColor,
                            whiteSpace: "nowrap", zIndex: 2, pointerEvents: "none",
                            maxWidth: "calc(100% - 6px)", overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            {sub.status === "done" ? `✅ · ${parseLocalDate(sub.dueDate!).getDate()}/${parseLocalDate(sub.dueDate!).getMonth()+1}`
                              : subBar.overdue ? `⚠️ · ${parseLocalDate(sub.dueDate!).getDate()}/${parseLocalDate(sub.dueDate!).getMonth()+1}`
                              : subIsDueToday ? `📅 · ${parseLocalDate(sub.dueDate!).getDate()}/${parseLocalDate(sub.dueDate!).getMonth()+1}`
                              : `Deadline · ${parseLocalDate(sub.dueDate!).getDate()}/${parseLocalDate(sub.dueDate!).getMonth()+1}`}
                          </span>
                        )}
                        {/* 📦⏳ waiting cell */}
                        {showWaiting && (
                          <span title="Entregue · Aguardando feedback" style={{
                            position: "absolute", top: "50%", left: "50%",
                            transform: "translate(-50%,-50%)",
                            fontSize: 11, zIndex: 2, pointerEvents: "none", userSelect: "none",
                          }}>📦⏳</span>
                        )}
                        {/* ❗ overdue indicator */}
                        {showExcl && (
                          <span style={{
                            position: "absolute", top: "50%", left: "50%",
                            transform: "translate(-50%,-50%)",
                            fontSize: 11, zIndex: 2, pointerEvents: "none", userSelect: "none",
                          }}>❗</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
})}
          </div>{/* end minWidth body */}
        </div>{/* end ganttBodyRef scroll div */}
      </div>{/* end gantt card */}

      {/* Incoming panel */}
      {incoming.length > 0 && <IncomingPanel items={incoming} />}

      {/* Legend */}
      <div style={{ marginTop: 14, display: "flex", gap: 14, fontSize: 11, color: "#9ca3af", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 24, height: 8, borderRadius: 999, background: "#5b6cff" }} />
          uma cor por projeto
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 24, height: 8, borderRadius: 999, background: "#d1fae5", border: "1px solid #a7f3d0" }} />
          ⏳ aguardando feedback
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 24, height: 8, borderRadius: 999, background: "#fbbf24" }} />
          📅 entrega hoje
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 24, height: 8, borderRadius: 999, background: "#ef4444" }} />
          ⚠️ atrasada
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 24, height: 8, borderRadius: 999, background: "#5b6cff", borderLeft: "3px solid rgba(255,255,255,0.6)" }} />
          começou antes
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10 }}>
          Tasks sem prazo não aparecem na timeline
        </span>
      </div>

      <footer style={{ textAlign: "center", padding: "20px 0 10px", fontSize: 9, color: "#d1d5db" }}>
        Creative Command Center · Brand Creative · Nuvemshop
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f8f9fb", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 12px" }}>{children}</div>
    </div>
  );
}

function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, color: "#374151" }}>
      {children}
    </button>
  );
}

function IncomingPanel({ items }: { items: IncomingItem[] }) {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  // Dismiss state — persisted per week, auto-resets next week
  const weekKey = `incoming_dismissed_${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(weekKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });

  function dismiss(id: string) {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(weekKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  // parseLocalDate avoids UTC-parse bug: new Date("2026-06-01") → UTC midnight → Brazil = May 31 21h
  const thisWeek = items
    .filter((i) => parseLocalDate(i.createdAt) >= monday)
    .filter((i) => !dismissed.has(i.id));
  const assigned   = thisWeek.filter((i) => i.assignee);
  const unassigned = thisWeek.filter((i) => !i.assignee);
  const totalDismissed = dismissed.size;

  const statusLabel: Record<string, { label: string; color: string; bg: string }> = {
    to_do:       { label: "A fazer",     color: "#6b7280", bg: "#f3f4f6" },
    in_progress: { label: "Em andamento", color: "#2563eb", bg: "#eff6ff" },
    in_review:   { label: "Em revisão",  color: "#d97706", bg: "#fffbeb" },
    done:        { label: "Concluído",   color: "#16a34a", bg: "#f0fdf4" },
  };

  function relativeDay(dateStr: string): string {
    const d = new Date(dateStr);
    const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diff === 0) return "hoje";
    if (diff === 1) return "ontem";
    return `há ${diff} dias`;
  }

  return (
    <div style={{ marginTop: 24, background: "white", borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Entrantes essa semana</span>
          <span style={{ background: "#ede9fe", color: "#7c3aed", borderRadius: 99, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>
            {thisWeek.length}
          </span>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#6b7280", alignItems: "center" }}>
          <span>✅ {assigned.length} atribuídas</span>
          <span>⏳ {unassigned.length} sem responsável</span>
          {totalDismissed > 0 && (
            <button
              onClick={() => { setDismissed(new Set()); try { localStorage.removeItem(weekKey); } catch {} }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#9ca3af", textDecoration: "underline", padding: 0 }}
            >
              mostrar {totalDismissed} oculta{totalDismissed > 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {thisWeek.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
          Nenhuma task nova essa semana.
        </div>
      ) : (
        <div>
          {thisWeek.map((item, idx) => {
            const st = statusLabel[item.status] || statusLabel.to_do;
            return (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 16px",
                  borderBottom: idx < thisWeek.length - 1 ? "1px solid #f9fafb" : "none",
                  flexWrap: "wrap",
                }}
              >
                {/* Key */}
                <a
                  href={`${JIRA}/${item.key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", textDecoration: "none", minWidth: 72, flexShrink: 0 }}
                >
                  {item.key}
                </a>

                {/* Title */}
                <span style={{ fontSize: 12, color: "#111", flex: 1, minWidth: 120 }}>
                  {item.title}
                </span>

                {/* Status badge */}
                <span style={{ fontSize: 10, fontWeight: 600, color: st.color, background: st.bg, borderRadius: 99, padding: "2px 8px", flexShrink: 0 }}>
                  {st.label}
                </span>

                {/* Assignee or unassigned */}
                <span style={{ fontSize: 11, color: item.assignee ? "#374151" : "#d1d5db", minWidth: 80, flexShrink: 0 }}>
                  {item.assignee ? item.assignee.split(" ")[0] : "— sem dono"}
                </span>

                {/* Date */}
                <span style={{ fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>
                  {(() => { const d = new Date(item.createdAt); return `${d.getDate()}/${d.getMonth()+1}`; })()}
                  <span style={{ color: "#d1d5db", marginLeft: 3 }}>({relativeDay(item.createdAt)})</span>
                </span>

                {/* Hours estimate */}
                <span style={{ fontSize: 10, color: "#c4b5fd", flexShrink: 0 }}>
                  {fmtH(item.estimatedHours)}
                </span>

                {/* Dismiss button */}
                <button
                  onClick={() => dismiss(item.id)}
                  title="Ocultar desta lista"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#d1d5db", fontSize: 14, lineHeight: 1,
                    padding: "2px 4px", flexShrink: 0, borderRadius: 4,
                    transition: "color 0.1s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#d1d5db")}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

