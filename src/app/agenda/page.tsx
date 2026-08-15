"use client";

import { useEffect, useRef, useState } from "react";
import type { AgendaTask, AgendaResponse, DaySlot, TeamMember } from "@/lib/agenda";

/* ─── Constants ─── */

const JIRA = "https://tiendanube.atlassian.net/browse";

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

const PX_PER_HOUR = 72;
const START_H = 9;

/* ─── Helpers ─── */

function fmtH(h: number): string {
  if (h === 0) return "0h";
  const f = Math.floor(h);
  const m = Math.round((h - f) * 60);
  return m > 0 ? `${f}h${String(m).padStart(2, "0")}` : `${f}h`;
}

/* ─── Chat message type ─── */
interface ChatMsg { role: "user" | "assistant"; text: string; }

/* ─── Main Page ─── */

export default function AgendaPage() {
  const [selectedMember, setSelectedMember] = useState("eduardo");
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState<AgendaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realHours, setRealHours] = useState<Record<string, string>>({});

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
    const saved: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("agenda_real_hours_")) {
        saved[k.replace("agenda_real_hours_", "")] = localStorage.getItem(k)!;
      }
    }
    setRealHours(saved);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/agenda?pessoa=${selectedMember}&week=${weekOffset}`)
      .then(r => r.json())
      .then((d: AgendaResponse & { error?: string }) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedMember, weekOffset]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  async function sendChat() {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", text: msg }]);
    setChatLoading(true);
    try {
      const context = data
        ? `Pessoa: ${data.member.display}\nTasks: ${data.tasks.map(t => `${t.key} ${t.title} (${fmtH(t.estimatedH)}, prazo: ${t.dueDate ?? "sem prazo"})`).join("; ")}`
        : "Sem dados carregados.";
      const res = await fetch("/api/agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", message: msg, context }),
      });
      const d = await res.json();
      setChatMessages(prev => [...prev, { role: "assistant", text: d.reply ?? d.error ?? "Sem resposta." }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function assignTask(issueKey: string, memberKey: string) {
    setDistributing(true);
    await fetch("/api/agenda", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign", issueKey, memberKey }),
    });
    setDistributing(false);
    setDistributeModal(null);
    fetch(`/api/agenda?pessoa=${selectedMember}&week=${weekOffset}`)
      .then(r => r.json()).then(setData);
  }

  async function saveRecording() {
    if (!recordingModal || !recDate) return;
    setRecSaving(true);
    const timeStr = recTime === "custom" ? recCustom : recTime;
    await fetch("/api/agenda", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "schedule_recording", issueKey: recordingModal.key, date: recDate, time: timeStr }),
    });
    localStorage.setItem(`agenda_recording_${recordingModal.key}`, JSON.stringify({ date: recDate, time: timeStr }));
    setRecSaving(false);
    setRecordingModal(null);
  }

  const weekLabel = (() => {
    const now = new Date();
    const mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
    const fri2 = new Date(mon); fri2.setDate(mon.getDate() + 11);
    const fmt = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
    return `${fmt(mon)} — ${fmt(fri2)}`;
  })();

  return (
    <div style={{ minHeight: "100vh", background: "#f8f9fb", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif', display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: "white", borderBottom: "1px solid #eef0f3", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/" style={{ fontSize: 12, color: "#9ca3af", textDecoration: "none" }}>← Painel principal</a>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: "#111", margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 24, height: 24, borderRadius: 6, background: "#d1fae5", color: "#059669", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>📅</span>
            Agenda do Time
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setWeekOffset(p => p - 1)} style={btnStyle}>← sem</button>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", minWidth: 110, textAlign: "center" }}>{weekLabel}</span>
          <button onClick={() => setWeekOffset(p => p + 1)} style={btnStyle}>sem →</button>
          {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={btnStyle}>Hoje</button>}
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: 1400, margin: "0 auto", width: "100%", padding: "16px 12px 120px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Tasks sem dono */}
        {data?.unassigned && data.unassigned.length > 0 && (
          <UnassignedPanel tasks={data.unassigned} onDistribute={t => setDistributeModal(t)} />
        )}

        {/* Barra de pessoas */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {MEMBERS.map(m => (
            <button
              key={m.key}
              onClick={() => setSelectedMember(m.key)}
              style={{
                padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: selectedMember === m.key ? "none" : "1px solid #e5e7eb",
                background: selectedMember === m.key ? "#059669" : "white",
                color: selectedMember === m.key ? "white" : "#374151",
                transition: "all 0.15s",
              }}
            >{m.display}</button>
          ))}
        </div>

        {/* Calendário */}
        {loading ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: 60, fontSize: 13 }}>Conectando ao Jira...</div>
        ) : error ? (
          <div style={{ textAlign: "center", color: "#dc2626", padding: 40, fontSize: 13 }}>Erro: {error}</div>
        ) : data ? (
          <WeekCalendar
            data={data}
            realHours={realHours}
            onSaveRealH={(k, v) => {
              setRealHours(prev => ({ ...prev, [k]: v }));
              localStorage.setItem(`agenda_real_hours_${k}`, v);
            }}
            onScheduleRecording={task => {
              setRecordingModal(task);
              setRecDate(""); setRecTime("manhã"); setRecCustom("");
            }}
          />
        ) : null}
      </div>

      {/* Chat fixo no rodapé */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "white", borderTop: "1px solid #eef0f3", zIndex: 30 }}>
        {chatMessages.length > 0 && (
          <div style={{ maxHeight: 200, overflowY: "auto", padding: "8px 20px", borderBottom: "1px solid #f3f4f6" }}>
            {chatMessages.map((m, i) => (
              <div key={i} style={{ marginBottom: 6, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: m.role === "user" ? "#7c3aed" : "#059669", minWidth: 56, paddingTop: 2 }}>
                  {m.role === "user" ? "Você" : "Claude"}
                </span>
                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.text}</span>
              </div>
            ))}
            {chatLoading && <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>Claude está pensando...</div>}
            <div ref={chatEndRef} />
          </div>
        )}
        <div style={{ padding: "10px 20px", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>✦ Claude</div>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
            placeholder='Ex: "quanto tempo a Larissa tem livre?" ou "distribui as tasks sem dono"'
            style={{ flex: 1, fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", outline: "none", color: "#111" }}
          />
          <button
            onClick={sendChat}
            disabled={chatLoading || !chatInput.trim()}
            style={{ background: "#059669", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}
          >Enviar</button>
        </div>
      </div>

      {/* Modals */}
      {distributeModal && (
        <DistributeModal
          task={distributeModal}
          members={MEMBERS}
          loading={distributing}
          onAssign={mk => assignTask(distributeModal.key, mk)}
          onClose={() => setDistributeModal(null)}
        />
      )}
      {recordingModal && (
        <RecordingModal
          title={recordingModal.title}
          date={recDate} time={recTime} custom={recCustom} saving={recSaving}
          onDateChange={setRecDate} onTimeChange={setRecTime} onCustomChange={setRecCustom}
          onSave={saveRecording} onClose={() => setRecordingModal(null)}
        />
      )}
    </div>
  );
}

/* ─── Unassigned Panel ─── */

function UnassignedPanel({ tasks, onDistribute }: { tasks: AgendaTask[]; onDistribute: (t: AgendaTask) => void }) {
  return (
    <div style={{ background: "white", borderRadius: 12, border: "1px solid #fde68a", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", background: "#fffbeb", borderBottom: "1px solid #fde68a", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>⚡ Tasks sem dono</span>
        <span style={{ background: "#fef3c7", color: "#b45309", borderRadius: 99, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{tasks.length}</span>
      </div>
      <div>
        {tasks.map((t, i) => (
          <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: i < tasks.length - 1 ? "1px solid #f9fafb" : "none", flexWrap: "wrap" }}>
            <a href={`${JIRA}/${t.key}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", textDecoration: "none", minWidth: 80 }}>{t.key}</a>
            <span style={{ fontSize: 12, color: "#111", flex: 1, minWidth: 120 }}>{t.title}</span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>{fmtH(t.estimatedH)}</span>
            {t.dueDate && <span style={{ fontSize: 10, color: "#9ca3af" }}>📅 {t.dueDate.slice(5).replace("-", "/")}</span>}
            <button onClick={() => onDistribute(t)}
              style={{ background: "#059669", color: "white", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              Distribuir
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Week Calendar ─── */

function WeekCalendar({
  data, realHours, onSaveRealH, onScheduleRecording,
}: {
  data: AgendaResponse;
  realHours: Record<string, string>;
  onSaveRealH: (key: string, val: string) => void;
  onScheduleRecording: (t: { key: string; title: string }) => void;
}) {
  const { member, tasks, days } = data;
  const areaC = AREA_COLOR[member.area] ?? "#6b7280";

  // Subtasks take priority: hide a parent task if the person also has subtasks of that parent
  const parentKeysOfSubtasks = new Set(tasks.filter(t => t.parentKey).map(t => t.parentKey!));
  const displayTaskKeys = new Set(
    tasks
      .filter(t => t.parentKey !== null || !parentKeysOfSubtasks.has(t.key))
      .map(t => t.key)
  );

  // Build full task map for quick lookup (isRecording, etc.)
  const taskMap = new Map(tasks.map(t => [t.key, t]));

  // Filter and recalculate each day
  const filteredDays = days.map(day => {
    const filtered = day.tasks.filter(t => displayTaskKeys.has(t.key));
    const usedH = filtered.reduce((s, t) => s + t.hours, 0);
    return {
      ...day,
      tasks: filtered,
      freeH: Math.max(0, day.totalCap - usedH),
      overloaded: usedH > day.totalCap,
    };
  });

  const END_H = Math.max(19, START_H + Math.ceil(member.dailyH) + 2);
  const TOTAL_H = END_H - START_H;
  const gridH = TOTAL_H * PX_PER_HOUR;
  const hourLabels = Array.from({ length: TOTAL_H }, (_, i) => START_H + i);

  const displayCount = tasks.filter(t => displayTaskKeys.has(t.key)).length;

  return (
    <div style={{ background: "white", borderRadius: 12, border: "1px solid #eef0f3", overflow: "hidden" }}>
      {/* Member header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: areaC, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
          {member.display[0]}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{member.display}</div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>{member.role} · {fmtH(member.dailyH)}/dia</div>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: displayCount === 0 ? "#9ca3af" : "#374151", fontWeight: 600 }}>
          {displayCount} {displayCount === 1 ? "task" : "tasks"}
        </div>
      </div>

      {/* Day headers row */}
      <div style={{ display: "grid", gridTemplateColumns: `52px repeat(${filteredDays.length}, 1fr)`, borderBottom: "1px solid #f0f0f0" }}>
        <div style={{ borderRight: "1px solid #f0f0f0" }} />
        {filteredDays.map(day => {
          const usedH = day.totalCap - day.freeH;
          const pct = Math.min(100, (usedH / day.totalCap) * 100);
          const isToday = day.date === todayStr();
          return (
            <div key={day.date} style={{ borderRight: "1px solid #f0f0f0", padding: "8px 4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 600, color: isToday ? "#059669" : "#111", letterSpacing: "-0.2px" }}>
                {day.label}
                {isToday && <span style={{ marginLeft: 4, fontSize: 9, background: "#d1fae5", color: "#059669", borderRadius: 10, padding: "1px 5px" }}>hoje</span>}
              </div>
              <div style={{ margin: "5px 6px 0", height: 3, background: "#f3f4f6", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: day.overloaded ? "#ef4444" : "#059669", borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 9, color: day.overloaded ? "#dc2626" : "#9ca3af", marginTop: 3 }}>
                {day.overloaded ? `⚠ +${fmtH(Math.abs(day.freeH))}` : `${fmtH(day.freeH)} livre`}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div style={{ overflowY: "auto", maxHeight: 620 }}>
        <div style={{ display: "grid", gridTemplateColumns: `52px repeat(${filteredDays.length}, 1fr)`, position: "relative", minHeight: gridH }}>

          {/* Hour labels column */}
          <div style={{ borderRight: "1px solid #f0f0f0", position: "relative", minHeight: gridH }}>
            {hourLabels.map(h => (
              <div key={h} style={{ position: "absolute", top: (h - START_H) * PX_PER_HOUR - 7, right: 6, fontSize: 9, color: "#c0c4cc", fontVariantNumeric: "tabular-nums" }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {filteredDays.map(day => {
            // Stack tasks from 9:00, accumulating hours
            let accH = 0;
            const positioned = day.tasks.map(t => {
              const startH = accH;
              accH += t.hours;
              return { ...t, startH };
            });

            return (
              <div key={day.date} style={{ position: "relative", borderRight: "1px solid #f0f0f0", minHeight: gridH }}>
                {/* Hour grid lines */}
                {hourLabels.map(h => (
                  <div key={h} style={{
                    position: "absolute", top: (h - START_H) * PX_PER_HOUR, left: 0, right: 0,
                    borderTop: "1px solid #f5f5f5",
                  }} />
                ))}

                {/* Daily capacity boundary line */}
                <div style={{
                  position: "absolute",
                  top: member.dailyH * PX_PER_HOUR,
                  left: 0, right: 0,
                  borderTop: "2px dashed #bbf7d0",
                  zIndex: 2,
                }} />

                {/* Task blocks */}
                {positioned.map(t => {
                  const fullTask = taskMap.get(t.key);
                  const isRec = fullTask?.isRecording ?? false;
                  const recStored = (() => {
                    if (typeof window === "undefined") return null;
                    try { const r = localStorage.getItem(`agenda_recording_${t.key}`); return r ? JSON.parse(r) : null; } catch { return null; }
                  })();
                  const top = t.startH * PX_PER_HOUR;
                  const height = Math.max(t.hours * PX_PER_HOUR, 32);
                  const bg = t.color;

                  return (
                    <div
                      key={t.key}
                      style={{
                        position: "absolute",
                        top: top + 2,
                        height: height - 4,
                        left: 3, right: 3,
                        background: bg + "18",
                        borderLeft: `3px solid ${bg}`,
                        borderRadius: "0 6px 6px 0",
                        padding: "4px 6px",
                        overflow: "hidden",
                        zIndex: 3,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        cursor: "pointer",
                      }}
                    >
                      <a
                        href={`${JIRA}/${t.key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: "none", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}
                      >
                        <div style={{
                          fontSize: 11, fontWeight: 600, color: "#1a1a2e", lineHeight: 1.3,
                          overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: height < 48 ? "nowrap" : "normal",
                          maxHeight: height < 48 ? undefined : "2.6em",
                        }}>
                          {t.title}
                        </div>
                        {height >= 40 && (
                          <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
                            {fmtH(t.hours)}
                            {fullTask?.dueDate && <span style={{ marginLeft: 6, color: "#9ca3af" }}>📅 {fullTask.dueDate.slice(5).replace("-", "/")}</span>}
                          </div>
                        )}
                      </a>

                      {/* Recording badge */}
                      {isRec && height >= 44 && (
                        <button
                          onClick={e => { e.preventDefault(); e.stopPropagation(); onScheduleRecording({ key: t.key, title: t.title }); }}
                          style={{
                            marginTop: 3, alignSelf: "flex-start",
                            fontSize: 9, color: recStored ? "#059669" : "#ea580c",
                            background: recStored ? "#d1fae5" : "#fff7ed",
                            border: "none", borderRadius: 10, padding: "1px 6px", cursor: "pointer",
                          }}
                        >
                          📹 {recStored ? `${recStored.date?.slice(5).replace("-", "/")} [${recStored.time}]` : "agendar"}
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Empty day placeholder */}
                {day.tasks.length === 0 && (
                  <div style={{
                    position: "absolute", top: 12, left: 0, right: 0,
                    textAlign: "center", fontSize: 10, color: "#e5e7eb",
                    pointerEvents: "none",
                  }}>livre</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Task list footer — real hours tracking */}
      {displayCount > 0 && (
        <details style={{ borderTop: "1px solid #f0f0f0" }}>
          <summary style={{ padding: "8px 16px", fontSize: 11, color: "#9ca3af", cursor: "pointer", userSelect: "none", listStyle: "none" }}>
            ▸ Ver lista de tasks ({displayCount}) · registrar horas reais
          </summary>
          <div style={{ borderTop: "1px solid #f9fafb" }}>
            {tasks.filter(t => displayTaskKeys.has(t.key)).map(task => {
              const realH = realHours[task.key] ?? "";
              return (
                <div key={task.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid #f9fafb", flexWrap: "wrap" }}>
                  <a href={`${JIRA}/${task.key}`} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", textDecoration: "none", minWidth: 80 }}>{task.key}</a>
                  <span style={{ fontSize: 12, color: "#111", flex: 1, minWidth: 160 }}>{task.title}</span>
                  {task.dueDate && <span style={{ fontSize: 10, color: "#9ca3af" }}>📅 {task.dueDate.slice(5).replace("-", "/")}</span>}
                  <span style={{ fontSize: 11, color: "#6b7280" }}>Est. {fmtH(task.estimatedH)}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>Real:</span>
                  <input
                    type="number" min="0" step="0.5" value={realH} placeholder="—"
                    onChange={e => onSaveRealH(task.key, e.target.value)}
                    style={{ width: 48, fontSize: 11, border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 4px", color: "#111" }}
                  />
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>h</span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ─── Distribute Modal ─── */

function DistributeModal({ task, members, loading, onAssign, onClose }: {
  task: AgendaTask;
  members: Array<{ key: string; display: string }>;
  loading: boolean;
  onAssign: (mk: string) => void;
  onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "white", borderRadius: 14, padding: "24px 28px", maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Distribuir task</div>
        <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, background: "#ede9fe", display: "inline-block", padding: "2px 8px", borderRadius: 6, marginBottom: 8 }}>{task.key}</div>
        <div style={{ fontSize: 12, color: "#374151", marginBottom: 16, lineHeight: 1.4 }}>{task.title}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {members.map(m => (
            <button key={m.key} onClick={() => onAssign(m.key)} disabled={loading}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#374151" }}>
              {m.display}
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{ marginTop: 14, width: "100%", padding: "8px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/* ─── Recording Modal ─── */

function RecordingModal({ title, date, time, custom, saving, onDateChange, onTimeChange, onCustomChange, onSave, onClose }: {
  title: string; date: string; time: string; custom: string; saving: boolean;
  onDateChange: (v: string) => void;
  onTimeChange: (v: string) => void;
  onCustomChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "white", borderRadius: 14, padding: "24px 28px", maxWidth: 420, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>📹 Agendar gravação</div>
        <div style={{ fontSize: 12, color: "#374151", marginBottom: 16, lineHeight: 1.4 }}>{title.slice(0, 70)}{title.length > 70 ? "…" : ""}</div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>Data</label>
          <input type="date" value={date} onChange={e => onDateChange(e.target.value)}
            style={{ width: "100%", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 6 }}>Horário</label>
          <div style={{ display: "flex", gap: 6 }}>
            {["manhã", "tarde", "custom"].map(opt => (
              <button key={opt} onClick={() => onTimeChange(opt)}
                style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12, cursor: "pointer",
                  background: time === opt ? "#059669" : "white", color: time === opt ? "white" : "#374151", fontWeight: time === opt ? 700 : 400 }}>
                {opt === "custom" ? "Horário" : opt.charAt(0).toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </div>
          {time === "custom" && (
            <input type="time" value={custom} onChange={e => onCustomChange(e.target.value)}
              style={{ marginTop: 8, width: "100%", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", boxSizing: "border-box" }} />
          )}
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 16, background: "#f9fafb", borderRadius: 8, padding: "8px 12px" }}>
          Vai postar no Jira:<br />
          <em>@francisco @larissa.delarue gravação agendada para {date ? date.slice(5).replace("-", "/") : "DD/MM"} [{time === "custom" ? custom || "HH:MM" : time}]</em>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>
            Cancelar
          </button>
          <button onClick={onSave} disabled={!date || saving}
            style={{ flex: 2, padding: "8px 20px", borderRadius: 8, border: "none", background: "#059669", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !date || saving ? 0.5 : 1 }}>
            {saving ? "Salvando…" : "Confirmar →"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Shared styles ─── */
const btnStyle: React.CSSProperties = {
  background: "white", border: "1px solid #e5e7eb", borderRadius: 6,
  padding: "4px 10px", cursor: "pointer", fontSize: 12, color: "#374151",
};
