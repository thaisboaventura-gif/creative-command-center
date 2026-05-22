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

const PROJECT_PALETTE = [
  "#5b6cff", // blue
  "#6dd49e", // green
  "#ee8094", // pink
  "#fb923c", // orange
  "#a78bfa", // purple
  "#2dd4bf", // teal
  "#38bdf8", // cyan
  "#facc15", // yellow
  "#f472b6", // rose
  "#84cc16", // lime
];

function projectColor(project: string): string {
  let hash = 0;
  for (let i = 0; i < project.length; i++) {
    hash = (hash * 31 + project.charCodeAt(i)) >>> 0;
  }
  return PROJECT_PALETTE[hash % PROJECT_PALETTE.length];
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

/* ── Component ── */

export default function Dashboard() {
  const [team, setTeam] = useState<MemberItem[]>([]);
  const [incoming, setIncoming] = useState<IncomingItem[]>([]);
  const [src, setSrc] = useState<"loading" | "ok" | "err">("loading");
  const [page, setPage] = useState(0);

  // ── Drag-resize state ──
  const [startOverrides, setStartOverrides] = useState<Record<string, number>>({});
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
  const barZoneRef = useRef<HTMLDivElement | null>(null);
  const dragPreviewRef = useRef<{ key: string; col: number } | null>(null);

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

  const days = getOneWeekDays(page);

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
  }, []);

  // Global drag mouse events
  useEffect(() => {
    if (!dragState) return;

    const onMouseMove = (e: MouseEvent) => {
      const containerWidth = barZoneRef.current?.offsetWidth ?? 500;
      const colWidth = containerWidth / 5;
      const deltaX = e.clientX - dragState.startX;
      const deltaCols = Math.round(deltaX / colWidth);
      let newCol = dragState.initialCol + deltaCols;
      newCol = Math.max(1, Math.min(5, newCol));
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

  const order = ["eduardo", "lucas", "joao", "beatriz", "larissa", "francisco"];
  const sorted = [...team].sort((a, b) => {
    const ka = firstName(a.name).toLowerCase();
    const kb = firstName(b.name).toLowerCase();
    const ia = order.indexOf(ka);
    const ib = order.indexOf(kb);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const rows = sorted.map((m) => {
    const cfg    = getConfig(m.name);
    const active = m.tasks.filter((t) => t.status !== "done");
    // Apply saved vertical order
    const customOrder = taskOrders[m.name] || [];
    const orderedActive = customOrder.length > 0
      ? [
          ...customOrder.map(id => active.find(t => t.id === id)).filter(Boolean) as TaskItem[],
          ...active.filter(t => !customOrder.includes(t.id)),
        ]
      : active;
    const bars    = layoutBars(orderedActive, days, startOverrides);
    const lanes   = bars.length; // one per line
    const backlog = active.filter((t) => !t.dueDate).length;
    return { member: m, cfg, bars, lanes, backlog };
  });
  rowsRef.current = rows.map(r => ({ member: r.member, bars: r.bars }));

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
              <span style={{
                fontSize: 13, fontWeight: 700, color: "#111",
                background: "#f3f4f6", padding: "4px 12px", borderRadius: 8,
              }}>
                📅 {fmtDatePT(pendingModal.newDate)}
              </span>
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
      <div style={{ overflowX: "auto", background: "white", borderRadius: 12, border: "1px solid #eef0f3" }}>
        <div style={{ minWidth: 680 }}>

          {/* Header: day columns */}
          <div style={{ display: "grid", gridTemplateColumns: "180px repeat(5, 1fr)", borderBottom: "1px solid #eef0f3" }}>
            <div style={{ padding: "14px 16px", fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Time
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
                    borderLeft: isMonday ? "1px solid #eef0f3" : "none",
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

          {/* Member rows */}
          {rows.map(({ member, cfg, bars, lanes, backlog }) => {
            const areaC = AREA_COLORS[cfg.area] || "#6b7280";
            const rowHeight = Math.max(76, 28 + lanes * 32);

            return (
              <div
                key={member.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "180px repeat(5, 1fr)",
                  borderBottom: "1px solid #f3f4f6",
                  minHeight: rowHeight,
                }}
              >
                {/* Name cell */}
                <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: areaC,
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>
                    {member.avatar}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111", lineHeight: 1.2 }}>
                      {firstName(member.name)}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                      {cfg.role}
                    </div>
                    {backlog > 0 && (
                      <div style={{ fontSize: 9, color: "#d1d5db", marginTop: 2 }}>
                        +{backlog} sem prazo
                      </div>
                    )}
                  </div>
                </div>

                {/* Bar zone — relative container spanning 5 columns */}
                <div
                  ref={(el) => {
                    if (el) barZoneRefs.current.set(member.name, el);
                    else barZoneRefs.current.delete(member.name);
                    if (!barZoneRef.current && el) barZoneRef.current = el;
                  }}
                  style={{ gridColumn: "2 / 7", position: "relative", padding: "10px 0" }}
                >
                  {/* Vertical drop indicator */}
                  {vertDropIdx?.memberName === member.name && (
                    <div style={{
                      position: "absolute", left: 0, right: 0, zIndex: 20,
                      top: vertDropIdx.idx * 32 + 8 - 2,
                      height: 2, background: "#7c3aed", borderRadius: 1,
                      pointerEvents: "none",
                    }} />
                  )}
                  {/* Vertical day separators */}
                  {days.map((d, i) => {
                    const isT = sameDay(d, today);
                    const isMonday = d.getDay() === 1 && i > 0;
                    return (
                      <div
                        key={i}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: `${(i / 5) * 100}%`,
                          width: 1,
                          background: isT ? "#5b6cff" : isMonday ? "#eef0f3" : "transparent",
                          opacity: isT ? 0.3 : 1,
                        }}
                      />
                    );
                  })}
                  {/* Today column highlight */}
                  {days.map((d, i) => {
                    if (!sameDay(d, today)) return null;
                    return (
                      <div
                        key={`today-${i}`}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: `${(i / 5) * 100}%`,
                          width: `${100 / 5}%`,
                          background: "#f5f3ff",
                          opacity: 0.5,
                          zIndex: 0,
                        }}
                      />
                    );
                  })}

                  {/* Bars */}
                  {bars.map((bar, barIdx) => {
                    const isVertDragging = vertDrag?.memberName === member.name && vertDrag.taskId === bar.task.id;
                    // Apply drag preview to this bar's columns
                    const isBeingDragged = dragPreview?.key === bar.task.id;
                    const displayStartCol = (isBeingDragged && dragState?.handle === "left")
                      ? Math.min(dragPreview!.col, bar.endCol)
                      : bar.startCol;
                    const displayEndCol = (isBeingDragged && dragState?.handle === "right")
                      ? Math.max(dragPreview!.col, bar.startCol)
                      : bar.endCol;

                    const startIdx = displayStartCol - 1;
                    const endIdx   = displayEndCol - 1;
                    const leftPct  = (startIdx / 5) * 100;
                    const widthPct = ((endIdx - startIdx + 1) / 5) * 100;
                    const top = bar.lane * 32;

                    const isWaiting = bar.task.status === "in_review";
                    const _today = new Date(); _today.setHours(0,0,0,0);
                    const _due = bar.task.dueDate ? parseLocalDate(bar.task.dueDate) : null;
                    const isDueToday = !!_due && _due.getTime() === _today.getTime();

                    const barBg = bar.isDone
                      ? "#9ca3af"
                      : isWaiting
                      ? "#d1fae5"
                      : bar.overdue
                      ? "#ef4444"
                      : isDueToday
                      ? "#fbbf24"
                      : bar.color;
                    const textColor = isWaiting && !bar.isDone && !bar.overdue ? "#065f46" : "white";
                    const barLabel = bar.isDone
                      ? `✅ ${bar.task.title}`
                      : isWaiting && bar.overdue
                      ? `⚠️⏳ ${bar.task.title}`
                      : isWaiting
                      ? `⏳ ${bar.task.title}`
                      : bar.overdue
                      ? `⚠️ ${bar.task.title}`
                      : isDueToday
                      ? `📅 ${bar.task.title}`
                      : bar.task.title;
                    const titleTip = bar.isDone
                      ? `✅ Entregue · ${bar.task.key} · ${bar.task.title}${bar.task.dueDate ? `\nPrazo: ${bar.task.dueDate}` : ""}`
                      : bar.overdue
                      ? `⚠️ ATRASADA · ${bar.task.key} · ${bar.task.title}${bar.task.dueDate ? `\nPrazo: ${bar.task.dueDate}` : ""}`
                      : isDueToday
                      ? `📅 Entrega hoje · ${bar.task.key} · ${bar.task.title}`
                      : isWaiting
                      ? `⏳ Aguardando feedback · ${bar.task.key} · ${bar.task.title}${bar.task.dueDate ? `\nEntrega: ${bar.task.dueDate}` : ""}`
                      : `${bar.task.key} · ${bar.task.title}${bar.task.dueDate ? `\nEntrega: ${bar.task.dueDate}` : ""}`;

                    return (
                      <div
                        key={bar.task.id}
                        style={{
                          position: "absolute",
                          left: `calc(${leftPct}% + 4px)`,
                          width: `calc(${widthPct}% - 8px)`,
                          top: top + 8,
                          height: 26,
                          zIndex: isBeingDragged ? 10 : 1,
                          opacity: isVertDragging ? 0.3 : 1,
                        }}
                      >
                        {/* Left resize handle */}
                        <div
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragState({ key: bar.task.id, handle: "left", startX: e.clientX, initialCol: bar.startCol });
                          }}
                          title="Arrastar para mudar início"
                          style={{
                            position: "absolute",
                            left: 0, top: 0, bottom: 0,
                            width: 10,
                            cursor: "ew-resize",
                            zIndex: 5,
                            borderRadius: "999px 0 0 999px",
                          }}
                        />

                        {/* Vertical reorder handle */}
                        <div
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setVertDrag({ memberName: member.name, taskId: bar.task.id, fromIdx: barIdx });
                            vertDropIdxRef.current = { memberName: member.name, idx: barIdx };
                            setVertDropIdx({ memberName: member.name, idx: barIdx });
                          }}
                          title="Arrastar para reordenar"
                          style={{
                            position: "absolute",
                            left: 10, top: 0, bottom: 0, width: 14,
                            cursor: "ns-resize",
                            zIndex: 5,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: 2.5, pointerEvents: "none" }}>
                            {[0,1,2].map(i => (
                              <div key={i} style={{ width: 8, height: 1.5, background: "rgba(255,255,255,0.5)", borderRadius: 1 }} />
                            ))}
                          </div>
                        </div>

                        {/* Main bar link */}
                        <a
                          href={`${JIRA}/${bar.task.key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={titleTip}
                          onClick={(e) => { if (dragState || vertDrag) e.preventDefault(); }}
                          style={{
                            position: "absolute",
                            left: 0, right: 0, top: 0, bottom: 0,
                            background: barBg,
                            color: textColor,
                            borderRadius: 999,
                            padding: "0 22px 0 28px",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 11,
                            fontWeight: bar.isDone ? 400 : 600,
                            opacity: bar.isDone ? 0.7 : 1,
                            textDecoration: "none",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            boxShadow: isBeingDragged
                              ? "0 4px 16px rgba(0,0,0,0.18)"
                              : "0 1px 2px rgba(0,0,0,0.06)",
                            borderLeft: bar.startsBefore ? "3px solid rgba(255,255,255,0.6)" : "none",
                            transition: isBeingDragged ? "none" : "box-shadow 0.15s",
                            userSelect: "none",
                          }}
                        >
                          {bar.startsBefore && <span style={{ opacity: 0.85, fontSize: 10 }}>←</span>}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                            {barLabel}
                          </span>
                        </a>

                        {/* Right resize handle */}
                        <div
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragState({ key: bar.task.id, handle: "right", startX: e.clientX, initialCol: bar.endCol });
                          }}
                          title="Arrastar para mudar prazo"
                          style={{
                            position: "absolute",
                            right: 0, top: 0, bottom: 0,
                            width: 10,
                            cursor: "ew-resize",
                            zIndex: 5,
                            borderRadius: "0 999px 999px 0",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <div style={{ width: 2, height: 10, background: "rgba(255,255,255,0.55)", borderRadius: 2 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

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

  const thisWeek = items.filter((i) => new Date(i.createdAt) >= monday);
  const assigned = thisWeek.filter((i) => i.assignee);
  const unassigned = thisWeek.filter((i) => !i.assignee);

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
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#6b7280" }}>
          <span>✅ {assigned.length} atribuídas</span>
          <span>⏳ {unassigned.length} sem responsável</span>
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
                  {relativeDay(item.createdAt)}
                </span>

                {/* Hours estimate */}
                <span style={{ fontSize: 10, color: "#c4b5fd", flexShrink: 0 }}>
                  {fmtH(item.estimatedHours)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

