import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ─── Team config ─── */

export interface TeamMember {
  key: string;
  display: string;
  username: string | null;  // null = sem Jira
  email: string;
  dailyH: number;
  role: string;
  area: "design" | "copy" | "motion";
}

export const TEAM_MEMBERS: TeamMember[] = [
  { key: "eduardo",    display: "Eduardo",    username: "eduardo.oliveira",   email: "eduardo.oliveira@nuvemshop.com.br",   dailyH: 6.5,  role: "Design + Motion",   area: "design" },
  { key: "gasparetto", display: "Gasparetto", username: "eduardo.gasparetto", email: "eduardo.gasparetto@nuvemshop.com.br", dailyH: 6.5,  role: "Design (EnP)",      area: "design" },
  { key: "gabriel",    display: "Gabriel",    username: null,                  email: "gabriel.cassino@nuvemshop.com.br",    dailyH: 6.5,  role: "Design",            area: "design" },
  { key: "larissa",    display: "Larissa",    username: "larissa.delarue",    email: "larissa.delarue@nuvemshop.com.br",    dailyH: 10.5, role: "Motion + Gravação", area: "motion" },
  { key: "francisco",  display: "Francisco",  username: "francisco.fernandes", email: "francisco.fernandes@nuvemshop.com.br", dailyH: 6.5, role: "Audiovisual",       area: "motion" },
  { key: "joao",       display: "João",       username: "joao.camargo",        email: "joao.camargo@nuvemshop.com.br",       dailyH: 6.5,  role: "Sinalização",       area: "design" },
  { key: "beatriz",    display: "Beatriz",    username: "beatriz",             email: "beatriz@nuvemshop.com.br",            dailyH: 6.5,  role: "Copy",              area: "copy"   },
  { key: "rafa",       display: "Rafa",       username: "rafaela.ceragioli",   email: "rafaela.ceragioli@nuvemshop.com.br",  dailyH: 8,    role: "Overflow (Monstra)", area: "design" },
];

/* ─── SLA table ─── */

export const SLA_MAP: Record<string, number> = {
  // Copy
  "copy post":         0.5,
  "copy roteiro":      1,
  "copy estatico":     0.5,
  "copy carrossel":    1,
  // Layout
  "layout estatico":   3,
  "layout carrossel":  5,
  "storyboard 30s":    6,
  "storyboard 15s":    3,
  "thumbnail":         1,
  "cartela":           2,
  // Gravação
  "gravacao":          5,
  "gravação":          5,
  // Motion
  "motion 6s":         1,
  "motion 15s":        2.5,
  "motion 30s":        5,
  "motion 1min":       10,
  "motion 60s":        10,
};

/* ─── SLA estimator from task title ─── */

export function estimateFromSLA(title: string, description = ""): number {
  const t = (title + " " + description).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Motion with duration
  const motionMatch = t.match(/motion[^0-9]*(\d+)\s*(s|seg|sec|min|m)\b/);
  if (motionMatch) {
    const val  = parseInt(motionMatch[1]);
    const unit = motionMatch[2];
    const secs = unit.startsWith("m") ? val * 60 : val;
    return Math.max(1, (secs / 30) * 5);
  }

  // Piece count × SLA
  const countMatch = t.match(/(\d+)\s*(posts?|pecas?|estaticos?|cards?|banners?|artes?|roteiros?|cartelas?|thumbnails?)/);
  const count = countMatch ? parseInt(countMatch[1]) : 1;

  if (t.includes("gravac")) return 5;
  if (t.includes("storyboard") && t.includes("30")) return 6 * count;
  if (t.includes("storyboard") && t.includes("15")) return 3 * count;
  if (t.includes("carrossel") && t.includes("copy")) return 1 * count;
  if (t.includes("carrossel")) return 5 * count;
  if (t.includes("thumbnail")) return 1 * count;
  if (t.includes("cartela")) return 2 * count;
  if (t.includes("copy") || t.includes("roteiro")) return 0.5 * count;
  if (t.includes("layout") || t.includes("estatico") || t.includes("banner") || t.includes("post")) return 3 * count;
  if (t.includes("motion") || t.includes("animac")) return 5 * count;

  return 2;
}

/* ─── Date helpers ─── */

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

function workdaysInRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(start); cur.setHours(0,0,0,0);
  const fin = new Date(end);   fin.setHours(0,0,0,0);
  while (cur <= fin) {
    if (!isWeekend(cur)) days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/* ─── Jira helpers ─── */

function getJiraAuth() {
  const email = process.env.JIRA_EMAIL?.trim() || "";
  const token = process.env.JIRA_API_TOKEN?.trim() || "";
  const base  = process.env.JIRA_BASE_URL?.trim() || "";
  return { base, auth: Buffer.from(`${email}:${token}`).toString("base64") };
}

async function jiraFetch(path: string, opts?: RequestInit) {
  const { base, auth } = getJiraAuth();
  const url = `${base.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Jira ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findAccountId(query: string): Promise<string | null> {
  try {
    const users = await jiraFetch(`/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=1`);
    return Array.isArray(users) && users.length > 0 ? users[0].accountId : null;
  } catch { return null; }
}

/* ─── Types ─── */

export interface AgendaTask {
  key: string;
  title: string;
  status: string;
  dueDate: string | null;
  estimatedH: number;
  isRecording: boolean;
  recordingDate: string | null;
  recordingTime: string | null;
  parentKey: string | null;
  assignee: string | null;
}

export interface DaySlot {
  date: string;        // YYYY-MM-DD
  label: string;       // "SEG 25/5"
  totalCap: number;
  tasks: Array<{ key: string; title: string; hours: number; color: string }>;
  freeH: number;
  overloaded: boolean;
}

export interface AgendaResponse {
  member: TeamMember;
  tasks: AgendaTask[];
  days: DaySlot[];
  unassigned: AgendaTask[];
}

/* ─── GET /api/agenda?pessoa=eduardo ─── */

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pessoa = searchParams.get("pessoa") ?? "eduardo";
  const weekOffset = parseInt(searchParams.get("week") ?? "0");

  const member = TEAM_MEMBERS.find(m => m.key === pessoa) ?? TEAM_MEMBERS[0];

  // Compute date range: current week + next week = 10 workdays
  const now = new Date(); now.setHours(0,0,0,0);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
  const friday2 = new Date(monday);
  friday2.setDate(monday.getDate() + 11); // Mon + 11 = next friday (skip weekend)

  const days = workdaysInRange(monday, friday2).slice(0, 10);

  try {
    // Fetch tasks for this member
    let tasks: AgendaTask[] = [];

    if (member.username) {
      const jql = `project = BDSL AND assignee = "${member.username}" AND statusCategory != Done AND status != Backlog ORDER BY duedate ASC`;
      const fields = ["summary", "status", "duedate", "timeoriginalestimate", "parent", "issuetype"];
      const data = await jiraFetch(
        `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50&fields=${fields.join(",")}`
      );

      tasks = (data.issues ?? []).map((issue: Record<string, unknown>) => {
        const f = issue.fields as Record<string, unknown>;
        const summary = (f.summary as string) ?? "";
        const status  = ((f.status as { name: string })?.name ?? "").toLowerCase();
        const due     = (f.duedate as string | null) ?? null;
        const estSecs = (f.timeoriginalestimate as number | null) ?? null;
        const estH    = estSecs ? estSecs / 3600 : estimateFromSLA(summary);
        const isRec   = /grava[cç]/i.test(summary);
        const parent  = (f.parent as { key?: string } | null)?.key ?? null;
        const assigneeField = f.assignee as { displayName?: string } | null;
        const assignee = assigneeField?.displayName ?? null;

        let mappedStatus = "to_do";
        if (status.includes("progress") || status.includes("andamento")) mappedStatus = "in_progress";
        else if (status.includes("review") || status.includes("aguard") || status.includes("feedback")) mappedStatus = "in_review";
        else if (status.includes("done") || status.includes("conclu")) mappedStatus = "done";

        return {
          key: issue.key as string,
          title: summary,
          status: mappedStatus,
          dueDate: due,
          estimatedH: Math.round(estH * 10) / 10,
          isRecording: isRec,
          recordingDate: null,
          recordingTime: null,
          parentKey: parent,
          assignee,
        } as AgendaTask;
      });
    }

    // Fetch unassigned tasks for "sem dono" panel
    const unassignedJql = `project = BDSL AND assignee is EMPTY AND status != Done AND issuetype != Subtask AND cf[15854] = "Brasil" ORDER BY created DESC`;
    const uData = await jiraFetch(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(unassignedJql)}&maxResults=20&fields=summary,status,duedate,timeoriginalestimate`
    );
    const unassigned: AgendaTask[] = (uData.issues ?? []).map((issue: Record<string, unknown>) => {
      const f = issue.fields as Record<string, unknown>;
      const summary = (f.summary as string) ?? "";
      const estSecs = (f.timeoriginalestimate as number | null) ?? null;
      const estH    = estSecs ? estSecs / 3600 : estimateFromSLA(summary);
      return {
        key: issue.key as string,
        title: summary,
        status: "to_do",
        dueDate: (f.duedate as string | null) ?? null,
        estimatedH: Math.round(estH * 10) / 10,
        isRecording: false,
        recordingDate: null,
        recordingTime: null,
        parentKey: null,
        assignee: null,
      };
    });

    // Build daily slots — distribute tasks backwards from deadline
    const PALETTE = ["#80B0E8","#008471","#D1CAEA","#F4D242","#C45F3F","#898E46","#FFC0C0","#F29CC3"];
    const projectColorMap = new Map<string, string>();
    let colorIdx = 0;
    function getColor(title: string): string {
      const proj = title.split("|")[0].trim().split(" ").slice(0,2).join(" ");
      if (!projectColorMap.has(proj)) projectColorMap.set(proj, PALETTE[colorIdx++ % PALETTE.length]);
      return projectColorMap.get(proj)!;
    }

    const dayMap = new Map<string, DaySlot>();
    for (const d of days) {
      const key = fmtDate(d);
      const wd  = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][d.getDay()];
      dayMap.set(key, {
        date: key,
        label: `${wd} ${d.getDate()}/${d.getMonth()+1}`,
        totalCap: member.dailyH,
        tasks: [],
        freeH: member.dailyH,
        overloaded: false,
      });
    }

    // Sort tasks by dueDate ascending, place on the day of or before due date
    const sorted = [...tasks].filter(t => t.dueDate).sort((a,b) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "")
    );
    for (const task of sorted) {
      if (!task.dueDate) continue;
      const due = fmtDate(parseLocalDate(task.dueDate));
      // Find last available day on or before due date
      const dayKeys = [...dayMap.keys()].filter(k => k <= due);
      if (dayKeys.length === 0) continue;
      const targetDay = dayKeys[dayKeys.length - 1];
      const slot = dayMap.get(targetDay)!;
      slot.tasks.push({ key: task.key, title: task.title, hours: task.estimatedH, color: getColor(task.title) });
      slot.freeH = Math.max(0, slot.freeH - task.estimatedH);
      if (slot.freeH <= 0) slot.overloaded = true;
    }

    // Tasks without deadline go to first available day
    for (const task of tasks.filter(t => !t.dueDate)) {
      const firstDay = days[0];
      if (!firstDay) continue;
      const slot = dayMap.get(fmtDate(firstDay))!;
      slot.tasks.push({ key: task.key, title: task.title, hours: task.estimatedH, color: getColor(task.title) });
      slot.freeH = Math.max(0, slot.freeH - task.estimatedH);
      if (slot.freeH <= 0) slot.overloaded = true;
    }

    return NextResponse.json({
      member,
      tasks,
      days: [...dayMap.values()],
      unassigned,
    } as AgendaResponse);

  } catch (err) {
    console.error("[agenda GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ─── POST /api/agenda — Jira actions + Chat ─── */

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body as { action: string };

    // ── Chat with Claude ──
    if (action === "chat") {
      const { message, context } = body as { message: string; context: string };
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });

      const SYSTEM = `Você é assistente de gestão criativa da Thais Silva na Nuvemshop, Brand Creative team.
Tem acesso ao Jira (projeto BDSL) e pode criar subtasks, atribuir tasks, mover prazos e responder sobre capacidade.

TIME COMPLETO:
- Eduardo Oliveira (eduardo.oliveira) — Design + Motion — 6.5h/dia — anúncios, performance, banners, estáticos, layout de vídeo
- Gasparetto (eduardo.gasparetto) — Design EnP — 6.5h/dia — Eventos e Projetos, workshops, experiências
- Gabriel Cassino (sem Jira ainda) — Design — 6.5h/dia — anúncios/performance (overflow)
- Larissa Delarue (larissa.delarue) — Motion + Vídeo + Gravação — 10.5h/dia (tem freela)
- Francisco Fernandes (francisco.fernandes) — Audiovisual/Gravação — 6.5h/dia
- João (joao.camargo) — Sinalização/Eventos — 6.5h/dia
- Beatriz (beatriz) — Copy — 6.5h/dia
- Rafa (rafaela.ceragioli) — Overflow/Agência Monstra — 8h/dia

REGRAS:
- Anúncio/Performance → Eduardo ou Gabriel
- EnP/Eventos → Gasparetto
- Motion/Animação → Eduardo, Larissa, Francisco
- Gravação → Francisco + Larissa (perguntar ambos no comentário Jira)
- Copy → Beatriz
- Sinalização/Stands/Interiores → João
- Overflow → Rafa ou Gabriel
- Gabriel sem Jira: subtask sem assignee + comentário com email gabriel.cassino@nuvemshop.com.br

SLAs:
COPY: post=0.5h, roteiro=1h, estático=0.5h, carrossel=1h
LAYOUT: estático=3h, carrossel=5h, storyboard 30s=6h, storyboard 15s=3h, thumbnail=1h, cartela=2h
GRAVAÇÃO: 5h (fixo)
MOTION: 6s=1h, 15s=2.5h, 30s=5h, 1min=10h

CONTEXTO ATUAL DA AGENDA:
${context}

Quando receber um COMANDO → confirme a ação antes de executar. Responda em PT-BR.
Quando receber uma PERGUNTA → responda com dados reais do contexto.
Seja direto e conciso.`;

      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1024,
          system: SYSTEM,
          messages: [{ role: "user", content: message }],
        }),
      });
      const anthropicData = await anthropicRes.json();
      const reply = anthropicData.content?.[0]?.text ?? "Erro na resposta do Claude.";
      return NextResponse.json({ reply });
    }

    // ── Assign task ──
    if (action === "assign") {
      const { issueKey, memberKey } = body as { issueKey: string; memberKey: string };
      const member = TEAM_MEMBERS.find(m => m.key === memberKey);
      if (!member) return NextResponse.json({ error: "Membro não encontrado" }, { status: 400 });

      const { base, auth } = getJiraAuth();

      if (!member.username) {
        // Gabriel: add comment with email instead
        await jiraFetch(`/rest/api/3/issue/${issueKey}/comment`, {
          method: "POST",
          body: JSON.stringify({
            body: {
              type: "doc", version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: `Atribuir para: ${member.display} (${member.email}) — sem conta Jira ainda.` }] }],
            },
          }),
        });
        return NextResponse.json({ ok: true, note: "sem_jira_comentado" });
      }

      const accountId = await findAccountId(member.username);
      if (!accountId) return NextResponse.json({ error: "accountId não encontrado para " + member.username }, { status: 404 });

      void base; void auth;
      await jiraFetch(`/rest/api/3/issue/${issueKey}`, {
        method: "PUT",
        body: JSON.stringify({ fields: { assignee: { accountId } } }),
      });
      return NextResponse.json({ ok: true });
    }

    // ── Schedule recording ──
    if (action === "schedule_recording") {
      const { issueKey, date, time } = body as { issueKey: string; date: string; time: string };
      const [y, m, d] = date.split("-").map(Number);
      const ddmm = `${d}/${m}`;
      const commentText = `@francisco @larissa.delarue gravação agendada para ${ddmm} [${time}]\n\nResponda confirmando disponibilidade.`;

      await jiraFetch(`/rest/api/3/issue/${issueKey}/comment`, {
        method: "POST",
        body: JSON.stringify({
          body: {
            type: "doc", version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: commentText }] }],
          },
        }),
      });
      return NextResponse.json({ ok: true });
    }

    // ── Update deadline ──
    if (action === "update_deadline") {
      const { issueKey, newDate } = body as { issueKey: string; newDate: string };
      await jiraFetch(`/rest/api/3/issue/${issueKey}`, {
        method: "PUT",
        body: JSON.stringify({ fields: { duedate: newDate } }),
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Ação desconhecida" }, { status: 400 });
  } catch (err) {
    console.error("[agenda POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
