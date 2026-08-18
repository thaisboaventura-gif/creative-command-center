"use client";

import { useEffect, useRef, useState } from "react";
import type { AgendaTask, AgendaResponse, DaySlot } from "@/lib/agenda";

/* ─── Constants ─── */

const JIRA = "https://tiendanube.atlassian.net/browse";
const PX_PER_HOUR = 22;
const START_H = 9;
const LABEL_COL_W = 44;

const MEMBERS: Array<{ key: string; display: string }> = [
  { key: "eduardo",    display: "Eduardo"    },
  { key: "gasparetto", display: "Gasparetto" },
  { key: "gabriel",    display: "Gabriel"    },
  { key: "larissa",    display: "Larissa"    },
  { key: "francisco",  display: "Francisco"  },
  { key: "joao",       display: "João"       },
  { key: "beatriz",    display: "Beatriz"    },
  { key: "rafa",       display: "Rafa"       },
];

const AREA_COLOR: Record<string, string> = {
  design: "#7c3aed",
  copy:   "#2563eb",
  motion: "#ea580c",
};

/* ─── Types ─── */

type DaySplit = Array<{ date: string; hours: number }>;
type BlockOverride = { date: string; startH: number };

interface ScheduleBlock {
  id: string;
  name: string;
  people: string[];
  date: string | null;
  recurrence: string | null;
  startH: number;
  endH: number;
}

type PositionedTask = {
  key: string; title: string; hours: number; color: string;
  startH: number; splitPct?: number;
};

type ExtDay = DaySlot & { tasksEx: PositionedTask[]; colH: number };

type DragState = {
  key: string; title: string; color: string; hours: number;
  curDate: string; curStartH: number;
};

interface ChatMsg { role: "user" | "assistant"; text: string; }

/* ─── Helpers ─── */

function fmtH(h: number): string {
  if (h === 0) return "0h";
  const f = Math.floor(h);
  const m = Math.round((h - f) * 60);
  return m > 0 ? `${f}h${String(m).padStart(2, "0")}` : `${f}h`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function ddmm(iso: string) {
  const [, mm, dd] = iso.split("-");
  return `${dd}/${mm}`;
}

function hToTime(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}

function timeToH(t: string): number {
  const [hh, mm] = t.split(":").map(Number);
  return hh + (mm ?? 0) / 60;
}

function blockMatchesDate(block: ScheduleBlock, dateStr: string): boolean {
  if (block.date) return block.date === dateStr;
  if (block.recurrence) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const map: Record<string, number> = { monday:1, tuesday:2, wednesday:3, thursday:4, friday:5 };
    return map[block.recurrence] === dow;
  }
  return false;
}

function genId(): string {
  return Math.random().toString(36).substr(2, 9);
}

function loadBlocks(): ScheduleBlock[] {
  try { return JSON.parse(localStorage.getItem("agenda_blocks") ?? "[]"); } catch { return []; }
}

function saveBlocks(blocks: ScheduleBlock[]) {
  localStorage.setItem("agenda_blocks", JSON.stringify(blocks));
}

/* ─── buildEffectiveDays ─── */

function buildEffectiveDays(
  data: AgendaResponse,
  displayTaskKeys: Set<string>,
  customHours: Record<string, number>,
  taskSplits: Record<string, DaySplit>,
  blockOverrides: Record<string, BlockOverride>,
  scheduleBlocks: ScheduleBlock[],
  memberKey: string,
): ExtDay[] {
  const taskMap = new Map(data.tasks.map(t => [t.key, t]));
  const dayStrs = data.days.map(d => d.date);
  const firstDay = dayStrs[0] ?? null;

  const colorMap = new Map<string, string>();
  for (const day of data.days) {
    for (const t of day.tasks) if (!colorMap.has(t.key)) colorMap.set(t.key, t.color);
  }

  const buckets = new Map<string, PositionedTask[]>();
  for (const ds of dayStrs) buckets.set(ds, []);

  for (const taskKey of displayTaskKeys) {
    const task = taskMap.get(taskKey);
    if (!task) continue;
    const effectiveH = customHours[taskKey] ?? task.estimatedH;
    const color = colorMap.get(taskKey) ?? "#80B0E8";

    if (taskSplits[taskKey]) {
      for (const { date, hours } of taskSplits[taskKey]) {
        const b = buckets.get(date);
        if (b) b.push({ key: taskKey, title: task.title, hours, color, startH: -1, splitPct: Math.round((hours / effectiveH) * 100) });
      }
      continue;
    }

    let targetDate: string | null = null;
    if (blockOverrides[taskKey]) {
      const ov = blockOverrides[taskKey].date;
      targetDate = dayStrs.includes(ov) ? ov : null;
    }
    if (!targetDate && task.dueDate) {
      const cands = dayStrs.filter(d => d <= task.dueDate!);
      targetDate = cands.length > 0 ? cands[cands.length - 1] : firstDay;
    }
    if (!targetDate) targetDate = firstDay;

    const b = targetDate ? buckets.get(targetDate) : null;
    if (b) {
      const explicitSH = blockOverrides[taskKey] && dayStrs.includes(blockOverrides[taskKey].date)
        ? blockOverrides[taskKey].startH
        : -1;
      b.push({ key: taskKey, title: task.title, hours: effectiveH, color, startH: explicitSH });
    }
  }

  return data.days.map(daySlot => {
    const allTasks = buckets.get(daySlot.date) ?? [];
    // Separate explicit vs stacked
    const explicit = allTasks.filter(t => t.startH >= START_H).sort((a, b) => a.startH - b.startH);
    const stacked = allTasks.filter(t => t.startH < START_H);
    let accH = START_H;
    for (const t of stacked) { t.startH = accH; accH += t.hours; }

    // Add schedule blocks as fake "tasks" for height calculation
    const relevantBlocks = scheduleBlocks.filter(b => b.people.includes(memberKey) && blockMatchesDate(b, daySlot.date));
    const blockEndH = relevantBlocks.reduce((mx, b) => Math.max(mx, b.endH), START_H);

    const allPositioned = [...stacked, ...explicit];
    const maxTaskEndH = allPositioned.reduce((mx, t) => Math.max(mx, t.startH + t.hours), START_H);
    const maxEndH = Math.max(maxTaskEndH, blockEndH, START_H + daySlot.totalCap + 1);
    const colH = Math.max((daySlot.totalCap + 1) * PX_PER_HOUR, (maxEndH - START_H) * PX_PER_HOUR);

    const usedH = allPositioned.reduce((s, t) => s + t.hours, 0);
    return {
      ...daySlot,
      tasksEx: allPositioned,
      tasks: daySlot.tasks,
      freeH: Math.max(0, daySlot.totalCap - usedH),
      overloaded: usedH > daySlot.totalCap,
      colH,
    };
  });
}

/* ─── Shared button style ─── */

const btnStyle: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 8, border: "1px solid #e5e7eb",
  background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#374151",
};

/* ─── Main Page ─── */

export default function AgendaPage() {
  const [selectedMember, setSelectedMember] = useState("eduardo");
  const [weekOffset, setWeekOffset] = useState(0);
  const [twoWeeks, setTwoWeeks] = useState(false);
  const [data, setData] = useState<AgendaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [customHours, setCustomHours] = useState<Record<string, number>>({});
  const [editHoursTask, setEditHoursTask] = useState<{ key: string; title: string; currentH: number } | null>(null);
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [blockModal, setBlockModal] = useState(false);
  const [newTaskModal, setNewTaskModal] = useState(false);

  const [recordingModal, setRecordingModal] = useState<{ key: string; title: string } | null>(null);
  const [recDate, setRecDate] = useState("");
  const [recTime, setRecTime] = useState("manhã");
  const [recCustom, setRecCustom] = useState("");
  const [recSaving, setRecSaving] = useState(false);

  const [distributeModal, setDistributeModal] = useState<AgendaTask | null>(null);
  const [distributing, setDistributing] = useState(false);

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedH: Record<string, number> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("agenda_custom_h_")) {
        const v = parseFloat(localStorage.getItem(k)!);
        if (!isNaN(v)) savedH[k.replace("agenda_custom_h_", "")] = v;
      }
    }
    setCustomHours(savedH);
    setScheduleBlocks(loadBlocks());
  }, []);

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`/api/agenda?pessoa=${selectedMember}&week=${weekOffset}`)
      .then(r => r.json())
      .then((d: AgendaResponse & { error?: string }) => { if (d.error) setError(d.error); else setData(d); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedMember, weekOffset]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  async function sendChat() {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", text: msg }]);
    setChatLoading(true);
    try {
      const context = data ? `Pessoa: ${data.member.display}\nTasks: ${data.tasks.map(t => `${t.key} ${t.title} (${fmtH(t.estimatedH)}, prazo: ${t.dueDate ?? "sem prazo"})`).join("; ")}` : "Sem dados.";
      const res = await fetch("/api/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "chat", message: msg, context }) });
      const d = await res.json();
      setChatMessages(prev => [...prev, { role: "assistant", text: d.reply ?? d.error ?? "Sem resposta." }]);
    } finally { setChatLoading(false); }
  }

  async function assignTask(issueKey: string, memberKey: string) {
    setDistributing(true);
    await fetch("/api/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assign", issueKey, memberKey }) });
    setDistributing(false); setDistributeModal(null);
    fetch(`/api/agenda?pessoa=${selectedMember}&week=${weekOffset}`).then(r => r.json()).then(setData);
  }

  async function saveRecording() {
    if (!recordingModal || !recDate) return;
    setRecSaving(true);
    const timeStr = recTime === "custom" ? recCustom : recTime;
    await fetch("/api/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "schedule_recording", issueKey: recordingModal.key, date: recDate, time: timeStr }) });
    localStorage.setItem(`agenda_recording_${recordingModal.key}`, JSON.stringify({ date: recDate, time: timeStr }));
    setRecSaving(false); setRecordingModal(null);
  }

  async function createTask(title: string, memberKey: string | null, dueDate: string, hours: number | null) {
    const res = await fetch("/api/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_task", title, memberKey, dueDate: dueDate || undefined, estimatedH: hours ?? undefined }) });
    const d = await res.json();
    if (d.ok) {
      setNewTaskModal(false);
      fetch(`/api/agenda?pessoa=${selectedMember}&week=${weekOffset}`).then(r => r.json()).then(setData);
    }
    return d;
  }

  const weekLabel = (() => {
    const now = new Date();
    const mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
    const fri2 = new Date(mon); fri2.setDate(mon.getDate() + 11);
    return `${mon.getDate()}/${mon.getMonth()+1} — ${fri2.getDate()}/${fri2.getMonth()+1}`;
  })();

  return (
    <div style={{ minHeight: "100vh", background: "#f8f9fb", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif', display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: "white", borderBottom: "1px solid #eef0f3", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/" style={{ fontSize: 12, color: "#9ca3af", textDecoration: "none" }}>← Painel</a>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 22, height: 22, borderRadius: 5, background: "#d1fae5", color: "#059669", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>📅</span>
            Agenda
          </span>
          {/* Action buttons */}
          <button onClick={() => setBlockModal(true)} style={{ ...btnStyle, background: "#f0fdf4", borderColor: "#bbf7d0", color: "#059669" }}>🔒 Bloquear slot</button>
          <button onClick={() => setNewTaskModal(true)} style={{ ...btnStyle, background: "#eff6ff", borderColor: "#bfdbfe", color: "#2563eb" }}>+ Nova task</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setWeekOffset(p => p - 1)} style={btnStyle}>← sem</button>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", minWidth: 100, textAlign: "center" }}>{weekLabel}</span>
          <button onClick={() => setWeekOffset(p => p + 1)} style={btnStyle}>sem →</button>
          {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={btnStyle}>Hoje</button>}
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: 1400, margin: "0 auto", width: "100%", padding: "14px 12px 110px", display: "flex", flexDirection: "column", gap: 14 }}>
        {data?.unassigned && data.unassigned.length > 0 && (
          <UnassignedPanel tasks={data.unassigned} onDistribute={t => setDistributeModal(t)} />
        )}

        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {MEMBERS.map(m => (
            <button key={m.key} onClick={() => setSelectedMember(m.key)} style={{
              padding: "5px 12px", borderRadius: 18, fontSize: 11, fontWeight: 600, cursor: "pointer",
              border: selectedMember === m.key ? "none" : "1px solid #e5e7eb",
              background: selectedMember === m.key ? "#059669" : "white",
              color: selectedMember === m.key ? "white" : "#374151",
            }}>{m.display}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: 50 }}>Conectando ao Jira...</div>
        ) : error ? (
          <div style={{ textAlign: "center", color: "#dc2626", padding: 30 }}>Erro: {error}</div>
        ) : data ? (<>
          <PersonGantt data={data} customHours={customHours} weekOffset={weekOffset} setWeekOffset={setWeekOffset} />
          <WeekCalendar
            data={data}
            customHours={customHours}
            scheduleBlocks={scheduleBlocks}
            twoWeeks={twoWeeks}
            setTwoWeeks={setTwoWeeks}
            weekOffset={weekOffset}
            setWeekOffset={setWeekOffset}
            onEditHours={t => setEditHoursTask(t)}
            onScheduleRecording={t => { setRecordingModal(t); setRecDate(""); setRecTime("manhã"); setRecCustom(""); }}
          />
        </>) : null}
      </div>

      {/* Chat footer */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "white", borderTop: "1px solid #eef0f3", zIndex: 30 }}>
        {chatMessages.length > 0 && (
          <div style={{ maxHeight: 180, overflowY: "auto", padding: "6px 20px", borderBottom: "1px solid #f3f4f6" }}>
            {chatMessages.map((m, i) => (
              <div key={i} style={{ marginBottom: 5, display: "flex", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: m.role === "user" ? "#7c3aed" : "#059669", minWidth: 52, flexShrink: 0 }}>{m.role === "user" ? "Você" : "Claude"}</span>
                <span style={{ fontSize: 11, color: "#374151", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.text}</span>
              </div>
            ))}
            {chatLoading && <div style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>Claude pensando...</div>}
            <div ref={chatEndRef} />
          </div>
        )}
        <div style={{ padding: "8px 16px", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#9ca3af" }}>✦</span>
          <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()} placeholder="Pergunte sobre capacidade ou distribua tasks..."
            style={{ flex: 1, fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 11px", outline: "none", color: "#111" }} />
          <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ background: "#059669", color: "white", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}>
            Enviar
          </button>
        </div>
      </div>

      {/* Modals */}
      {editHoursTask && (
        <EditHoursModal task={editHoursTask}
          onSave={h => { setCustomHours(prev => ({ ...prev, [editHoursTask.key]: h })); localStorage.setItem(`agenda_custom_h_${editHoursTask.key}`, String(h)); setEditHoursTask(null); }}
          onClose={() => setEditHoursTask(null)} />
      )}
      {distributeModal && (
        <DistributeModal task={distributeModal} members={MEMBERS} loading={distributing} onAssign={mk => assignTask(distributeModal.key, mk)} onClose={() => setDistributeModal(null)} />
      )}
      {recordingModal && (
        <RecordingModal title={recordingModal.title} date={recDate} time={recTime} custom={recCustom} saving={recSaving}
          onDateChange={setRecDate} onTimeChange={setRecTime} onCustomChange={setRecCustom}
          onSave={saveRecording} onClose={() => setRecordingModal(null)} />
      )}
      {blockModal && (
        <BlockModal
          days={data?.days ?? []}
          onSave={block => { const updated = [...scheduleBlocks, block]; setScheduleBlocks(updated); saveBlocks(updated); setBlockModal(false); }}
          onClose={() => setBlockModal(false)}
        />
      )}
      {newTaskModal && (
        <NewTaskModal members={MEMBERS} onSave={createTask} onClose={() => setNewTaskModal(false)} />
      )}
    </div>
  );
}

/* ─── Unassigned Panel ─── */

function UnassignedPanel({ tasks, onDistribute }: { tasks: AgendaTask[]; onDistribute: (t: AgendaTask) => void }) {
  return (
    <div style={{ background: "white", borderRadius: 10, border: "1px solid #fde68a", overflow: "hidden" }}>
      <div style={{ padding: "8px 14px", background: "#fffbeb", borderBottom: "1px solid #fde68a", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>⚡ Tasks sem dono</span>
        <span style={{ background: "#fef3c7", color: "#b45309", borderRadius: 99, padding: "0 7px", fontSize: 10, fontWeight: 700 }}>{tasks.length}</span>
      </div>
      {tasks.map((t, i) => (
        <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderBottom: i < tasks.length - 1 ? "1px solid #f9fafb" : "none", flexWrap: "wrap" }}>
          <a href={`${JIRA}/${t.key}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", textDecoration: "none" }}>{t.key}</a>
          <span style={{ fontSize: 11, color: "#111", flex: 1, minWidth: 100 }}>{t.title}</span>
          <span style={{ fontSize: 10, color: "#6b7280" }}>{fmtH(t.estimatedH)}</span>
          {t.dueDate && <span style={{ fontSize: 9, color: "#9ca3af" }}>📅 {ddmm(t.dueDate)}</span>}
          <button onClick={() => onDistribute(t)} style={{ background: "#059669", color: "white", border: "none", borderRadius: 5, padding: "3px 10px", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Distribuir</button>
        </div>
      ))}
    </div>
  );
}

/* ─── Person Gantt ─── */

// ── Palette (same as main page) ──
interface GPaletteEntry { bg: string; text: string; subtleText: string; border: string; }
const GANTT_PALETTE: GPaletteEntry[] = [
  { bg: '#80B0E8', text: '#1a3a5c', subtleText: '#1a3a5c', border: '#5a8fc7' },
  { bg: '#008471', text: '#ffffff', subtleText: '#005a4d', border: '#006057' },
  { bg: '#D1CAEA', text: '#3b2d6e', subtleText: '#3b2d6e', border: '#9b90c9' },
  { bg: '#F4D242', text: '#5c3d00', subtleText: '#5c3d00', border: '#c9a800' },
  { bg: '#C45F3F', text: '#ffffff', subtleText: '#7a2e10', border: '#9a3e22' },
  { bg: '#898E46', text: '#ffffff', subtleText: '#3a3d10', border: '#5f6230' },
  { bg: '#FFC0C0', text: '#7a1c1c', subtleText: '#7a1c1c', border: '#e07070' },
  { bg: '#F29CC3', text: '#6b0a3a', subtleText: '#6b0a3a', border: '#c9609a' },
];
function gHexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${alpha})`;
}
function gStatusChip(status: string, isOverdue: boolean): { label: string; bg: string; color: string } {
  if (isOverdue) return { label: "⚠️ Em atraso", bg: "#fee2e2", color: "#991b1b" };
  const map: Record<string, { label: string; bg: string; color: string }> = {
    done:        { label: "✅ Entregue",        bg: "#f3f4f6", color: "#6b7280" },
    in_review:   { label: "⏳ Entr. p/ feedb.", bg: "#fff7ed", color: "#c2410c" },
    in_progress: { label: "🔵 Em andamento",    bg: "#eff6ff", color: "#1d4ed8" },
    to_do:       { label: "⚪ A fazer",          bg: "#f9fafb", color: "#9ca3af" },
  };
  return map[status] ?? map.to_do;
}

function PersonGantt({ data, customHours, weekOffset, setWeekOffset }: {
  data: AgendaResponse;
  customHours: Record<string, number>;
  weekOffset: number;
  setWeekOffset: (fn: (p: number) => number) => void;
}) {
  const { tasks, days } = data;

  // Build parent→children map
  const childrenByParent = new Map<string, AgendaTask[]>();
  for (const t of tasks) {
    if (t.parentKey) {
      if (!childrenByParent.has(t.parentKey)) childrenByParent.set(t.parentKey, []);
      childrenByParent.get(t.parentKey)!.push(t);
    }
  }

  // Active task keys (appear in at least one day)
  const activeKeys = new Set(days.flatMap(d => d.tasks.map(t => t.key)));

  // Build ordered display rows: parent first, then its active children
  type GanttRow = { task: AgendaTask; isChild: boolean; paletteIdx: number };
  const rows: GanttRow[] = [];
  const seen = new Set<string>();
  let pIdx = 0;

  for (const t of tasks) {
    if (seen.has(t.key) || t.parentKey) continue;
    const hasChildren = childrenByParent.has(t.key);
    const isActive = activeKeys.has(t.key);
    if (!isActive && !hasChildren) continue;
    const pi = pIdx++;
    rows.push({ task: t, isChild: false, paletteIdx: pi });
    seen.add(t.key);
    for (const child of childrenByParent.get(t.key) ?? []) {
      if (seen.has(child.key)) continue;
      rows.push({ task: child, isChild: true, paletteIdx: pi });
      seen.add(child.key);
    }
  }
  // Orphan subtasks → show as parent
  for (const t of tasks) {
    if (seen.has(t.key) || !activeKeys.has(t.key)) continue;
    rows.push({ task: t, isChild: false, paletteIdx: pIdx++ });
    seen.add(t.key);
  }

  const today = todayStr();
  const dayStrs = days.map(d => d.date);

  const [nameColW, setNameColW] = useState(200);
  const resizeDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  function toggleParent(key: string) {
    setCollapsedParents(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    resizeDragRef.current = { startX: e.clientX, startW: nameColW };
    const onMove = (ev: MouseEvent) => {
      if (!resizeDragRef.current) return;
      setNameColW(Math.max(120, Math.min(500, resizeDragRef.current.startW + ev.clientX - resizeDragRef.current.startX)));
    };
    const onUp = () => {
      resizeDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (rows.length === 0) {
    return <div style={{ background: "white", borderRadius: 10, border: "1px solid #eef0f3", padding: "12px 16px", textAlign: "center", color: "#d1d5db", fontSize: 11 }}>Nenhuma task ativa.</div>;
  }

  const visibleRows = rows.filter(r => !r.isChild || !collapsedParents.has(r.task.parentKey!));
  const GRID_COLS = `${nameColW}px repeat(${dayStrs.length}, 1fr)`;

  return (
    <div style={{ background: "white", borderRadius: 10, border: "1px solid #eef0f3", overflow: "hidden", position: "relative" }}>
      {/* Toolbar */}
      <div style={{ padding: "8px 14px", borderBottom: "2px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8, background: "#fafafa" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>Demandas & Prazos</span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>{rows.filter(r => !r.isChild).length} tasks</span>
        <span style={{ fontSize: 9, color: "#d1d5db" }}>{collapsedParents.size > 0 ? `· ${collapsedParents.size} recolhidas` : ""}</span>
        <span style={{ fontSize: 9, color: "#d1d5db" }}>· arraste borda ↔ para expandir</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => setWeekOffset(p => p - 1)} style={btnStyle}>← sem</button>
          {weekOffset !== 0 && <button onClick={() => setWeekOffset(() => 0)} style={btnStyle}>Hoje</button>}
          <button onClick={() => setWeekOffset(p => p + 1)} style={btnStyle}>sem →</button>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: nameColW + dayStrs.length * 38 }}>

          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, background: "#f9fafb", borderBottom: "2px solid #e5e7eb", userSelect: "none" }}>
            <div style={{ position: "relative", padding: "5px 12px", display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", letterSpacing: 0.5, textTransform: "uppercase" }}>Task</span>
              <div onMouseDown={onResizeMouseDown} title="Arraste para expandir"
                style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 12, cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
                <div style={{ display: "flex", gap: 2 }}>
                  <div style={{ width: 2, height: 14, background: "#94a3b8", borderRadius: 1 }} />
                  <div style={{ width: 2, height: 14, background: "#94a3b8", borderRadius: 1 }} />
                </div>
              </div>
            </div>
            {days.map((day, i) => {
              const isToday = day.date === today;
              const isLast = i === days.length - 1;
              const isWeekEnd = !isLast && dayStrs[i + 1] && new Date(dayStrs[i + 1]).getDay() === 1;
              return (
                <div key={day.date} style={{
                  padding: "5px 2px", textAlign: "center", fontSize: 9, lineHeight: 1.3,
                  color: isToday ? "#7c3aed" : "#6b7280",
                  fontWeight: isToday ? 800 : 600,
                  borderRight: isToday ? "1px solid #c4b5fd" : isWeekEnd ? "2px solid #9ca3af" : isLast ? "none" : "1px dashed #e5e7eb",
                  background: isToday ? "#f5f3ff" : "transparent",
                }}>
                  <div>{day.label.split(" ")[0]}</div>
                  <div style={{ fontSize: 8, fontWeight: 400 }}>{day.label.split(" ")[1]}</div>
                </div>
              );
            })}
          </div>

          {/* Task rows */}
          {visibleRows.map(({ task, isChild, paletteIdx }) => {
            const ct = GANTT_PALETTE[paletteIdx % GANTT_PALETTE.length];
            const effectiveH = customHours[task.key] ?? task.estimatedH;
            const isOverdue = task.dueDate ? task.dueDate < today : false;
            const chip = gStatusChip(task.status, isOverdue);
            const dueColIdx = task.dueDate
              ? (() => { const i = dayStrs.findIndex(d => d >= task.dueDate!); return i === -1 ? dayStrs.length - 1 : i; })()
              : -1;
            const estDays = data.member.dailyH > 0 ? Math.max(1, Math.ceil(effectiveH / data.member.dailyH)) : 1;
            const startColIdx = dueColIdx >= 0 ? Math.max(0, dueColIdx - estDays + 1) : -1;
            const isDone = task.status === "done";

            return (
              <div key={task.key} style={{
                display: "grid", gridTemplateColumns: GRID_COLS,
                borderBottom: `1px solid ${isChild ? "#f0f0f0" : "#e9ecef"}`,
                minHeight: isChild ? 28 : 32,
                background: isChild ? gHexToRgba(ct.bg, 0.06) : gHexToRgba(ct.bg, 0.15),
                alignItems: "stretch",
              }}>
                {/* Label cell */}
                <div style={{
                  padding: isChild ? "0 6px 0 20px" : "0 6px 0 8px",
                  display: "flex", alignItems: "center", gap: 4, position: "relative",
                  borderLeft: isChild ? "none" : `4px solid ${ct.bg}`,
                  minWidth: 0,
                }}>
                  {isChild
                    ? <span style={{ color: "#d1d5db", fontSize: 10, flexShrink: 0 }}>↳</span>
                    : childrenByParent.has(task.key) && (
                        <button onClick={() => toggleParent(task.key)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 8, padding: "1px 2px", flexShrink: 0, lineHeight: 1 }}>
                          {collapsedParents.has(task.key) ? "▶" : "▼"}
                        </button>
                      )
                  }
                  <a href={`${JIRA}/${task.key}`} target="_blank" rel="noopener noreferrer"
                    onMouseEnter={e => setTooltip({ text: `${task.key} · ${task.title} · ${fmtH(effectiveH)}${task.dueDate ? ` · 📅 ${ddmm(task.dueDate)}` : ""}`, x: e.clientX, y: e.clientY })}
                    onMouseMove={e => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      fontSize: isChild ? 10 : 11,
                      fontWeight: isChild ? 400 : 700,
                      color: isChild ? "#374151" : ct.subtleText,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      flex: 1, textDecoration: "none", minWidth: 0,
                    }}
                    title={task.title}>
                    {task.title}
                  </a>
                  {/* Past-week deadline label */}
                  {dueColIdx === -1 && task.dueDate && isOverdue && (
                    <span style={{ fontSize: 9, color: "#991b1b", flexShrink: 0, whiteSpace: "nowrap" }}>
                      📅 {ddmm(task.dueDate)}
                    </span>
                  )}
                  <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 20,
                    background: chip.bg, color: chip.color, whiteSpace: "nowrap", flexShrink: 0 }}>
                    {chip.label}
                  </span>
                  <div onMouseDown={onResizeMouseDown}
                    style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 12, cursor: "col-resize", zIndex: 5 }} />
                </div>

                {/* Day cells */}
                {dayStrs.map((dayStr, i) => {
                  const isToday = dayStr === today;
                  const isLast = i === dayStrs.length - 1;
                  const isWeekEnd = !isLast && new Date(dayStrs[i + 1]).getDay() === 1;
                  const inBar = dueColIdx >= 0 && i >= startColIdx && i <= dueColIdx;
                  const isDueCell = i === dueColIdx && !!task.dueDate && inBar;
                  const isStartCell = i === startColIdx;

                  // bar colors — same logic as main page subtasks
                  const barBg = isDone ? "#F3F4F6"
                    : task.status === "in_review" ? "#D1FAE5"
                    : isOverdue ? "#FEE2E2"
                    : gHexToRgba(ct.bg, isChild ? 0.22 : 0.85);
                  const barBorder = isDone ? "#9CA3AF"
                    : task.status === "in_review" ? "#34D399"
                    : isOverdue ? "#EF4444"
                    : ct.border + (isChild ? "80" : "");
                  const barText = isDone ? "#6B7280"
                    : task.status === "in_review" ? "#065F46"
                    : isOverdue ? "#991B1B"
                    : ct.text;

                  const borderRight = isToday ? "1px solid #c4b5fd"
                    : isDueCell && !isDone ? `2px solid ${ct.border}`
                    : isWeekEnd ? "2px solid #9ca3af"
                    : isLast ? "none"
                    : "1px dashed #e5e7eb";

                  return (
                    <div key={dayStr} style={{
                      position: "relative",
                      borderRight,
                      minHeight: isChild ? 28 : 32,
                      background: isToday && !inBar ? "#f5f3ff" : "transparent",
                    }}>
                      {/* Bar */}
                      {inBar && (
                        <div style={{
                          position: "absolute",
                          top: isChild ? 3 : 4, bottom: isChild ? 3 : 4,
                          left: 0, right: 0,
                          background: barBg,
                          borderLeft: isStartCell ? `3px solid ${barBorder}` : undefined,
                          borderRadius: isStartCell && isDueCell ? "3px"
                            : isStartCell ? "3px 0 0 3px"
                            : isDueCell ? "0 3px 3px 0" : "0",
                          opacity: isDone ? 0.7 : 1,
                        }} />
                      )}
                      {/* Deadline label in due-date cell */}
                      {isDueCell && (
                        <span style={{
                          position: "absolute", left: "50%", top: "50%",
                          transform: "translate(-50%, -50%)",
                          fontSize: 9, fontWeight: 700, color: barText,
                          whiteSpace: "nowrap", zIndex: 2, pointerEvents: "none",
                          maxWidth: "calc(100% - 6px)", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {isDone
                            ? `✅ · ${ddmm(task.dueDate!)}`
                            : isOverdue
                              ? `⚠️ · ${ddmm(task.dueDate!)}`
                              : `Deadline · ${ddmm(task.dueDate!)}`}
                        </span>
                      )}
                      {/* Today highlight line */}
                      {isToday && (
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "#7c3aed", opacity: 0.4, zIndex: 3 }} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {tooltip && (
        <div style={{ position: "fixed", left: tooltip.x + 14, top: tooltip.y - 12, background: "#1f2937", color: "white", fontSize: 11, lineHeight: 1.5, padding: "6px 10px", borderRadius: 7, maxWidth: 360, pointerEvents: "none", zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", wordBreak: "break-word" }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

/* ─── Week Calendar ─── */

function WeekCalendar({ data, customHours, scheduleBlocks, twoWeeks, setTwoWeeks, weekOffset, setWeekOffset, onEditHours, onScheduleRecording }: {
  data: AgendaResponse;
  customHours: Record<string, number>;
  scheduleBlocks: ScheduleBlock[];
  twoWeeks: boolean;
  setTwoWeeks: (v: boolean) => void;
  weekOffset: number;
  setWeekOffset: (fn: (p: number) => number) => void;
  onEditHours: (t: { key: string; title: string; currentH: number }) => void;
  onScheduleRecording: (t: { key: string; title: string }) => void;
}) {
  const { member, tasks, days: allDays } = data;
  const areaC = AREA_COLOR[member.area] ?? "#6b7280";

  const parentKeysOfSubtasks = new Set(tasks.filter(t => t.parentKey).map(t => t.parentKey!));
  const displayTaskKeys = new Set(tasks.filter(t => t.parentKey !== null || !parentKeysOfSubtasks.has(t.key)).map(t => t.key));
  const taskMap = new Map(tasks.map(t => [t.key, t]));

  const [taskSplits, setTaskSplits] = useState<Record<string, DaySplit>>({});
  const [blockOverrides, setBlockOverrides] = useState<Record<string, BlockOverride>>({});
  const [splitModal, setSplitModal] = useState<{ key: string; title: string; totalH: number } | null>(null);
  const [freelaKeys, setFreelaKeys] = useState<Set<string>>(new Set());
  const [splitView, setSplitView] = useState(false);

  // Ref-based drag — no stale closures, no listener churn
  const dragStateRef = useRef<DragState | null>(null);
  const [ghostBlock, setGhostBlock] = useState<DragState | null>(null);
  const effectiveDaysRef = useRef<ExtDay[]>([]);
  const blockOverridesRef = useRef<Record<string, BlockOverride>>({});

  const gridBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const splits: Record<string, DaySplit> = {};
    const overrides: Record<string, BlockOverride> = {};
    const fk = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("agenda_split_")) {
        try { splits[k.replace("agenda_split_", "")] = JSON.parse(localStorage.getItem(k)!); } catch { /* skip */ }
      }
      if (k.startsWith("agenda_blkpos_")) {
        try { overrides[k.replace("agenda_blkpos_", "")] = JSON.parse(localStorage.getItem(k)!); } catch { /* skip */ }
      }
      if (k.startsWith(`agenda_freela_${member.key}_`)) {
        fk.add(k.replace(`agenda_freela_${member.key}_`, ""));
      }
    }
    setTaskSplits(splits);
    setBlockOverrides(overrides);
    setFreelaKeys(fk);
    const svStored = localStorage.getItem(`agenda_splitview_${member.key}`);
    setSplitView(svStored === null ? member.key === "larissa" : svStored === "1");
  }, [member.key]);

  function toggleFreela(taskKey: string) {
    setFreelaKeys(prev => {
      const next = new Set(prev);
      if (next.has(taskKey)) {
        next.delete(taskKey);
        localStorage.removeItem(`agenda_freela_${member.key}_${taskKey}`);
      } else {
        next.add(taskKey);
        localStorage.setItem(`agenda_freela_${member.key}_${taskKey}`, "1");
      }
      return next;
    });
  }

  function toggleSplitView() {
    setSplitView(prev => {
      const next = !prev;
      localStorage.setItem(`agenda_splitview_${member.key}`, next ? "1" : "0");
      return next;
    });
  }

  // Limit to 1 or 2 weeks
  const displayDays = twoWeeks ? allDays : allDays.slice(0, 5);

  const effectiveDays = buildEffectiveDays(data, displayTaskKeys, customHours, taskSplits, blockOverrides, scheduleBlocks, member.key)
    .filter(d => displayDays.some(dd => dd.date === d.date));

  // Keep refs current every render — handlers read from refs, never stale
  effectiveDaysRef.current = effectiveDays;
  blockOverridesRef.current = blockOverrides;

  const END_H = Math.max(19, START_H + Math.ceil(member.dailyH) + 1);
  const endHRef = useRef(END_H);
  endHRef.current = END_H;
  const TOTAL_H = END_H - START_H;
  const gridH = TOTAL_H * PX_PER_HOUR;
  const hourLabels = Array.from({ length: TOTAL_H + 1 }, (_, i) => START_H + i);
  const today = todayStr();

  // Set up drag listeners ONCE — reads fresh data via refs
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragStateRef.current || !gridBodyRef.current) return;
      const rect = gridBodyRef.current.getBoundingClientRect();
      const days = effectiveDaysRef.current;
      const numDays = days.length;
      if (numDays === 0) return;
      const colW = (rect.width - LABEL_COL_W) / numDays;
      const xRel = e.clientX - rect.left - LABEL_COL_W;
      const yRel = e.clientY - rect.top;
      const dayIdx = Math.max(0, Math.min(numDays - 1, Math.floor(xRel / colW)));
      const newDate = days[dayIdx]?.date ?? dragStateRef.current.curDate;
      const rawH = START_H + yRel / PX_PER_HOUR;
      const snapped = Math.round(rawH * 2) / 2;
      const clamped = Math.max(START_H, Math.min(endHRef.current - dragStateRef.current.hours, snapped));
      dragStateRef.current = { ...dragStateRef.current, curDate: newDate, curStartH: clamped };
      setGhostBlock({ ...dragStateRef.current });
    }
    function onUp() {
      if (!dragStateRef.current) return;
      const { key, curDate, curStartH } = dragStateRef.current;
      const newOvr = { ...blockOverridesRef.current, [key]: { date: curDate, startH: curStartH } };
      blockOverridesRef.current = newOvr;
      setBlockOverrides(newOvr);
      localStorage.setItem(`agenda_blkpos_${key}`, JSON.stringify({ date: curDate, startH: curStartH }));
      dragStateRef.current = null;
      setGhostBlock(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []); // runs once — fresh data always via refs

  function saveSplit(taskKey: string, splits: DaySplit) {
    const newOvr = { ...blockOverrides }; delete newOvr[taskKey];
    setBlockOverrides(newOvr); localStorage.removeItem(`agenda_blkpos_${taskKey}`);
    const newSplits = { ...taskSplits, [taskKey]: splits };
    setTaskSplits(newSplits); localStorage.setItem(`agenda_split_${taskKey}`, JSON.stringify(splits));
    setSplitModal(null);
  }

  // Max column height across all days
  const maxColH = Math.max(...effectiveDays.map(d => d.colH), gridH);

  return (
    <div style={{ background: "white", borderRadius: 10, border: "1px solid #eef0f3", overflow: "hidden", cursor: ghostBlock ? "grabbing" : "default" }}>
      {/* Member header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: areaC, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          {member.display[0]}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{member.display}</div>
          <div style={{ fontSize: 10, color: "#9ca3af" }}>{member.role} · {fmtH(member.dailyH)}/dia</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => setWeekOffset(p => p - 1)} style={btnStyle}>← sem</button>
          {weekOffset !== 0 && <button onClick={() => setWeekOffset(() => 0)} style={btnStyle}>Hoje</button>}
          <button onClick={() => setWeekOffset(p => p + 1)} style={btnStyle}>sem →</button>
        </div>
      </div>

      {/* Day column headers */}
      <div style={{ display: "grid", gridTemplateColumns: `${LABEL_COL_W}px repeat(${effectiveDays.length}, 1fr)`, borderBottom: "1px solid #f0f0f0" }}>
        <div style={{ borderRight: "1px solid #f0f0f0" }} />
        {effectiveDays.map((day, i) => {
          const usedH = day.totalCap - day.freeH;
          const pct = Math.min(100, (usedH / day.totalCap) * 100);
          const isToday = day.date === today;
          const isWeekBoundary = i === 4 && twoWeeks;
          return (
            <div key={day.date} style={{ borderRight: isWeekBoundary ? "4px solid #374151" : "1px solid #f0f0f0", padding: "6px 3px 4px", textAlign: "center", background: isToday ? "#f0fdf4" : "transparent" }}>
              <div style={{ fontSize: 10, fontWeight: isToday ? 800 : 600, color: isToday ? "#059669" : "#374151" }}>{day.label}</div>
              <div style={{ margin: "4px 6px 0", height: 3, background: "#f3f4f6", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: day.overloaded ? "#f59e0b" : "#059669", borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 8, color: day.overloaded ? "#d97706" : "#9ca3af", marginTop: 2 }}>
                {day.overloaded ? `⚠ +${fmtH(Math.abs(day.freeH))}` : `${fmtH(day.freeH)} livre`}
              </div>
              {splitView && (
                <div style={{ display: "flex", borderTop: "1px solid #f0f0f0", marginTop: 3 }}>
                  <div style={{ flex: 1, fontSize: 7, textAlign: "center", color: "#6b7280", padding: "2px 0", fontWeight: 600 }}>{member.display.split(" ")[0]}</div>
                  <div style={{ flex: 1, fontSize: 7, textAlign: "center", color: "#8b5cf6", padding: "2px 0", borderLeft: "1px dashed #e5e7eb", fontWeight: 600 }}>freela</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div ref={gridBodyRef} style={{ position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: `${LABEL_COL_W}px repeat(${effectiveDays.length}, 1fr)` }}>
          {/* Hour labels — flex column to avoid cutoff */}
          <div style={{ borderRight: "1px solid #f0f0f0", height: maxColH, position: "relative", flexShrink: 0 }}>
            {hourLabels.map(h => (
              <div key={h} style={{ position: "absolute", top: (h - START_H) * PX_PER_HOUR, right: 4, fontSize: 8, color: "#d1d5db", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {String(h).padStart(2,"0")}h
              </div>
            ))}
          </div>

          {/* Day columns */}
          {effectiveDays.map((day, colIdx) => {
            const isToday = day.date === today;
            const isWeekBoundary = colIdx === 4 && twoWeeks;
            const dayBlocks = scheduleBlocks.filter(b => b.people.includes(member.key) && blockMatchesDate(b, day.date));

            return (
              <div key={day.date} style={{
                position: "relative",
                borderRight: isWeekBoundary ? "4px solid #374151" : "1px solid #f0f0f0",
                height: maxColH,
                background: isToday ? "#fafffe" : "transparent",
              }}>
                {/* Hour grid lines */}
                {hourLabels.map(h => (
                  <div key={h} style={{ position: "absolute", top: (h - START_H) * PX_PER_HOUR, left: 0, right: 0, borderTop: h === START_H ? "none" : "1px solid #f5f5f5" }} />
                ))}
                {/* Capacity line */}
                <div style={{ position: "absolute", top: member.dailyH * PX_PER_HOUR, left: 0, right: 0, borderTop: "1px dashed #bbf7d0", zIndex: 2 }} />
                {/* Split view: center divider */}
                {splitView && <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#e5e7eb", zIndex: 1 }} />}

                {/* Schedule blocks (🔒) */}
                {dayBlocks.map(block => {
                  const top = (block.startH - START_H) * PX_PER_HOUR;
                  const height = Math.max((block.endH - block.startH) * PX_PER_HOUR, 18);
                  return (
                    <div key={block.id} style={{ position: "absolute", top: top + 1, height: height - 2, left: 2, right: 2, background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 4, padding: "2px 4px", zIndex: 3, overflow: "hidden", boxSizing: "border-box" }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: "#475569" }}>🔒 {block.name}</div>
                      {height >= 28 && <div style={{ fontSize: 8, color: "#94a3b8" }}>{hToTime(block.startH)}–{hToTime(block.endH)}</div>}
                    </div>
                  );
                })}

                {/* Task blocks */}
                {day.tasksEx.map(t => {
                  const fullTask = taskMap.get(t.key);
                  const isRec = fullTask?.isRecording ?? false;
                  const recStored = (() => { try { const r = localStorage.getItem(`agenda_recording_${t.key}`); return r ? JSON.parse(r) : null; } catch { return null; } })();
                  const isSplit = !!taskSplits[t.key];
                  const isBeingDragged = ghostBlock?.key === t.key;
                  const isFreela = freelaKeys.has(t.key);
                  const top = (t.startH - START_H) * PX_PER_HOUR;
                  const height = Math.max(t.hours * PX_PER_HOUR, 18);
                  const bg = t.color;
                  const blockLeft = splitView ? (isFreela ? "calc(50% + 1px)" : "1px") : "2px";
                  const blockRight = splitView ? "1px" : "2px";
                  const blockWidth = splitView ? "calc(50% - 3px)" : undefined;

                  return (
                    <div
                      key={`${t.key}-${t.startH}`}
                      onMouseDown={e => {
                        if ((e.target as HTMLElement).tagName === "BUTTON" || (e.target as HTMLElement).tagName === "A") return;
                        e.preventDefault();
                        dragStateRef.current = { key: t.key, title: t.title, color: bg, hours: t.hours, curDate: day.date, curStartH: t.startH };
                        setGhostBlock({ ...dragStateRef.current });
                      }}
                      style={{
                        position: "absolute",
                        top: top + 1,
                        height: height - 2,
                        left: blockLeft,
                        ...(blockWidth ? { width: blockWidth } : { right: blockRight }),
                        background: isBeingDragged ? bg + "20" : bg + "18",
                        borderLeft: `3px solid ${bg}`,
                        borderRadius: "0 4px 4px 0",
                        padding: "2px 4px",
                        overflow: "hidden",
                        zIndex: isBeingDragged ? 1 : 3,
                        cursor: isBeingDragged ? "grabbing" : "grab",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        opacity: isBeingDragged ? 0.35 : 1,
                        boxSizing: "border-box",
                        userSelect: "none",
                        transition: "opacity 0.1s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 2, minHeight: 0 }}>
                        <a href={`${JIRA}/${t.key}`} target="_blank" rel="noopener noreferrer"
                          style={{ flex: 1, fontSize: 9, fontWeight: 600, color: "#111", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>
                          {t.title}{isSplit && <span style={{ marginLeft: 3, fontSize: 8, color: bg, opacity: 0.8 }}>↔{t.splitPct}%</span>}
                        </a>
                        {height >= 28 && (
                          <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
                            <button title="Editar horas" onClick={e => { e.stopPropagation(); onEditHours({ key: t.key, title: t.title, currentH: t.hours }); }}
                              style={{ fontSize: 8, color: "#6b7280", background: "transparent", border: "none", cursor: "pointer", padding: "0 1px", lineHeight: 1 }}>✎</button>
                            <button title="Dividir em dias" onClick={e => { e.stopPropagation(); const task = taskMap.get(t.key); if (task) setSplitModal({ key: t.key, title: t.title, totalH: customHours[t.key] ?? task.estimatedH }); }}
                              style={{ fontSize: 8, color: "#059669", background: "transparent", border: "none", cursor: "pointer", padding: "0 1px", lineHeight: 1 }}>⊕</button>
                            {splitView && (
                              <button title={isFreela ? "Mover para demandas próprias" : "Mover para freela"} onClick={e => { e.stopPropagation(); toggleFreela(t.key); }}
                                style={{ fontSize: 8, color: isFreela ? "#8b5cf6" : "#9ca3af", background: "transparent", border: "none", cursor: "pointer", padding: "0 1px", lineHeight: 1, fontWeight: isFreela ? 700 : 400 }}>F</button>
                            )}
                          </div>
                        )}
                      </div>
                      {height >= 26 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 8, color: "#6b7280", fontWeight: 600 }}>{fmtH(t.hours)}</span>
                          {fullTask?.dueDate && <span style={{ fontSize: 8, color: "#9ca3af" }}>📅{ddmm(fullTask.dueDate)}</span>}
                          {isRec && (
                            <button onClick={e => { e.stopPropagation(); onScheduleRecording({ key: t.key, title: t.title }); }}
                              style={{ fontSize: 7, color: recStored ? "#059669" : "#ea580c", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                              📹{recStored ? "✓" : "?"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {day.tasksEx.length === 0 && dayBlocks.length === 0 && (
                  <div style={{ position: "absolute", top: 8, left: 0, right: 0, textAlign: "center", fontSize: 9, color: "#e5e7eb", pointerEvents: "none" }}>livre</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Ghost block — follows mouse during drag */}
        {ghostBlock && (() => {
          const dayIdx = effectiveDays.findIndex(d => d.date === ghostBlock.curDate);
          if (dayIdx < 0) return null;
          const numDays = effectiveDays.length;
          const ghostTop = Math.max(0, (ghostBlock.curStartH - START_H) * PX_PER_HOUR);
          const ghostH = ghostBlock.hours * PX_PER_HOUR;
          return (
            <div style={{
              position: "absolute",
              top: ghostTop + 1,
              height: Math.max(ghostH - 2, 18),
              left: `calc(${LABEL_COL_W}px + ${dayIdx} * ((100% - ${LABEL_COL_W}px) / ${numDays}) + 2px)`,
              width: `calc((100% - ${LABEL_COL_W}px) / ${numDays} - 4px)`,
              background: ghostBlock.color + "45",
              border: `2px dashed ${ghostBlock.color}`,
              borderRadius: 4,
              pointerEvents: "none",
              zIndex: 20,
              display: "flex",
              alignItems: "flex-start",
              padding: "3px 5px",
              overflow: "hidden",
              boxSizing: "border-box",
              boxShadow: `0 4px 16px ${ghostBlock.color}40`,
            }}>
              <span style={{ fontSize: 9, color: "#111", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {hToTime(ghostBlock.curStartH)} — {ghostBlock.title}
              </span>
            </div>
          );
        })()}
      </div>

      {/* Footer */}
      <div style={{ padding: "7px 14px", borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>
          ▸ Ver lista de tasks ({tasks.filter(t => displayTaskKeys.has(t.key)).length}) · registrar horas reais
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => toggleSplitView()}
            style={{ ...btnStyle, fontSize: 10, padding: "3px 10px", color: splitView ? "#8b5cf6" : undefined, borderColor: splitView ? "#8b5cf6" : undefined }}>
            {splitView ? "✦ Split freela" : "Split freela"}
          </button>
          <button
            onClick={() => setTwoWeeks(!twoWeeks)}
            style={{ ...btnStyle, fontSize: 10, padding: "3px 10px" }}>
            {twoWeeks ? "← Ver só semana atual" : "Ver 2 semanas →"}
          </button>
        </div>
      </div>

      {splitModal && (
        <SplitModal task={splitModal} days={effectiveDays} existingSplits={taskSplits[splitModal.key]}
          onSave={splits => saveSplit(splitModal.key, splits)} onClose={() => setSplitModal(null)} />
      )}
    </div>
  );
}

/* ─── Block Modal ─── */

function BlockModal({ days, onSave, onClose }: {
  days: DaySlot[];
  onSave: (block: ScheduleBlock) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [dateType, setDateType] = useState<"specific" | "recurring">("specific");
  const [specificDate, setSpecificDate] = useState("");
  const [recurrence, setRecurrence] = useState("monday");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");

  const BD_ALL = ["eduardo","gasparetto","gabriel","larissa","francisco","joao","beatriz"];

  function togglePerson(key: string) {
    setPeople(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key]);
  }

  function handleSave() {
    if (!name.trim() || people.length === 0) return;
    const startH = timeToH(startTime);
    const endH = timeToH(endTime);
    if (endH <= startH) return;
    onSave({
      id: genId(),
      name: name.trim(),
      people,
      date: dateType === "specific" ? specificDate || null : null,
      recurrence: dateType === "recurring" ? recurrence : null,
      startH,
      endH,
    });
  }

  const firstDate = days[0]?.date ?? "";
  const lastDate = days[days.length - 1]?.date ?? "";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "white", borderRadius: 14, padding: "22px 24px", maxWidth: 460, width: "95%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>🔒 Novo bloqueio de horário</div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 4 }}>Nome</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="ex: Reunião de time"
            style={{ width: "100%", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", boxSizing: "border-box", outline: "none" }} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 6 }}>Quem</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button onClick={() => setPeople([...BD_ALL])} style={{ ...btnStyle, fontSize: 10, padding: "4px 10px", background: people.length === BD_ALL.length ? "#f0fdf4" : "white", borderColor: people.length === BD_ALL.length ? "#059669" : "#e5e7eb", color: people.length === BD_ALL.length ? "#059669" : "#374151" }}>BD Nuvemshop</button>
            <button onClick={() => setPeople([...BD_ALL, "rafa"])} style={{ ...btnStyle, fontSize: 10, padding: "4px 10px" }}>+ Monstra</button>
            <button onClick={() => setPeople([])} style={{ ...btnStyle, fontSize: 10, padding: "4px 10px" }}>Limpar</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {MEMBERS.map(m => (
              <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", padding: "4px 8px", borderRadius: 6, background: people.includes(m.key) ? "#f0fdf4" : "#f9fafb", border: `1px solid ${people.includes(m.key) ? "#bbf7d0" : "#f3f4f6"}` }}>
                <input type="checkbox" checked={people.includes(m.key)} onChange={() => togglePerson(m.key)} style={{ accentColor: "#059669" }} />
                {m.display}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 6 }}>Data</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button onClick={() => setDateType("specific")} style={{ ...btnStyle, fontSize: 10, background: dateType === "specific" ? "#eff6ff" : "white", borderColor: dateType === "specific" ? "#2563eb" : "#e5e7eb", color: dateType === "specific" ? "#2563eb" : "#374151" }}>Data específica</button>
            <button onClick={() => setDateType("recurring")} style={{ ...btnStyle, fontSize: 10, background: dateType === "recurring" ? "#eff6ff" : "white", borderColor: dateType === "recurring" ? "#2563eb" : "#e5e7eb", color: dateType === "recurring" ? "#2563eb" : "#374151" }}>Recorrente</button>
          </div>
          {dateType === "specific" && (
            <input type="date" value={specificDate} min={firstDate} max={lastDate} onChange={e => setSpecificDate(e.target.value)}
              style={{ width: "100%", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", boxSizing: "border-box" }} />
          )}
          {dateType === "recurring" && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {[["monday","Seg"],["tuesday","Ter"],["wednesday","Qua"],["thursday","Qui"],["friday","Sex"]].map(([v,l]) => (
                <button key={v} onClick={() => setRecurrence(v)} style={{ ...btnStyle, fontSize: 11, padding: "5px 12px", background: recurrence === v ? "#eff6ff" : "white", borderColor: recurrence === v ? "#2563eb" : "#e5e7eb", color: recurrence === v ? "#2563eb" : "#374151", fontWeight: recurrence === v ? 700 : 400 }}>{l}</button>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 6 }}>Horário</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              style={{ fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px" }} />
            <span style={{ color: "#9ca3af", fontSize: 12 }}>até</span>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
              style={{ fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px" }} />
            <span style={{ fontSize: 11, color: "#059669", fontWeight: 600 }}>
              {(() => { const h = timeToH(endTime) - timeToH(startTime); return h > 0 ? `-${fmtH(h)}` : ""; })()}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>Cancelar</button>
          <button onClick={handleSave} disabled={!name.trim() || people.length === 0} style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: "#059669", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: !name.trim() || people.length === 0 ? 0.5 : 1 }}>
            Salvar bloqueio →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── New Task Modal ─── */

function NewTaskModal({ members, onSave, onClose }: {
  members: Array<{ key: string; display: string }>;
  onSave: (title: string, memberKey: string | null, dueDate: string, hours: number | null) => Promise<Record<string, unknown>>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [hours, setHours] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; key?: string; error?: string } | null>(null);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    const h = parseFloat(hours);
    const res = await onSave(title.trim(), assignee, dueDate, isNaN(h) ? null : h);
    setResult(res as { ok?: boolean; key?: string; error?: string });
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "white", borderRadius: 14, padding: "22px 24px", maxWidth: 400, width: "95%", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>+ Nova task rápida</div>

        {result?.ok ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#059669", marginBottom: 4 }}>Task criada!</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 16 }}>
              <a href={`${JIRA}/${result.key}`} target="_blank" rel="noopener noreferrer" style={{ color: "#7c3aed" }}>{result.key}</a> no Jira
            </div>
            <button onClick={onClose} style={{ padding: "8px 24px", borderRadius: 8, border: "none", background: "#059669", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Fechar</button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 4 }}>Nome da task</label>
              <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="[D2C] Layout estático - Feed Instagram"
                style={{ width: "100%", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", boxSizing: "border-box", outline: "none" }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 6 }}>Atribuir para</label>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {[{ key: null as string | null, display: "Sem dono" }, ...members].map(m => (
                  <button key={m.key ?? "null"} onClick={() => setAssignee(m.key)}
                    style={{ padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1px solid #e5e7eb", background: assignee === m.key ? "#059669" : "white", color: assignee === m.key ? "white" : "#374151" }}>
                    {m.display}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 4 }}>Prazo</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  style={{ width: "100%", fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 4 }}>Horas estimadas</label>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="number" min="0.5" step="0.5" value={hours} onChange={e => setHours(e.target.value)} placeholder="auto"
                    style={{ flex: 1, fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", boxSizing: "border-box" }} />
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>h</span>
                </div>
                {!hours && title && <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 3 }}>Vai calcular pelo SLA</div>}
              </div>
            </div>

            {result?.error && <div style={{ fontSize: 11, color: "#dc2626", marginBottom: 10, background: "#fef2f2", padding: "6px 10px", borderRadius: 6 }}>Erro: {result.error}</div>}

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>Cancelar</button>
              <button onClick={handleSave} disabled={!title.trim() || saving}
                style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: "#2563eb", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: !title.trim() || saving ? 0.5 : 1 }}>
                {saving ? "Criando…" : "Criar no Jira →"}
              </button>
            </div>
            <div style={{ marginTop: 10, textAlign: "center" }}>
              <a href="/nova-demanda" style={{ fontSize: 10, color: "#9ca3af", textDecoration: "none" }}>Para demandas completas → /nova-demanda</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Split Modal ─── */

function SplitModal({ task, days, existingSplits, onSave, onClose }: {
  task: { key: string; title: string; totalH: number };
  days: ExtDay[];
  existingSplits?: DaySplit;
  onSave: (splits: DaySplit) => void;
  onClose: () => void;
}) {
  const initAllocs: Record<string, string> = {};
  if (existingSplits) for (const { date, hours } of existingSplits) initAllocs[date] = String(hours);
  const [allocs, setAllocs] = useState<Record<string, string>>(initAllocs);

  const total = Object.values(allocs).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const remaining = Math.round((task.totalH - total) * 10) / 10;

  function handleSave() {
    const splits: DaySplit = Object.entries(allocs).map(([date, v]) => ({ date, hours: parseFloat(v) || 0 })).filter(x => x.hours > 0);
    if (splits.length === 0) return;
    onSave(splits);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "white", borderRadius: 14, padding: "20px 22px", maxWidth: 420, width: "95%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>⊕ Dividir em vários dias</div>
        <div style={{ fontSize: 11, color: "#374151", marginBottom: 12, lineHeight: 1.4 }}>{task.title.slice(0, 60)}{task.title.length > 60 ? "…" : ""}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 10px", background: "#f9fafb", borderRadius: 8 }}>
          <span style={{ fontSize: 11 }}>Total: <strong>{fmtH(task.totalH)}</strong></span>
          <span style={{ fontSize: 11, marginLeft: 8 }}>Alocado: <strong style={{ color: total > task.totalH ? "#dc2626" : "#059669" }}>{fmtH(total)}</strong></span>
          {remaining !== 0 && <span style={{ fontSize: 10, color: remaining > 0 ? "#9ca3af" : "#dc2626", marginLeft: 8 }}>{remaining > 0 ? `+${fmtH(remaining)} restando` : `${fmtH(Math.abs(remaining))} acima`}</span>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {days.map(day => (
            <div key={day.date} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#374151", width: 70, flexShrink: 0 }}>{day.label}</span>
              <input type="number" min="0" step="0.5" value={allocs[day.date] ?? ""} placeholder="0"
                onChange={e => setAllocs(prev => ({ ...prev, [day.date]: e.target.value }))}
                style={{ width: 60, fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", textAlign: "right" }} />
              <span style={{ fontSize: 11, color: "#9ca3af" }}>h</span>
              {allocs[day.date] && parseFloat(allocs[day.date]) > 0 && (
                <span style={{ fontSize: 9, color: "#059669" }}>{Math.round((parseFloat(allocs[day.date]) / task.totalH) * 100)}%</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>Cancelar</button>
          <button onClick={handleSave} style={{ flex: 2, padding: "8px", borderRadius: 8, border: "none", background: "#059669", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Salvar →</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Edit Hours Modal ─── */

function EditHoursModal({ task, onSave, onClose }: { task: { key: string; title: string; currentH: number }; onSave: (h: number) => void; onClose: () => void }) {
  const [val, setVal] = useState(String(task.currentH));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "white", borderRadius: 14, padding: "20px 24px", maxWidth: 300, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>✎ Ajustar tempo estimado</div>
        <div style={{ fontSize: 10, color: "#7c3aed", background: "#ede9fe", display: "inline-block", padding: "1px 7px", borderRadius: 5, marginBottom: 8 }}>{task.key}</div>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 14, lineHeight: 1.4 }}>{task.title.slice(0, 60)}{task.title.length > 60 ? "…" : ""}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <input autoFocus type="number" min="0.5" step="0.5" value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { const h = parseFloat(val); if (!isNaN(h) && h > 0) onSave(h); } if (e.key === "Escape") onClose(); }}
            style={{ flex: 1, fontSize: 22, fontWeight: 700, border: "2px solid #059669", borderRadius: 8, padding: "8px 12px", color: "#111", outline: "none", textAlign: "center" }} />
          <span style={{ fontSize: 14, color: "#6b7280", fontWeight: 600 }}>h</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "7px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>Cancelar</button>
          <button onClick={() => { const h = parseFloat(val); if (!isNaN(h) && h > 0) onSave(h); }}
            style={{ flex: 2, padding: "7px", borderRadius: 8, border: "none", background: "#059669", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Salvar →</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Distribute Modal ─── */

function DistributeModal({ task, members, loading, onAssign, onClose }: { task: AgendaTask; members: Array<{ key: string; display: string }>; loading: boolean; onAssign: (mk: string) => void; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "white", borderRadius: 14, padding: "22px 26px", maxWidth: 380, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Distribuir task</div>
        <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700, background: "#ede9fe", display: "inline-block", padding: "1px 7px", borderRadius: 5, marginBottom: 8 }}>{task.key}</div>
        <div style={{ fontSize: 12, color: "#374151", marginBottom: 14, lineHeight: 1.4 }}>{task.title}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {members.map(m => (
            <button key={m.key} onClick={() => onAssign(m.key)} disabled={loading}
              style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#374151" }}>
              {m.display}
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{ marginTop: 12, width: "100%", padding: "7px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 11, cursor: "pointer", color: "#6b7280" }}>Cancelar</button>
      </div>
    </div>
  );
}

/* ─── Recording Modal ─── */

function RecordingModal({ title, date, time, custom, saving, onDateChange, onTimeChange, onCustomChange, onSave, onClose }: {
  title: string; date: string; time: string; custom: string; saving: boolean;
  onDateChange: (v: string) => void; onTimeChange: (v: string) => void; onCustomChange: (v: string) => void;
  onSave: () => void; onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "white", borderRadius: 14, padding: "22px 26px", maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>📹 Agendar gravação</div>
        <div style={{ fontSize: 11, color: "#374151", marginBottom: 14, lineHeight: 1.4 }}>{title.slice(0, 70)}{title.length > 70 ? "…" : ""}</div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 3 }}>Data</label>
          <input type="date" value={date} onChange={e => onDateChange(e.target.value)} style={{ width: "100%", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 5 }}>Horário</label>
          <div style={{ display: "flex", gap: 5 }}>
            {["manhã","tarde","custom"].map(opt => (
              <button key={opt} onClick={() => onTimeChange(opt)} style={{ flex: 1, padding: "6px", borderRadius: 7, border: "1px solid #e5e7eb", fontSize: 11, cursor: "pointer", background: time === opt ? "#059669" : "white", color: time === opt ? "white" : "#374151", fontWeight: time === opt ? 700 : 400 }}>
                {opt === "custom" ? "Horário" : opt.charAt(0).toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </div>
          {time === "custom" && <input type="time" value={custom} onChange={e => onCustomChange(e.target.value)} style={{ marginTop: 7, width: "100%", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", boxSizing: "border-box" }} />}
        </div>
        <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 14, background: "#f9fafb", borderRadius: 8, padding: "7px 10px" }}>
          Vai postar no Jira: <em>@francisco @larissa gravação {date ? ddmm(date) : "DD/MM"} [{time === "custom" ? custom || "HH:MM" : time}]</em>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 11, cursor: "pointer", color: "#6b7280" }}>Cancelar</button>
          <button onClick={onSave} disabled={!date || saving} style={{ flex: 2, padding: "8px 18px", borderRadius: 8, border: "none", background: "#059669", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: !date || saving ? 0.5 : 1 }}>
            {saving ? "Salvando…" : "Confirmar →"}
          </button>
        </div>
      </div>
    </div>
  );
}
