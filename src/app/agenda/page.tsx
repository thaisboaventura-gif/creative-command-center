"use client";

import { useEffect, useRef, useState } from "react";

/* ── Interfaces ── */

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

interface MemberItem {
  name: string;
  avatar: string;
  totalHours: number;
  tasks: TaskItem[];
}

const JIRA = "https://tiendanube.atlassian.net/browse";

/* ── Team config ── */

const TEAM: Record<string, { role: string; area: string; dailyH: number; hasFreela: boolean }> = {
  eduardo:    { role: "Design + Motion",   area: "design",  dailyH: 6.5,  hasFreela: false },
  gasparetto: { role: "Design (EnP)",      area: "design",  dailyH: 6.5,  hasFreela: false },
  gabriel:    { role: "Design",            area: "design",  dailyH: 6.5,  hasFreela: false },
  joao:       { role: "Sinalização",       area: "design",  dailyH: 6.5,  hasFreela: false },
  beatriz:    { role: "Copy",              area: "copy",    dailyH: 6.5,  hasFreela: false },
  larissa:    { role: "Motion & Vídeo",    area: "motion",  dailyH: 10.5, hasFreela: true  },
  francisco:  { role: "Audiovisual",       area: "motion",  dailyH: 6.5,  hasFreela: false },
  rafa:       { role: "Overflow (Monstra)", area: "design", dailyH: 8,    hasFreela: false },
};

const MEMBER_ORDER = ["eduardo", "gasparetto", "gabriel", "joao", "beatriz", "larissa", "francisco", "rafa"];

function getConfig(name: string) {
  const key = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(" ")[0].split(".")[0];
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

function getTwoWeekDays(offset: number): Date[] {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  mon.setHours(0, 0, 0, 0);
  return Array.from({ length: 10 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i + (i >= 5 ? 2 : 0));
    return d;
  });
}

function dayLabel(d: Date): string {
  return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d.getDay()];
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ── Gantt bars ── */

interface Bar {
  task: TaskItem;
  startCol: number;
  endCol: number;
  lane: number;
  startsBefore: boolean;
  overdue: boolean;
  isDone: boolean;
  project: string;
  color: string;
}

const PALETTE: { bg: string; text: string; subtleText: string; border: string }[] = [
  { bg: "#80B0E8", text: "#1a3a5c", subtleText: "#1a3a5c", border: "#5a8fc7" },
  { bg: "#008471", text: "#ffffff", subtleText: "#005a4d", border: "#006057" },
  { bg: "#D1CAEA", text: "#3b2d6e", subtleText: "#3b2d6e", border: "#9b90c9" },
  { bg: "#F4D242", text: "#5c3d00", subtleText: "#5c3d00", border: "#c9a800" },
  { bg: "#C45F3F", text: "#ffffff", subtleText: "#7a2e10", border: "#9a3e22" },
  { bg: "#898E46", text: "#ffffff", subtleText: "#3a3d10", border: "#5f6230" },
  { bg: "#FFC0C0", text: "#7a1c1c", subtleText: "#7a1c1c", border: "#e07070" },
  { bg: "#F29CC3", text: "#6b0a3a", subtleText: "#6b0a3a", border: "#c9609a" },
];

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${alpha})`;
}

function projectColor(project: string): string {
  let hash = 0;
  for (let i = 0; i < project.length; i++) hash = (hash * 31 + project.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length].bg;
}

function extractProject(title: string): string {
  const pipe = title.split("|")[0];
  const dash = pipe.split(" — ")[0];
  const cleaned = dash.trim();
  if (cleaned.length <= 30) return cleaned;
  return cleaned.split(" ").slice(0, 3).join(" ");
}

function layoutBars(tasks: TaskItem[], days: Date[], startOverrides: Record<string, number> = {}): Bar[] {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const nowMs = now.getTime();
  const firstDay = new Date(days[0]); firstDay.setHours(0, 0, 0, 0);
  const lastDay = new Date(days[days.length - 1]); lastDay.setHours(0, 0, 0, 0);

  const candidates = tasks
    .filter((t) => {
      if (!t.dueDate) return false;
      const due = new Date(t.dueDate); due.setHours(0, 0, 0, 0);
      if (t.status === "done") return due.getTime() < nowMs;
      return true;
    })
    .map((task) => {
      const due = parseLocalDate(task.dueDate!);
      const created = parseLocalDate(task.createdAt);
      if (due.getTime() < firstDay.getTime()) return null;
      if (created.getTime() > lastDay.getTime()) return null;

      let startCol = -1;
      let startsBefore = false;
      const overrideCol = startOverrides[task.id];
      if (overrideCol !== undefined) {
        startCol = overrideCol - 1;
        startsBefore = false;
      } else if (created.getTime() < firstDay.getTime()) {
        startsBefore = true;
        startCol = 0;
      } else {
        for (let i = 0; i < days.length; i++) {
          const di = new Date(days[i]); di.setHours(0, 0, 0, 0);
          if (di.getTime() >= created.getTime()) { startCol = i; break; }
        }
        if (startCol === -1) return null;
      }

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
      return { task, startCol: startCol + 1, endCol: endCol + 1, lane: 0, startsBefore, overdue, isDone, project, color: projectColor(project) } as Bar;
    })
    .filter((x): x is Bar => x !== null);

  candidates.forEach((b, i) => { b.lane = i; });
  return candidates;
}

function statusChipProps(status: string, isOverdue: boolean): { label: string; bg: string; color: string } {
  if (isOverdue) return { label: "⚠️ Em atraso", bg: "#fee2e2", color: "#991b1b" };
  const map: Record<string, { label: string; bg: string; color: string }> = {
    done:        { label: "✅ Entregue",       bg: "#f3f4f6", color: "#6b7280" },
    in_review:   { label: "⏳ Entr. p/ feedb.", bg: "#fff7ed", color: "#c2410c" },
    in_progress: { label: "🔵 Em andamento",   bg: "#eff6ff", color: "#1d4ed8" },
    to_do:       { label: "⚪ A fazer",         bg: "#f9fafb", color: "#9ca3af" },
  };
  return map[status] ?? map.to_do;
}

const AREA_COLORS: Record<string, string> = { design: "#7c3aed", copy: "#2563eb", motion: "#ea580c" };

const LABEL_W_DEFAULT = 200;
const LABEL_W_KEY = "agenda_label_w_v1";

/* ── Component ── */

export default function AgendaPage() {
  const [team, setTeam] = useState<MemberItem[]>([]);
  const [src, setSrc] = useState<"loading" | "ok" | "err">("loading");
  const [page, setPage] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  const [startOverrides, setStartOverrides] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [taskOrders, setTaskOrders] = useState<Record<string, string[]>>({});
  const [vertDrag, setVertDrag] = useState<{ memberName: string; taskId: string; fromIdx: number } | null>(null);
  const [vertDropIdx, setVertDropIdx] = useState<{ memberName: string; idx: number } | null>(null);
  const vertDropIdxRef = useRef<{ memberName: string; idx: number } | null>(null);
  const memberSectionRef = useRef<HTMLDivElement | null>(null);

  const [dragState, setDragState] = useState<{ key: string; handle: "left" | "right"; startX: number; initialCol: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ key: string; col: number } | null>(null);
  const dragPreviewRef = useRef<{ key: string; col: number } | null>(null);
  const [pendingModal, setPendingModal] = useState<{ key: string; title: string; newDate: string; prevDate: string | null } | null>(null);

  const ganttHeaderRef = useRef<HTMLDivElement | null>(null);
  const ganttBodyRef = useRef<HTMLDivElement | null>(null);
  const [labelWidth, setLabelWidth] = useState(LABEL_W_DEFAULT);
  const [isResizingLabel, setIsResizingLabel] = useState(false);
  const labelResizeRef = useRef<{ startX: number; startW: number } | null>(null);

  type UndoAction = { type: "start"; key: string; prevCol: number | undefined } | { type: "deadline"; key: string; prevDate: string | null };
  const undoStackRef = useRef<UndoAction[]>([]);

  const days = getTwoWeekDays(page);
  const daysRef = useRef(days);
  daysRef.current = days;
  const labelWidthRef = useRef(labelWidth);
  labelWidthRef.current = labelWidth;

  function loadJira(refresh = false) {
    if (refresh) setIsRefreshing(true);
    fetch("/api/jira")
      .then((r) => r.json())
      .then((d) => {
        if (d.team?.length) {
          setTeam(d.team);
          setSrc("ok");
          if (!selectedMember) {
            const sorted = sortTeam(d.team);
            if (sorted[0]) setSelectedMember(sorted[0].name);
          }
        } else setSrc("err");
      })
      .catch(() => setSrc("err"))
      .finally(() => setIsRefreshing(false));
  }

  useEffect(() => { loadJira(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    const orders: Record<string, string[]> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("gantt_order_")) {
        try { orders[k.slice("gantt_order_".length)] = JSON.parse(localStorage.getItem(k)!); } catch {}
      }
    }
    if (Object.keys(orders).length > 0) setTaskOrders(orders);

    try {
      const raw = localStorage.getItem("agenda_collapsed_v1");
      if (raw) setCollapsed(new Set(JSON.parse(raw)));
    } catch {}

    const savedW = parseInt(localStorage.getItem(LABEL_W_KEY) ?? "");
    if (!isNaN(savedW) && savedW >= 120) setLabelWidth(savedW);
  }, []);

  // Label resize
  useEffect(() => {
    if (!isResizingLabel) return;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMouseMove = (e: MouseEvent) => {
      if (!labelResizeRef.current) return;
      const delta = e.clientX - labelResizeRef.current.startX;
      setLabelWidth(Math.max(120, Math.min(480, labelResizeRef.current.startW + delta)));
    };
    const onMouseUp = () => {
      setIsResizingLabel(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setLabelWidth((w) => { localStorage.setItem(LABEL_W_KEY, String(w)); return w; });
      labelResizeRef.current = null;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); document.body.style.userSelect = ""; document.body.style.cursor = ""; };
  }, [isResizingLabel]);

  // Horizontal drag (resize bars)
  useEffect(() => {
    if (!dragState) return;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    const onMouseMove = (e: MouseEvent) => {
      const bodyWidth = ganttBodyRef.current?.offsetWidth ?? 800;
      const colWidth = (bodyWidth - labelWidthRef.current) / daysRef.current.length;
      const deltaCols = Math.round((e.clientX - dragState.startX) / colWidth);
      let newCol = Math.max(1, Math.min(daysRef.current.length, dragState.initialCol + deltaCols));
      const dp = { key: dragState.key, col: newCol };
      dragPreviewRef.current = dp;
      setDragPreview(dp);
    };
    const onMouseUp = () => {
      const dp = dragPreviewRef.current;
      if (dp) {
        if (dragState.handle === "left") {
          setStartOverrides((prev) => {
            undoStackRef.current = [...undoStackRef.current, { type: "start", key: dragState.key, prevCol: prev[dragState.key] }];
            const next = { ...prev, [dragState.key]: dp.col };
            localStorage.setItem(`gantt_start_${dragState.key}`, String(dp.col));
            return next;
          });
        } else {
          const day = days[dp.col - 1];
          if (day) {
            const dateStr = formatLocalDate(day);
            const allTasks = team.flatMap((m) => m.tasks);
            const task = allTasks.find((t) => t.id === dragState.key);
            setPendingModal({ key: dragState.key, title: task?.title ?? dragState.key, newDate: dateStr, prevDate: task?.dueDate ?? null });
          }
        }
      }
      dragPreviewRef.current = null;
      setDragState(null);
      setDragPreview(null);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
  }, [dragState, days, team]);

  // Vertical drag (reorder)
  useEffect(() => {
    if (!vertDrag) return;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    const onMouseMove = (e: MouseEvent) => {
      const el = memberSectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const idx = Math.max(0, Math.round((e.clientY - rect.top) / 32));
      const dp = { memberName: vertDrag.memberName, idx };
      vertDropIdxRef.current = dp;
      setVertDropIdx(dp);
    };
    const onMouseUp = () => {
      const drop = vertDropIdxRef.current;
      const drag = vertDrag;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setVertDrag(null);
      setVertDropIdx(null);
      vertDropIdxRef.current = null;
      if (!drop || !selectedMember) return;
      const member = team.find(m => m.name === selectedMember);
      if (!member) return;
      const taskMap = new Map(member.tasks.map(t => [t.key, t]));
      const parents = member.tasks.filter(t => !t.parentKey || !taskMap.has(t.parentKey)).filter(t => t.status !== "done");
      const ids = parents.map(t => t.id);
      const toIdx = Math.min(ids.length, drop.idx);
      if (toIdx === drag.fromIdx || toIdx === drag.fromIdx + 1) return;
      const moved = ids.splice(drag.fromIdx, 1)[0];
      ids.splice(toIdx > drag.fromIdx ? toIdx - 1 : toIdx, 0, moved);
      setTaskOrders(prev => {
        const next = { ...prev, [drag.memberName]: ids };
        localStorage.setItem(`gantt_order_${drag.memberName}`, JSON.stringify(ids));
        return next;
      });
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
  }, [vertDrag, team, selectedMember]);

  // Undo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const stack = undoStackRef.current;
        if (!stack.length) return;
        const last = stack[stack.length - 1];
        undoStackRef.current = stack.slice(0, -1);
        if (last.type === "start") {
          setStartOverrides((prev) => {
            const next = { ...prev };
            if (last.prevCol === undefined) { delete next[last.key]; localStorage.removeItem(`gantt_start_${last.key}`); }
            else { next[last.key] = last.prevCol; localStorage.setItem(`gantt_start_${last.key}`, String(last.prevCol)); }
            return next;
          });
        } else if (last.type === "deadline" && last.prevDate) {
          fetch("/api/jira/update-deadline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueKey: last.key, newDate: last.prevDate }) })
            .then(r => { if (r.ok) loadJira(); }); // eslint-disable-line react-hooks/exhaustive-deps
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmDeadline() {
    if (!pendingModal) return;
    const { key, newDate, prevDate } = pendingModal;
    undoStackRef.current = [...undoStackRef.current, { type: "deadline", key, prevDate }];
    setTeam(prev => prev.map(m => ({ ...m, tasks: m.tasks.map(t => t.key === key ? { ...t, dueDate: newDate } : t) })));
    setPendingModal(null);
    const res = await fetch("/api/jira/update-deadline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueKey: key, newDate }) });
    if (!res.ok) {
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      setTeam(prev => prev.map(m => ({ ...m, tasks: m.tasks.map(t => t.key === key ? { ...t, dueDate: prevDate } : t) })));
      const data = await res.json().catch(() => ({ error: "Erro desconhecido" }));
      alert(`Erro ao atualizar prazo: ${data.error}`);
    }
  }

  function toggleCollapsed(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem("agenda_collapsed_v1", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  function sortTeam(t: MemberItem[]) {
    return [...t].sort((a, b) => {
      const ka = firstName(a.name).toLowerCase();
      const kb = firstName(b.name).toLowerCase();
      const ia = MEMBER_ORDER.indexOf(ka);
      const ib = MEMBER_ORDER.indexOf(kb);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }

  const today = new Date();
  const todayMidnight = new Date(today); todayMidnight.setHours(0, 0, 0, 0);
  const GRID_COLS = `${labelWidth}px repeat(${days.length}, 1fr)`;

  const sorted = sortTeam(team);
  const member = sorted.find(m => m.name === selectedMember) ?? sorted[0] ?? null;

  if (src === "loading") return <Shell><p style={{ color: "#9ca3af", textAlign: "center", padding: 80 }}>Conectando ao Jira...</p></Shell>;
  if (src === "err") return <Shell><p style={{ color: "#dc2626", textAlign: "center", padding: 80 }}>Erro ao conectar. Recarregue.</p></Shell>;

  // Build member row data
  const cfg = member ? getConfig(member.name) : null;
  const areaC = cfg ? (AREA_COLORS[cfg.area] || "#6b7280") : "#6b7280";

  const taskMap = member ? new Map(member.tasks.map(t => [t.key, t])) : new Map<string, TaskItem>();
  const parentTasks = member ? member.tasks.filter(t => !t.parentKey || !taskMap.has(t.parentKey)) : [];
  const childMap = new Map<string, TaskItem[]>();
  if (member) {
    member.tasks.filter(t => t.parentKey && taskMap.has(t.parentKey)).forEach(t => {
      const arr = childMap.get(t.parentKey!) ?? [];
      arr.push(t);
      childMap.set(t.parentKey!, arr);
    });
  }

  function effectiveDue(t: TaskItem): Date | null {
    const subs = childMap.get(t.key) ?? [];
    const dates: Date[] = [];
    if (t.dueDate) dates.push(parseLocalDate(t.dueDate));
    subs.forEach(s => { if (s.dueDate) dates.push(parseLocalDate(s.dueDate)); });
    if (!dates.length) return null;
    return dates.reduce((a, b) => b > a ? b : a);
  }

  const activeParents = parentTasks.filter(t => t.status !== "done");
  const sortedByDeadline = [...activeParents].sort((a, b) => (effectiveDue(a)?.getTime() ?? Infinity) - (effectiveDue(b)?.getTime() ?? Infinity));
  const customOrder = member ? (taskOrders[member.name] ?? []) : [];
  const orderedParents = customOrder.length > 0
    ? [...customOrder.map(id => sortedByDeadline.find(t => t.id === id)).filter(Boolean) as TaskItem[], ...sortedByDeadline.filter(t => !customOrder.includes(t.id))]
    : sortedByDeadline;

  const backlog = member ? member.tasks.filter(t => !t.dueDate && t.status !== "done").length : 0;

  return (
    <Shell>
      {/* Deadline modal */}
      {pendingModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 14, padding: "28px 32px", maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 6 }}>Alterar prazo</div>
            <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, marginBottom: 4, background: "#ede9fe", display: "inline-block", padding: "2px 8px", borderRadius: 6 }}>{pendingModal.key}</div>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 16, marginTop: 6, lineHeight: 1.4 }}>{pendingModal.title.slice(0, 80)}{pendingModal.title.length > 80 ? "…" : ""}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Novo prazo:</span>
              <input type="date" value={pendingModal.newDate} onChange={(e) => setPendingModal(prev => prev ? { ...prev, newDate: e.target.value } : null)}
                style={{ fontSize: 13, fontWeight: 600, color: "#111", background: "#f3f4f6", padding: "6px 12px", borderRadius: 8, border: "1px solid #e5e7eb", cursor: "pointer", outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setPendingModal(null)} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 13, cursor: "pointer", color: "#374151" }}>Cancelar</button>
              <button onClick={confirmDeadline} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#7c3aed", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Confirmar →</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#111", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: "#d1fae5", color: "#059669", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>📅</span>
          Agenda
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <a href="/" style={{ background: "white", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, textDecoration: "none", display: "inline-block" }}>← Command Center</a>
          <Btn onClick={() => loadJira(true)} disabled={isRefreshing}>{isRefreshing ? "↻ Atualizando…" : "↻ Atualizar"}</Btn>
          <Btn onClick={() => setPage((p) => p - 1)}>← 1 sem</Btn>
          <Btn onClick={() => setPage((p) => p + 1)}>1 sem →</Btn>
          {page !== 0 && <Btn onClick={() => setPage(0)}>Hoje</Btn>}
        </div>
      </div>

      {/* Member selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {sorted.map((m) => {
          const c = getConfig(m.name);
          const ac = AREA_COLORS[c.area] || "#6b7280";
          const isSelected = m.name === (member?.name ?? "");
          return (
            <button
              key={m.name}
              onClick={() => setSelectedMember(m.name)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 20, cursor: "pointer",
                fontSize: 12, fontWeight: 600,
                border: isSelected ? `2px solid ${ac}` : "2px solid transparent",
                background: isSelected ? hexToRgba(ac, 0.12) : "#f3f4f6",
                color: isSelected ? ac : "#6b7280",
                transition: "all 0.15s",
              }}
            >
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: isSelected ? ac : "#d1d5db", color: "white", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700 }}>
                {m.avatar}
              </span>
              {firstName(m.name)}
            </button>
          );
        })}
      </div>

      {/* Gantt */}
      {member && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #eef0f3" }}>

          {/* Sticky header */}
          <div style={{ position: "sticky", top: 0, zIndex: 10, overflow: "hidden", background: "white", borderBottom: "1px solid #eef0f3" }}>
            <div ref={ganttHeaderRef} onScroll={(e) => { if (ganttBodyRef.current) ganttBodyRef.current.scrollLeft = e.currentTarget.scrollLeft; }} style={{ overflowX: "auto", paddingBottom: 20, marginBottom: -20 }}>
              <div style={{ minWidth: 680 }}>
                <div style={{ display: "grid", gridTemplateColumns: GRID_COLS }}>
                  <div style={{ padding: "14px 16px", fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, position: "relative" }}>
                    {firstName(member.name)}
                    <div onMouseDown={(e) => { e.preventDefault(); labelResizeRef.current = { startX: e.clientX, startW: labelWidth }; setIsResizingLabel(true); }}
                      title="Arrastar para redimensionar" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ width: 3, height: 18, background: isResizingLabel ? "#7c3aed" : "#e5e7eb", borderRadius: 2 }} />
                    </div>
                  </div>
                  {days.map((d, i) => {
                    const isT = sameDay(d, today);
                    return (
                      <div key={i} style={{ padding: "8px 2px", textAlign: "center", borderRight: isT ? "1px solid #c4b5fd" : (!isT && i < days.length - 1 && days[i + 1].getDay() === 1) ? "2px solid #9ca3af" : i < days.length - 1 ? "1px solid #eef0f3" : "none", background: isT ? "#f5f3ff" : "transparent" }}>
                        <div style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.3 }}>{dayLabel(d)}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: isT ? "white" : "#111", marginTop: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, borderRadius: "50%", background: isT ? "#5b6cff" : "transparent" }}>
                          {d.getDate()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Body */}
          <div ref={ganttBodyRef} onScroll={(e) => { if (ganttHeaderRef.current) ganttHeaderRef.current.scrollLeft = e.currentTarget.scrollLeft; }} style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 680 }}>

              {/* Person header row */}
              <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, borderBottom: "2px solid #e5e7eb", background: "#f9fafb", minHeight: 40 }}>
                <div style={{ padding: "6px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: areaC, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{member.avatar}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{firstName(member.name)}</div>
                    <div style={{ fontSize: 10, color: "#9ca3af" }}>{cfg?.role}</div>
                    {backlog > 0 && <div style={{ fontSize: 9, color: "#d1d5db" }}>+{backlog} sem prazo</div>}
                  </div>
                </div>
                {days.map((d, i) => {
                  const isT = sameDay(d, today);
                  return <div key={i} style={{ borderRight: isT ? "1px solid #c4b5fd" : (i < days.length - 1 && days[i + 1].getDay() === 1) ? "2px solid #9ca3af" : i === days.length - 1 ? "none" : "1px dashed #e5e7eb", background: isT ? "#f0edff" : "transparent" }} />;
                })}
              </div>

              {/* Task rows */}
              <div ref={memberSectionRef} style={{ position: "relative" }}>
                {orderedParents.map((parent, pIdx) => {
                  const ct = PALETTE[pIdx % PALETTE.length];
                  const parentBars = layoutBars([parent], days, startOverrides);
                  const parentBar = parentBars[0] ?? null;
                  const children = childMap.get(parent.key) ?? [];
                  const isCollapsed = collapsed.has(parent.key);

                  let parentStartIdx = parentBar ? parentBar.startCol - 1 : -1;
                  let parentEndIdx   = parentBar ? parentBar.endCol - 1 : -1;
                  const isBeingDraggedParent = dragPreview?.key === parent.id;
                  if (isBeingDraggedParent && dragState?.handle === "left") parentStartIdx = Math.min(dragPreview!.col, parentBar!.endCol) - 1;
                  if (isBeingDraggedParent && dragState?.handle === "right") parentEndIdx = Math.max(dragPreview!.col, parentBar!.startCol) - 1;

                  const allSubsDone = children.length > 0 && children.every(c => c.status === "done");
                  const allDoneColIdx: number | null = (() => {
                    if (!allSubsDone) return null;
                    let latest: Date | null = null;
                    for (const c of children) {
                      if (!c.dueDate) continue;
                      const d = parseLocalDate(c.dueDate); d.setHours(0, 0, 0, 0);
                      if (!latest || d > latest) latest = d;
                    }
                    if (!latest) return null;
                    for (let j = 0; j < days.length; j++) {
                      const dj = new Date(days[j]); dj.setHours(0, 0, 0, 0);
                      if (dj.getTime() === latest.getTime()) return j;
                    }
                    return null;
                  })();

                  const isVertDraggingThis = vertDrag?.taskId === parent.id;
                  const showDropBefore = vertDropIdx?.memberName === member.name && vertDropIdx.idx === pIdx;
                  const showDropAfter  = vertDropIdx?.memberName === member.name && vertDropIdx.idx === pIdx + 1 && pIdx === orderedParents.length - 1;

                  return (
                    <div key={parent.key}>
                      {showDropBefore && <div style={{ height: 2, background: "#7c3aed", borderRadius: 1 }} />}

                      {/* Parent row */}
                      <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, borderBottom: "1px solid #e9ecef", minHeight: 32, background: hexToRgba(ct.bg, 0.15), opacity: isVertDraggingThis ? 0.35 : 1 }}>
                        <div style={{ padding: "0 6px 0 8px", borderLeft: `4px solid ${ct.bg}`, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                          <div onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setVertDrag({ memberName: member.name, taskId: parent.id, fromIdx: pIdx }); vertDropIdxRef.current = { memberName: member.name, idx: pIdx }; setVertDropIdx({ memberName: member.name, idx: pIdx }); }}
                            title="Arrastar para reordenar" style={{ cursor: "ns-resize", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, height: 14, padding: "0 2px" }}>
                            {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 1.5, background: ct.subtleText + "80", borderRadius: 1 }} />)}
                          </div>
                          {children.length > 0 && (
                            <button onClick={() => toggleCollapsed(parent.key)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 8, padding: "1px 2px", flexShrink: 0, lineHeight: 1 }}>
                              {isCollapsed ? "▶" : "▼"}
                            </button>
                          )}
                          <a href={`${JIRA}/${parent.key}`} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 11, fontWeight: 700, color: ct.subtleText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textDecoration: "none", minWidth: 0 }}
                            title={parent.title}>{parent.title}</a>
                          {(() => {
                            const parentDue = parent.dueDate ? parseLocalDate(parent.dueDate) : null;
                            const parentOverdue = parentDue !== null && parentDue < todayMidnight && parent.status !== "done" && parent.status !== "in_review";
                            const chip = statusChipProps(parent.status, parentOverdue);
                            return (
                              <>
                                {!parentBar && parentDue && parentOverdue && <span style={{ fontSize: 9, color: "#991b1b", flexShrink: 0, whiteSpace: "nowrap" }}>📅 {parentDue.getDate()}/{parentDue.getMonth() + 1}</span>}
                                <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 20, background: chip.bg, color: chip.color, whiteSpace: "nowrap", flexShrink: 0 }}>{chip.label}</span>
                              </>
                            );
                          })()}
                        </div>

                        {days.map((d, i) => {
                          const isT = sameDay(d, today);
                          const cellN = i + 1;
                          const dispStart = parentStartIdx + 1;
                          const dispEnd = parentEndIdx + 1;
                          const inParentRange = parentBar && cellN >= dispStart && cellN <= dispEnd;
                          const isDueCell = parentBar && cellN === dispEnd && inParentRange;
                          const isDeadlineCell = isDueCell && !allSubsDone;
                          const isAllDoneCell = allDoneColIdx !== null && i === allDoneColIdx;
                          const isLast = i === days.length - 1;
                          const isWeekEnd = !isLast && days[i + 1].getDay() === 1;
                          const borderRight = isT ? "1px solid #c4b5fd" : isDeadlineCell ? `2px solid ${ct.border}` : isWeekEnd ? "2px solid #9ca3af" : isLast ? "none" : "1px dashed #e5e7eb";

                          return (
                            <div key={i} style={{ position: "relative", borderRight, minHeight: 32, background: isT && !inParentRange ? "#f5f3ff" : "transparent" }}>
                              {inParentRange && (
                                <div onMouseDown={(e) => { if (e.button !== 0 || parentBar.isDone) return; e.preventDefault(); setDragState({ key: parent.id, handle: cellN === dispStart ? "left" : "right", startX: e.clientX, initialCol: cellN === dispStart ? dispStart : dispEnd }); }}
                                  style={{ position: "absolute", top: 4, bottom: 4, left: 0, right: 0, background: ct.bg, borderRadius: (cellN === dispStart && !parentBar.startsBefore) && cellN === dispEnd ? "4px" : (cellN === dispStart && !parentBar.startsBefore) ? "4px 0 0 4px" : cellN === dispEnd ? "0 4px 4px 0" : "0", opacity: parentBar.isDone ? 0.5 : 1, cursor: parentBar.isDone ? "default" : isBeingDraggedParent ? "grabbing" : "grab" }} />
                              )}
                              {isDeadlineCell && parentBar && (
                                <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: 9, fontWeight: 700, color: ct.text, whiteSpace: "nowrap", zIndex: 2, pointerEvents: "none", maxWidth: "calc(100% - 6px)", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {`Deadline · ${parseLocalDate(parent.dueDate!).getDate()}/${parseLocalDate(parent.dueDate!).getMonth() + 1}`}
                                </span>
                              )}
                              {isAllDoneCell && <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 14, zIndex: 2, pointerEvents: "none" }}>✅</span>}
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
                        let subEndIdx   = subBar ? subBar.endCol - 1 : -1;
                        if (isBeingDraggedSub && dragState?.handle === "left") subStartIdx = Math.min(dragPreview!.col, subBar!.endCol) - 1;
                        if (isBeingDraggedSub && dragState?.handle === "right") subEndIdx = Math.max(dragPreview!.col, subBar!.startCol) - 1;
                        const dispSubStart = subStartIdx + 1;
                        const dispSubEnd = subEndIdx + 1;
                        const isWaiting = sub.status === "in_review";
                        const _today2 = new Date(); _today2.setHours(0, 0, 0, 0);
                        const _subDue = sub.dueDate ? parseLocalDate(sub.dueDate) : null;
                        const subIsDueToday = !!_subDue && _subDue.getTime() === _today2.getTime();
                        const subBg = sub.status === "done" ? "#F3F4F6" : isWaiting ? "#D1FAE5" : subBar?.overdue ? "#FEE2E2" : subIsDueToday ? "#FEF3C7" : hexToRgba(ct.bg, 0.22);
                        const subBorder = sub.status === "done" ? "#9CA3AF" : isWaiting ? "#34D399" : subBar?.overdue ? "#EF4444" : subIsDueToday ? "#F59E0B" : ct.border + "80";
                        const subTextColor = sub.status === "done" ? "#6B7280" : isWaiting ? "#065F46" : subBar?.overdue ? "#991B1B" : subIsDueToday ? "#92400E" : ct.subtleText;

                        return (
                          <div key={sub.key} style={{ display: "grid", gridTemplateColumns: GRID_COLS, borderBottom: "1px solid #f0f0f0", minHeight: 28, background: hexToRgba(ct.bg, 0.06) }}>
                            <div style={{ padding: "0 6px 0 20px", display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                              <span style={{ color: "#d1d5db", fontSize: 10, flexShrink: 0 }}>↳</span>
                              <a href={`${JIRA}/${sub.key}`} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 10, fontWeight: 400, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textDecoration: "none", minWidth: 0 }}
                                title={sub.title}>{sub.title}</a>
                              {(() => {
                                const subDue2 = sub.dueDate ? parseLocalDate(sub.dueDate) : null;
                                const subOverdue2 = subDue2 !== null && subDue2 < todayMidnight && sub.status !== "done" && sub.status !== "in_review";
                                const chip = statusChipProps(sub.status, subOverdue2);
                                return (
                                  <>
                                    {!subBar && subDue2 && subOverdue2 && <span style={{ fontSize: 9, color: "#991b1b", flexShrink: 0, whiteSpace: "nowrap" }}>📅 {subDue2.getDate()}/{subDue2.getMonth() + 1}</span>}
                                    <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 20, background: chip.bg, color: chip.color, whiteSpace: "nowrap", flexShrink: 0 }}>{chip.label}</span>
                                  </>
                                );
                              })()}
                            </div>
                            {days.map((d, i) => {
                              const isT = sameDay(d, today);
                              const cellN = i + 1;
                              const inSubRange = subBar && cellN >= dispSubStart && cellN <= dispSubEnd;
                              const isAfterDue = subBar && !inSubRange && cellN > dispSubEnd;
                              const isOverdueDay = !!subBar?.overdue && !sub.status.includes("done") && !isWaiting;
                              const isSubDueCell = subBar && cellN === dispSubEnd && inSubRange;
                              const isLastCell = i === days.length - 1;
                              const showExcl = isAfterDue && isOverdueDay && d <= today;
                              const showWaiting = isSubDueCell && isWaiting;
                              const isSubWeekEnd = !isLastCell && days[i + 1].getDay() === 1;
                              const subCellBorder = isT ? "1px solid #c4b5fd" : isSubDueCell && !isWaiting ? `2px solid ${subBorder}` : isSubWeekEnd ? "2px solid #9ca3af" : isLastCell ? "none" : "1px dashed #e5e7eb";

                              return (
                                <div key={i} style={{ position: "relative", borderRight: subCellBorder, minHeight: 28, background: (subBar?.overdue && !isWaiting && isSubDueCell) ? "#FEE2E2" : isT && !inSubRange ? "#f5f3ff" : "transparent" }}>
                                  {inSubRange && (
                                    <div onMouseDown={(e) => { if (e.button !== 0 || sub.status === "done") return; e.preventDefault(); setDragState({ key: sub.id, handle: cellN === dispSubStart ? "left" : "right", startX: e.clientX, initialCol: cellN === dispSubStart ? dispSubStart : dispSubEnd }); }}
                                      style={{ position: "absolute", top: 3, bottom: 3, left: 0, right: 0, background: subBg, borderLeft: cellN === subBar.startCol ? `3px solid ${subBorder}` : undefined, borderRadius: (cellN === dispSubStart && !subBar.startsBefore) && cellN === dispSubEnd ? "3px" : (cellN === dispSubStart && !subBar.startsBefore) ? "3px 0 0 3px" : cellN === dispSubEnd ? "0 3px 3px 0" : "0", opacity: sub.status === "done" ? 0.7 : 1, cursor: sub.status === "done" ? "default" : isBeingDraggedSub ? "grabbing" : "grab" }} />
                                  )}
                                  {subBar && cellN === subBar.endCol && inSubRange && !isWaiting && (
                                    <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: 9, fontWeight: 700, color: subTextColor, whiteSpace: "nowrap", zIndex: 2, pointerEvents: "none", maxWidth: "calc(100% - 6px)", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {sub.status === "done" ? `✅ · ${parseLocalDate(sub.dueDate!).getDate()}/${parseLocalDate(sub.dueDate!).getMonth() + 1}` : subBar.overdue ? `⚠️ · ${parseLocalDate(sub.dueDate!).getDate()}/${parseLocalDate(sub.dueDate!).getMonth() + 1}` : subIsDueToday ? `📅 · ${parseLocalDate(sub.dueDate!).getDate()}/${parseLocalDate(sub.dueDate!).getMonth() + 1}` : `Deadline · ${parseLocalDate(sub.dueDate!).getDate()}/${parseLocalDate(sub.dueDate!).getMonth() + 1}`}
                                    </span>
                                  )}
                                  {showWaiting && <span title="Entregue · Aguardando feedback" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 11, zIndex: 2, pointerEvents: "none", userSelect: "none" }}>📦⏳</span>}
                                  {showExcl && <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 11, zIndex: 2, pointerEvents: "none", userSelect: "none" }}>❗</span>}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}

                      {showDropAfter && <div style={{ height: 2, background: "#7c3aed", borderRadius: 1 }} />}
                    </div>
                  );
                })}

                {vertDropIdx?.memberName === member.name && vertDropIdx.idx >= orderedParents.length && <div style={{ height: 2, background: "#7c3aed", borderRadius: 1 }} />}
              </div>

            </div>
          </div>
        </div>
      )}

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

function Btn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 10px", cursor: disabled ? "not-allowed" : "pointer", fontSize: 12, color: disabled ? "#9ca3af" : "#374151", opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  );
}
