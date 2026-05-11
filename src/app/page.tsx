"use client";

import { useEffect, useState } from "react";

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

function getTwoWeekDays(offset: number): Date[] {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 14);
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

function dayNum(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function buildSchedule(
  tasks: TaskItem[],
  days: Date[],
  effectiveDaily: number
): { day: Date; items: { task: TaskItem; isDelivery: boolean; overdue: boolean; h: number }[]; totalH: number }[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const nowMs = now.getTime();

  const active = tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

  const capMap = new Map<string, number>();
  const cellMap = new Map<string, { task: TaskItem; isDelivery: boolean; overdue: boolean; h: number }[]>();
  for (const d of days) {
    capMap.set(d.toDateString(), effectiveDaily);
    cellMap.set(d.toDateString(), []);
  }

  for (const task of active) {
    let remaining = task.estimatedHours;
    const due = task.dueDate ? new Date(task.dueDate) : null;
    if (due) due.setHours(0, 0, 0, 0);
    const isOverdue = due ? due.getTime() < nowMs : false;
    if (due && (nowMs - due.getTime()) / 86400000 > STALE) continue;

    const eligible = days.filter((d) => {
      const dMs = new Date(d).setHours(0, 0, 0, 0);
      if (due && !isOverdue) return dMs <= due.getTime();
      return true;
    });

    for (const d of eligible) {
      if (remaining <= 0) break;
      const key = d.toDateString();
      const cap = capMap.get(key) ?? 0;
      if (cap <= 0) continue;
      const h = Math.min(remaining, cap);
      remaining -= h;
      capMap.set(key, cap - h);
      const isDelivery = due ? sameDay(d, due) : false;
      cellMap.get(key)!.push({ task, isDelivery, overdue: isOverdue, h });
    }

    if (remaining > 0 && eligible.length > 0) {
      const lastKey = eligible[eligible.length - 1].toDateString();
      const existing = cellMap.get(lastKey)!.find((x) => x.task.id === task.id);
      if (existing) {
        existing.h += remaining;
      } else {
        const isDelivery = due ? sameDay(eligible[eligible.length - 1], due) : false;
        cellMap.get(lastKey)!.push({ task, isDelivery, overdue: isOverdue, h: remaining });
      }
    }
  }

  return days.map((d) => {
    const key = d.toDateString();
    const items = cellMap.get(key) || [];
    return { day: d, items, totalH: items.reduce((s, x) => s + x.h, 0) };
  });
}

function fmtH(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}min`;
  const f = Math.floor(h);
  const m = Math.round((h - f) * 60);
  return m > 0 ? `${f}h${String(m).padStart(2, "0")}` : `${f}h`;
}

function shortT(t: string, max = 18): string {
  return t.length > max ? t.slice(0, max) + "…" : t;
}

const STALE = 60;
const AREA_COLORS: Record<string, string> = { design: "#7c3aed", copy: "#2563eb", motion: "#ea580c" };

/* ── Component ── */

export default function Dashboard() {
  const [team, setTeam] = useState<MemberItem[]>([]);
  const [incoming, setIncoming] = useState<IncomingItem[]>([]);
  const [src, setSrc] = useState<"loading" | "ok" | "err">("loading");
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetch("/api/jira")
      .then((r) => r.json())
      .then((d) => {
        if (d.team?.length) { setTeam(d.team); setSrc("ok"); } else setSrc("err");
        if (d.newDemands?.length) setIncoming(d.newDemands);
      })
      .catch(() => setSrc("err"));
  }, []);

  const days = getTwoWeekDays(page);
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
    const cfg = getConfig(m.name);
    const effectiveDaily = cfg.hasFreela ? cfg.dailyH + 8 : cfg.dailyH;
    const active = m.tasks.filter((t) => t.status !== "done");

    const dayCells = buildSchedule(active, days, effectiveDaily);

    const twoWeekH = Math.round(dayCells.reduce((s, c) => s + c.totalH, 0) * 10) / 10;
    const backlog = active.filter((t) => !t.dueDate).length;

    return { member: m, cfg, effectiveDaily, dayCells, twoWeekH, backlog };
  });

  if (src === "loading") return <Shell><p style={{ color: "#9ca3af", textAlign: "center", padding: 80 }}>Conectando ao Jira...</p></Shell>;
  if (src === "err") return <Shell><p style={{ color: "#dc2626", textAlign: "center", padding: 80 }}>Erro ao conectar. Recarregue.</p></Shell>;

  return (
    <Shell>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#111", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: "#ede9fe", color: "#7c3aed", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>✦</span>
          Creative Command Center
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <a href="/nova-demanda" style={{ background: "#7c3aed", color: "white", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, textDecoration: "none", display: "inline-block" }}>+ Nova demanda</a>
          <Btn onClick={() => setPage((p) => p - 1)}>← 2 sem</Btn>
          <Btn onClick={() => setPage((p) => p + 1)}>2 sem →</Btn>
          {page !== 0 && <Btn onClick={() => setPage(0)}>Hoje</Btn>}
        </div>
      </div>

      {/* Grid */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "130px repeat(10, 1fr)", gap: 1, background: "#e5e7eb", borderRadius: 10, overflow: "hidden", minWidth: 900 }}>

          {/* Header: day columns */}
          <div style={hCell}> </div>
          {days.map((d, i) => {
            const isT = sameDay(d, today);
            const isMonday = d.getDay() === 1;
            return (
              <div key={i} style={{
                ...hCell,
                fontWeight: 600,
                background: isT ? "#ede9fe" : isMonday && i > 0 ? "#f3f0ff" : "#f9fafb",
                color: isT ? "#7c3aed" : "#6b7280",
                borderLeft: isMonday && i > 0 ? "2px solid #7c3aed" : "none",
              }}>
                <div style={{ fontSize: 10 }}>{dayLabel(d)}</div>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{dayNum(d)}</div>
              </div>
            );
          })}

          {/* Member rows */}
          {rows.map(({ member, cfg, effectiveDaily, dayCells, twoWeekH, backlog }) => {
            const areaC = AREA_COLORS[cfg.area] || "#6b7280";
            const maxH = effectiveDaily * 10;
            const pct = twoWeekH / maxH;
            const statusC = pct >= 0.9 ? "#dc2626" : pct >= 0.6 ? "#ca8a04" : "#16a34a";

            return (
              <div key={member.name} style={{ display: "contents" }}>
                {/* Name cell */}
                <div style={{ background: "white", padding: "6px 8px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: `${areaC}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: areaC, flexShrink: 0 }}>
                      {member.avatar}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#111", lineHeight: 1.1 }}>{firstName(member.name)}</div>
                      <div style={{ fontSize: 9, color: areaC, fontWeight: 500 }}>{cfg.role}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: statusC, fontWeight: 500, marginTop: 1 }}>
                    {fmtH(twoWeekH)}/{fmtH(maxH)}
                    {cfg.hasFreela && <span style={{ color: "#9ca3af" }}> +freela</span>}
                    {backlog > 0 && <span style={{ color: "#d1d5db" }}> · {backlog} s/prazo</span>}
                  </div>
                </div>

                {/* Day cells */}
                {dayCells.map(({ day, items, totalH }, i) => {
                  const isT = sameDay(day, today);
                  const isMon = day.getDay() === 1 && i > 0;
                  const overbooked = totalH > effectiveDaily;
                  const hasOverdue = items.some((x) => x.overdue);
                  const bg = items.length === 0 ? "white"
                    : hasOverdue ? "#fef2f2"
                    : overbooked ? "#fde68a"
                    : totalH > effectiveDaily * 0.7 ? "#f5f3ff"
                    : "#fafafa";

                  return (
                    <div
                      key={i}
                      style={{
                        background: bg,
                        padding: "3px 4px",
                        minHeight: 52,
                        borderLeft: isT ? "2px solid #7c3aed" : isMon ? "2px solid #e5e7eb" : "none",
                        position: "relative",
                      }}
                    >
                      {items.slice(0, 5).map((x) => (
                        <a
                          key={x.task.id + i}
                          href={`${JIRA}/${x.task.key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${x.task.key}: ${x.task.title}\n${x.task.estimatedDetail} (${fmtH(x.task.estimatedHours)})\nEntrega: ${x.task.dueDate || "sem prazo"}`}
                          style={{
                            display: "block",
                            fontSize: 9,
                            lineHeight: 1.2,
                            padding: "2px 4px",
                            marginBottom: 1,
                            borderRadius: 3,
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: x.overdue ? "#dc2626" : x.isDelivery ? "#7c3aed" : "#374151",
                            background: x.overdue ? "#fee2e2"
                              : x.isDelivery ? "#ede9fe"
                              : "rgba(255,255,255,0.6)",
                            fontWeight: x.isDelivery || x.overdue ? 600 : 400,
                            border: x.isDelivery ? "1px solid #c4b5fd" : "1px solid transparent",
                          }}
                        >
                          {x.isDelivery ? "📦 " : ""}{shortT(x.task.title)}
                        </a>
                      ))}
                      {items.length > 5 && (
                        <span
                          style={{ fontSize: 8, color: "#6b7280", cursor: "default", textDecoration: "underline dotted" }}
                          title={items.slice(5).map((x) => `• ${x.task.key}: ${x.task.title}`).join("\n")}
                        >
                          +{items.length - 5} mais
                        </span>
                      )}
                      {totalH > 0 && (
                        <div style={{
                          position: "absolute",
                          bottom: 1,
                          right: 3,
                          fontSize: 8,
                          fontWeight: 600,
                          color: overbooked ? "#dc2626" : totalH > effectiveDaily * 0.5 ? "#7c3aed" : "#d1d5db",
                        }}>
                          {fmtH(totalH)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Incoming panel */}
      {incoming.length > 0 && <IncomingPanel items={incoming} />}

      {/* Legend */}
      <div style={{ marginTop: 14, display: "flex", gap: 14, fontSize: 10, color: "#9ca3af", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, background: "#ede9fe", border: "1px solid #c4b5fd", fontSize: 9, color: "#7c3aed", fontWeight: 600 }}>📦 task</span>
          = dia da entrega
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fef2f2", border: "1px solid #fecaca" }} />
          atrasada
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fde68a", border: "1px solid #fbbf24" }} />
          dia cheio
        </span>
        <span style={{ marginLeft: "auto", fontSize: 9 }}>
          Equipe: 5h30/dia · Freelas (Edu, Larissa): +8h/dia
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

const hCell: React.CSSProperties = { background: "#f9fafb", padding: "6px 4px", fontSize: 11, color: "#6b7280", textAlign: "center" };
