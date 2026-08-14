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

/* ─── Helpers ─── */

function fmtH(h: number): string {
  if (h === 0) return "0h";
  const f = Math.floor(h);
  const m = Math.round((h - f) * 60);
  return m > 0 ? `${f}h${String(m).padStart(2,"0")}` : `${f}h`;
}

function statusChip(status: string): { label: string; bg: string; color: string } {
  const m: Record<string, { label: string; bg: string; color: string }> = {
    done:        { label: "Entregue",     bg: "#f3f4f6", color: "#6b7280" },
    in_review:   { label: "Entr. p/ feedb.", bg: "#fff7ed", color: "#c2410c" },
    in_progress: { label: "Em andamento", bg: "#eff6ff", color: "#1d4ed8" },
    to_do:       { label: "A fazer",      bg: "#f9fafb", color: "#9ca3af" },
  };
  return m[status] ?? m.to_do;
}

function LS(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

/* ─── Chat message type ─── */
interface ChatMsg { role: "user" | "assistant"; text: string; }

/* ─── Component ─── */

export default function AgendaPage() {
  const [selectedMember, setSelectedMember] = useState("eduardo");
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState<AgendaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real-hours overrides (localStorage)
  const [realHours, setRealHours] = useState<Record<string, string>>({});

  // Recording scheduling
  const [recordingModal, setRecordingModal] = useState<{ key: string; title: string } | null>(null);
  const [recDate, setRecDate] = useState("");
  const [recTime, setRecTime] = useState("manhã");
  const [recCustom, setRecCustom] = useState("");
  const [recSaving, setRecSaving] = useState(false);

  // Distribute modal
  const [distributeModal, setDistributeModal] = useState<AgendaTask | null>(null);
  const [distributing, setDistributing] = useState(false);

  // Chat
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load real hours from localStorage on mount
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

  function saveRealH(key: string, val: string) {
    setRealHours(prev => ({ ...prev, [key]: val }));
    localStorage.setItem(`agenda_real_hours_${key}`, val);
  }

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
    // Reload
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

  // Compute week range label
  const weekLabel = (() => {
    const now = new Date();
    const mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
    const fri2 = new Date(mon); fri2.setDate(mon.getDate() + 11);
    const fmt = (d: Date) => `${d.getDate()}/${d.getMonth()+1}`;
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

      <div style={{ flex: 1, maxWidth: 1300, margin: "0 auto", width: "100%", padding: "16px 12px 120px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* PARTE 1 — Tasks sem dono */}
        {data?.unassigned && data.unassigned.length > 0 && (
          <UnassignedPanel
            tasks={data.unassigned}
            onDistribute={task => setDistributeModal(task)}
          />
        )}

        {/* PARTE 2 — Barra de pessoas */}
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
            >
              {m.display}
            </button>
          ))}
        </div>

        {/* PARTE 3 — Visão da pessoa */}
        {loading ? (
          <p style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>Conectando ao Jira...</p>
        ) : error ? (
          <p style={{ textAlign: "center", color: "#dc2626", padding: 40 }}>Erro: {error}</p>
        ) : data ? (
          <PersonView
            data={data}
            realHours={realHours}
            onSaveRealH={saveRealH}
            onScheduleRecording={task => { setRecordingModal(task); setRecDate(""); setRecTime("manhã"); setRecCustom(""); }}
          />
        ) : null}
      </div>

      {/* PARTE 4 — Chat fixo no rodapé */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "white", borderTop: "1px solid #eef0f3",
        zIndex: 30,
      }}>
        {/* Chat history (colapsável) */}
        {chatMessages.length > 0 && (
          <div style={{ maxHeight: 220, overflowY: "auto", padding: "8px 20px", borderBottom: "1px solid #f3f4f6" }}>
            {chatMessages.map((m, i) => (
              <div key={i} style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: m.role === "user" ? "#7c3aed" : "#059669",
                  minWidth: 60, paddingTop: 2,
                }}>
                  {m.role === "user" ? "Você" : "Claude"}
                </span>
                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.text}</span>
              </div>
            ))}
            {chatLoading && (
              <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>Claude está pensando...</div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
        {/* Input */}
        <div style={{ padding: "10px 20px", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>✦ Claude</div>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
            placeholder='Ex: "quanto tempo a Larissa tem livre?" ou "distribui as tasks sem dono"'
            style={{
              flex: 1, fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8,
              padding: "8px 12px", outline: "none", color: "#111",
            }}
          />
          <button
            onClick={sendChat}
            disabled={chatLoading || !chatInput.trim()}
            style={{
              background: "#059669", color: "white", border: "none", borderRadius: 8,
              padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              opacity: chatLoading || !chatInput.trim() ? 0.5 : 1,
            }}
          >
            Enviar
          </button>
        </div>
      </div>

      {/* Modals */}
      {distributeModal && (
        <DistributeModal
          task={distributeModal}
          members={MEMBERS}
          loading={distributing}
          onAssign={(mk) => assignTask(distributeModal.key, mk)}
          onClose={() => setDistributeModal(null)}
        />
      )}

      {recordingModal && (
        <RecordingModal
          title={recordingModal.title}
          date={recDate}
          time={recTime}
          custom={recCustom}
          saving={recSaving}
          onDateChange={setRecDate}
          onTimeChange={setRecTime}
          onCustomChange={setRecCustom}
          onSave={saveRecording}
          onClose={() => setRecordingModal(null)}
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
          <div key={t.key} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "9px 16px",
            borderBottom: i < tasks.length - 1 ? "1px solid #f9fafb" : "none",
            flexWrap: "wrap",
          }}>
            <a href={`${JIRA}/${t.key}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", textDecoration: "none", minWidth: 80 }}>
              {t.key}
            </a>
            <span style={{ fontSize: 12, color: "#111", flex: 1, minWidth: 120 }}>{t.title}</span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>{fmtH(t.estimatedH)}</span>
            {t.dueDate && <span style={{ fontSize: 10, color: "#9ca3af" }}>📅 {t.dueDate.slice(5).replace("-", "/")}</span>}
            <button
              onClick={() => onDistribute(t)}
              style={{ background: "#059669", color: "white", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
            >
              Distribuir
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Person View ─── */

function PersonView({
  data, realHours, onSaveRealH, onScheduleRecording,
}: {
  data: AgendaResponse;
  realHours: Record<string, string>;
  onSaveRealH: (key: string, val: string) => void;
  onScheduleRecording: (t: { key: string; title: string }) => void;
}) {
  const { member, tasks, days } = data;
  const areaC = AREA_COLOR[member.area] ?? "#6b7280";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

      {/* LEFT — Lista de tasks */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #eef0f3", overflow: "hidden" }}>
        {/* Member header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: areaC, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
            {member.display[0]}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{member.display}</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>{member.role} · {fmtH(member.dailyH)}/dia</div>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: "#6b7280" }}>
            {tasks.length} tasks
          </div>
        </div>

        {/* Task list */}
        {tasks.length === 0 ? (
          <p style={{ textAlign: "center", color: "#9ca3af", padding: 24, fontSize: 12 }}>Sem tasks ativas.</p>
        ) : (
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            {tasks.map(task => {
              const chip = statusChip(task.status);
              const realH = realHours[task.key] ?? "";
              const recStored = (() => {
                try { const r = localStorage.getItem(`agenda_recording_${task.key}`); return r ? JSON.parse(r) : null; } catch { return null; }
              })();
              return (
                <div key={task.key} style={{ padding: "10px 16px", borderBottom: "1px solid #f9fafb" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                    <a href={`${JIRA}/${task.key}`} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", textDecoration: "none", flexShrink: 0, paddingTop: 1 }}>
                      {task.key}
                    </a>
                    <span style={{ fontSize: 12, color: "#111", flex: 1, lineHeight: 1.4 }}>{task.title}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 20, background: chip.bg, color: chip.color, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {chip.label}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
                    {task.dueDate && <span style={{ color: "#9ca3af" }}>📅 {task.dueDate.slice(5).replace("-", "/")}</span>}
                    <span style={{ color: "#6b7280" }}>Estimado: {fmtH(task.estimatedH)}</span>
                    <span style={{ color: "#d1d5db" }}>|</span>
                    <span style={{ color: "#9ca3af" }}>Real:</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={realH}
                      placeholder="—"
                      onChange={e => onSaveRealH(task.key, e.target.value)}
                      style={{ width: 48, fontSize: 11, border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 4px", color: "#111" }}
                    />
                    <span style={{ color: "#9ca3af" }}>h</span>
                  </div>
                  {task.isRecording && (
                    <div style={{ marginTop: 6 }}>
                      {recStored ? (
                        <span style={{ fontSize: 11, color: "#059669", background: "#d1fae5", padding: "2px 8px", borderRadius: 20 }}>
                          📹 Gravação: {recStored.date?.slice(5).replace("-","/")} [{recStored.time}]
                        </span>
                      ) : (
                        <button
                          onClick={() => onScheduleRecording({ key: task.key, title: task.title })}
                          style={{ fontSize: 11, color: "#ea580c", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 20, padding: "2px 10px", cursor: "pointer" }}
                        >
                          📹 Agendar gravação
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* RIGHT — Agenda visual por dia */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {days.map(day => <DayCard key={day.date} day={day} />)}
      </div>
    </div>
  );
}

/* ─── Day Card ─── */

function DayCard({ day }: { day: DaySlot }) {
  const totalBooked = day.totalCap - day.freeH;
  const usedPct = Math.min(100, (totalBooked / day.totalCap) * 100);

  return (
    <div style={{
      background: day.overloaded ? "#fff5f5" : "white",
      borderRadius: 10,
      border: day.overloaded ? "1px solid #fca5a5" : "1px solid #eef0f3",
      padding: "10px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{day.label}</span>
        <span style={{ fontSize: 11, color: day.overloaded ? "#dc2626" : "#059669", fontWeight: 600 }}>
          {day.overloaded ? `⚠️ +${fmtH(Math.abs(day.freeH))} acima` : `🟢 ${fmtH(day.freeH)} livre`}
        </span>
      </div>

      {/* Capacity bar */}
      <div style={{ height: 4, background: "#f3f4f6", borderRadius: 2, marginBottom: 8, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${usedPct}%`, background: day.overloaded ? "#ef4444" : "#059669", borderRadius: 2, transition: "width 0.3s" }} />
      </div>

      {/* Task blocks */}
      {day.tasks.length === 0 ? (
        <div style={{ fontSize: 11, color: "#d1d5db", fontStyle: "italic" }}>Nenhuma task</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {day.tasks.map(t => (
            <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />
              <a href={`${JIRA}/${t.key}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "#374151", textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={t.title}>
                {t.title.length > 38 ? t.title.slice(0,38) + "…" : t.title}
              </a>
              <span style={{ fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>{fmtH(t.hours)}</span>
            </div>
          ))}
          {/* Free time block */}
          {day.freeH > 0 && !day.overloaded && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: "#e5e7eb", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#d1d5db", fontStyle: "italic", flex: 1 }}>livre</span>
              <span style={{ fontSize: 10, color: "#d1d5db", flexShrink: 0 }}>{fmtH(day.freeH)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
        <div style={{ fontSize: 12, color: "#374151", marginBottom: 16, lineHeight: 1.4 }}>{title.slice(0,70)}{title.length > 70 ? "…" : ""}</div>
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
          Vai postar no Jira:<br/>
          <em>@francisco @larissa.delarue gravação agendada para {date ? date.slice(5).replace("-","/") : "DD/MM"} [{time === "custom" ? custom || "HH:MM" : time}]</em>
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

/* ─── Shared button style ─── */
const btnStyle: React.CSSProperties = {
  background: "white", border: "1px solid #e5e7eb", borderRadius: 6,
  padding: "4px 10px", cursor: "pointer", fontSize: 12, color: "#374151",
};
