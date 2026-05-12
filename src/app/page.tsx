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

function layoutBars(tasks: TaskItem[], days: Date[]): Bar[] {
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
      const due = new Date(task.dueDate!); due.setHours(0, 0, 0, 0);
      const created = new Date(task.createdAt); created.setHours(0, 0, 0, 0);

      // Skip if entirely outside visible window
      if (due.getTime() < firstDay.getTime()) return null;
      if (created.getTime() > lastDay.getTime()) return null;

      // Find closest visible day index for start
      let startCol = -1;
      const startsBefore = created.getTime() < firstDay.getTime();
      if (startsBefore) {
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
    .filter((x): x is Bar => x !== null)
    .sort((a, b) => a.endCol - b.endCol || a.startCol - b.startCol);

  // Lane allocation: greedy first-fit
  const lanes: number[] = []; // for each lane: last occupied endCol
  for (const bar of candidates) {
    let placed = false;
    for (let l = 0; l < lanes.length; l++) {
      if (bar.startCol > lanes[l]) {
        bar.lane = l;
        lanes[l] = bar.endCol;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bar.lane = lanes.length;
      lanes.push(bar.endCol);
    }
  }

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
    const active = m.tasks.filter((t) => t.status !== "done");
    const bars = layoutBars(active, days);
    const lanes = bars.length === 0 ? 0 : Math.max(...bars.map((b) => b.lane)) + 1;
    const backlog = active.filter((t) => !t.dueDate).length;
    return { member: m, cfg, bars, lanes, backlog };
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

      {/* Gantt */}
      <div style={{ overflowX: "auto", background: "white", borderRadius: 12, border: "1px solid #eef0f3" }}>
        <div style={{ minWidth: 900 }}>

          {/* Header: day columns */}
          <div style={{ display: "grid", gridTemplateColumns: "180px repeat(10, 1fr)", borderBottom: "1px solid #eef0f3" }}>
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
                    padding: "10px 4px",
                    textAlign: "center",
                    borderLeft: isMonday ? "1px solid #eef0f3" : "none",
                    background: isT ? "#f5f3ff" : "transparent",
                    position: "relative",
                  }}
                >
                  <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    {dayLabel(d)}
                  </div>
                  <div style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: isT ? "white" : "#111",
                    marginTop: 2,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 26,
                    height: 26,
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
                  gridTemplateColumns: "180px repeat(10, 1fr)",
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

                {/* Bar zone — relative container spanning 10 columns */}
                <div style={{ gridColumn: "2 / 12", position: "relative", padding: "10px 0" }}>
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
                          left: `${(i / 10) * 100}%`,
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
                          left: `${(i / 10) * 100}%`,
                          width: `${100 / 10}%`,
                          background: "#f5f3ff",
                          opacity: 0.5,
                          zIndex: 0,
                        }}
                      />
                    );
                  })}

                  {/* Bars */}
                  {bars.map((bar) => {
                    const startIdx = bar.startCol - 1;
                    const endIdx = bar.endCol - 1;
                    const leftPct = (startIdx / 10) * 100;
                    const widthPct = ((endIdx - startIdx + 1) / 10) * 100;
                    const top = bar.lane * 32;

                    const isWaiting = bar.task.status === "in_review";
                    const barBg = bar.isDone
                      ? "#9ca3af"
                      : bar.overdue
                      ? "#ef4444"
                      : isWaiting
                      ? "#fca5a5"
                      : bar.color;
                    const barLabel = bar.isDone
                      ? `✅ ${bar.task.title}`
                      : bar.overdue
                      ? `⚠️ ${bar.task.title}`
                      : isWaiting
                      ? `⏳ ${bar.task.title}`
                      : bar.task.title;
                    const titleTip = bar.isDone
                      ? `✅ Entregue · ${bar.task.key} · ${bar.task.title}${bar.task.dueDate ? `\nPrazo: ${bar.task.dueDate}` : ""}`
                      : bar.overdue
                      ? `⚠️ ATRASADA · ${bar.task.key} · ${bar.task.title}${bar.task.dueDate ? `\nPrazo: ${bar.task.dueDate}` : ""}`
                      : isWaiting
                      ? `🕐 Aguardando feedback · ${bar.task.key} · ${bar.task.title}${bar.task.dueDate ? `\nEntrega: ${bar.task.dueDate}` : ""}`
                      : `${bar.task.key} · ${bar.task.title}${bar.task.dueDate ? `\nEntrega: ${bar.task.dueDate}` : ""}`;

                    return (
                      <a
                        key={bar.task.id}
                        href={`${JIRA}/${bar.task.key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={titleTip}
                        style={{
                          position: "absolute",
                          left: `calc(${leftPct}% + 4px)`,
                          width: `calc(${widthPct}% - 8px)`,
                          top: top + 8,
                          height: 26,
                          background: barBg,
                          color: isWaiting && !bar.isDone && !bar.overdue ? "#7f1d1d" : "white",
                          borderRadius: 999,
                          padding: "0 12px",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11,
                          fontWeight: bar.isDone ? 400 : 600,
                          opacity: bar.isDone ? 0.7 : 1,
                          textDecoration: "none",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                          borderLeft: bar.startsBefore ? "3px solid rgba(255,255,255,0.6)" : "none",
                          zIndex: 1,
                        }}
                      >
                        {bar.startsBefore && <span style={{ opacity: 0.85, fontSize: 10 }}>←</span>}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          {barLabel}
                        </span>
                      </a>
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
          <span style={{ width: 24, height: 8, borderRadius: 999, background: "#ef4444" }} />
          atrasada
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

