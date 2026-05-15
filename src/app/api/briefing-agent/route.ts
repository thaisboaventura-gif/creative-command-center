import { NextResponse } from "next/server";
import { sendSlackAlert } from "@/lib/slack";

export const dynamic   = "force-dynamic";
export const maxDuration = 60;

/* ─── Team config ─── */

const INTERNAL_NAMES  = ["eduardo", "joao", "beatriz", "larissa", "rafa"];
const INTERNAL_EMAILS = ["rafaela.ceragioli"];

const DAILY_CAPACITY: Record<string, number> = {
  eduardo: 13.5,
  larissa: 13.5,
  joao:    5.5,
  beatriz: 5.5,
  rafa:    8,
};

const PERSON_DISPLAY: Record<string, string> = {
  eduardo: "Eduardo",
  larissa: "Larissa",
  joao:    "João",
  beatriz: "Beatriz",
  rafa:    "Rafa",
};

const PRESENTATION_KEYWORDS = [
  "apresentacao", "apresentacoes", "powerpoint", "ppt",
  "google slides", "deck", "slides",
];

/* ─── Helpers ─── */

function normalize(str: string): string {
  return str.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normFirst(s: string): string {
  return normalize(s).split(" ")[0];
}

function isInternalUser(reporter: { displayName?: string; emailAddress?: string }): boolean {
  const name  = normalize(reporter.displayName || "");
  const email = (reporter.emailAddress || "").toLowerCase();
  return (
    INTERNAL_NAMES.some((n) => name.includes(n)) ||
    INTERNAL_EMAILS.some((e) => email.includes(e))
  );
}

function isPresentation(summary: string, description: string): boolean {
  const text = normalize(`${summary} ${description}`);
  return PRESENTATION_KEYWORDS.some((k) => text.includes(k));
}

function extractDescription(desc: unknown): string {
  if (!desc) return "";
  if (typeof desc === "string") return desc;
  try {
    const content = desc as { content?: Array<{ content?: Array<{ text?: string }> }> };
    if (content.content) {
      return content.content
        .flatMap((block) => block.content?.map((inline) => inline.text || "") ?? [])
        .filter(Boolean)
        .join("\n");
    }
  } catch { /* ignore ADF parse failure */ }
  return JSON.stringify(desc).slice(0, 2000);
}

function countWorkDays(from: Date, to: Date): number {
  let count = 0;
  const cur = new Date(from); cur.setHours(0, 0, 0, 0);
  const end = new Date(to);   end.setHours(0, 0, 0, 0);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0 && cur.getDay() !== 6) count++;
  }
  return count;
}

/* ─── Jira ─── */

function getJiraAuth() {
  const email = process.env.JIRA_EMAIL?.trim() || "";
  const token = process.env.JIRA_API_TOKEN?.trim() || "";
  const base  = process.env.JIRA_BASE_URL?.trim() || "";
  return { base, auth: Buffer.from(`${email}:${token}`).toString("base64") };
}

const COUNTRY_CANDIDATES = ["customfield_15854", "customfield_21359", "customfield_10670"];

async function forceSetCountry(base: string, auth: string, issueKey: string): Promise<void> {
  const url     = `${base.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}`;
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" };
  for (const field of COUNTRY_CANDIDATES) {
    const res = await fetch(url, {
      method: "PUT", headers,
      body: JSON.stringify({ fields: { [field]: [{ value: "Brasil" }] } }),
    });
    if (res.ok) return;
  }
}

async function postJiraComment(issueKey: string, text: string): Promise<void> {
  const { base, auth } = getJiraAuth();
  if (!base) return;
  const content = text.split("\n").map((line) => ({
    type: "paragraph" as const,
    content: line.trim() ? [{ type: "text" as const, text: line }] : [],
  }));
  await fetch(`${base}/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ body: { type: "doc", version: 1, content } }),
  });
}

async function createSubtask(parentKey: string, summary: string, project: string): Promise<string | null> {
  const { base, auth } = getJiraAuth();
  const res = await fetch(`${base}/rest/api/3/issue`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        project:   { key: project },
        summary,
        issuetype: { name: "Subtask" },
        parent:    { key: parentKey },
      },
    }),
  });
  if (!res.ok) {
    console.error("[briefing-agent] subtask failed:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const key  = data.key as string;
  try { await forceSetCountry(base, auth, key); } catch { /* non-fatal */ }
  return key;
}

async function findAccountId(base: string, auth: string, hint: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${base}/rest/api/3/user/search?query=${encodeURIComponent(hint)}&maxResults=3`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const users = await res.json();
    return Array.isArray(users) && users.length > 0 ? users[0].accountId : null;
  } catch { return null; }
}

async function assignIssue(base: string, auth: string, issueKey: string, accountId: string): Promise<void> {
  await fetch(`${base.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}/assignee`, {
    method: "PUT",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
}

async function setDuedate(base: string, auth: string, issueKey: string, duedate: string): Promise<void> {
  await fetch(`${base.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { duedate } }),
  });
}

/* ─── Team capacity ─── */

async function getTeamHours(): Promise<Map<string, number>> {
  const { base, auth } = getJiraAuth();
  const project = process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";
  const jql     = `project = ${project} AND status != Done AND assignee IS NOT EMPTY`;
  const url     = `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,assignee,timeoriginalestimate`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
    if (!res.ok) return new Map();
    const data   = await res.json();
    const issues = data.issues ?? [];
    const map    = new Map<string, number>();
    for (const issue of issues) {
      const name    = (issue.fields.assignee as { displayName?: string } | null)?.displayName;
      if (!name) continue;
      const secs    = issue.fields.timeoriginalestimate as number | null;
      const hours   = secs ? secs / 3600 : 2; // default 2h if no estimate
      map.set(name, (map.get(name) ?? 0) + hours);
    }
    return map;
  } catch { return new Map(); }
}

/* ─── Claude ─── */

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 1024,
      system, messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

/* ─── Types ─── */

interface SubtaskDef {
  entrega: string;   // "COPY" | "LAYOUT ESTÁTICOS" | "LAYOUT VÍDEOS" | "MOTION" | "SINALIZAÇÃO" | "PRODUTO/DEMO"
  person:  string;   // "beatriz" | "eduardo" | "larissa" | "joao"
  hours:   number;   // estimated hours for this subtask
}

interface BriefingAnalysis {
  nome_curto:     string;
  subtasks:       SubtaskDef[];
  deadline_tight: boolean;
  warning:        string | null;
}

const ANALYSIS_SYSTEM = `Você lê briefings criativos do time de Brand Creative da Nuvemshop e determina quais subtasks criar. Nunca questiona nada — sempre cria.

RESPONSÁVEIS POR TIPO:
- beatriz  → copy, texto, conteúdo escrito
- eduardo  → performance, anúncios, growth, banners, estáticos, layout de vídeo
- larissa  → motion, animação, after effects
- joao     → sinalização, eventos, stands, produto/demo

SUBTASKS A CRIAR (baseado no que o briefing pede):
- COPY            → pessoa: beatriz  — quando tiver copy/texto estratégico
- LAYOUT ESTÁTICOS → pessoa: eduardo — quando tiver peças estáticas (posts, banners, cards, stories)
- LAYOUT VÍDEOS   → pessoa: eduardo — quando tiver vídeo que precisa de layout antes do motion
- MOTION          → pessoa: larissa  — quando tiver animação/motion/after effects
- SINALIZAÇÃO     → pessoa: joao    — quando tiver material de evento/stand/sinalização
- PRODUTO/DEMO    → pessoa: joao    — quando tiver produto ou demo

ESTIMATIVA DE HORAS:
- COPY:             0.75h por estático + 0.5h por vídeo (mínimo 1h)
- LAYOUT ESTÁTICOS: 2h por peça (mínimo 2h)
- LAYOUT VÍDEOS:    4h por vídeo (mínimo 2h)
- MOTION:           4h por vídeo (mínimo 3h)
- SINALIZAÇÃO:      4h
- PRODUTO/DEMO:     3h

NOME CURTO: extraia do título da task no máximo 2 palavras em MAIÚSCULAS que identificam o projeto.
  Ex: "Elo7 ADS Meta" → "ELO7 ADS"
  Ex: "D2C Summit - Lifecycle Lote 2" → "D2C SUMMIT"
  Ex: "SMB ADS retargeting Q2" → "SMB ADS"

PRAZO APERTADO: se workDaysAvailable < ceil(max(horasTotais) / capacidadeDiaria):
  deadline_tight=true, warning="Prazo apertado: [horas]h estimadas em [dias] dia(s) útil(eis) disponível(eis). Sugestão: priorizar ou redistribuir."
Caso contrário: deadline_tight=false, warning=null.

Retorne SOMENTE JSON válido, sem texto antes ou depois:
{
  "nome_curto": string,
  "subtasks": [{ "entrega": string, "person": string, "hours": number }],
  "deadline_tight": boolean,
  "warning": string | null
}`;

/* ─── Route handler ─── */

export async function POST(req: Request) {
  try {
    // Kill switch
    if (process.env.AGENT_PAUSED === "true") {
      return NextResponse.json({ paused: true });
    }

    const payload = await req.json();

    // Bot comment loop prevention
    const webhookEvent: string = payload.webhookEvent || "";
    if (webhookEvent === "comment_created" || webhookEvent === "comment_updated") {
      const commenterEmail: string = payload.comment?.author?.emailAddress || "";
      if (commenterEmail === (process.env.JIRA_EMAIL?.trim() || "")) {
        return NextResponse.json({ skipped: "bot_comment" });
      }
    }

    if (!payload.issue) return NextResponse.json({ skipped: "no_issue" });

    const issue    = payload.issue;
    const issueKey = issue.key as string;
    const fields   = issue.fields as Record<string, unknown>;

    // Skip subtasks
    const issuetype = fields.issuetype as { subtask?: boolean; name?: string } | null;
    if (issuetype?.subtask || issuetype?.name === "Subtask") {
      return NextResponse.json({ skipped: "subtask", issueKey });
    }

    // Country filter — only Brasil (skip if country field exists but isn't Brasil)
    const COUNTRY_FIELDS = ["customfield_21359", "customfield_15854", "customfield_10670"];
    const hasAnyCountry  = COUNTRY_FIELDS.some((f) => fields[f]);
    if (hasAnyCountry) {
      const countryStr = COUNTRY_FIELDS.map((f) => JSON.stringify(fields[f] ?? "").toLowerCase()).join(" ");
      if (!countryStr.includes("brasil") && !countryStr.includes("brazil")) {
        return NextResponse.json({ skipped: "country", issueKey });
      }
    }

    // Skip internal team reporters
    const reporter = fields.reporter as { displayName?: string; emailAddress?: string; accountId?: string } | null;
    if (reporter && isInternalUser(reporter)) {
      return NextResponse.json({ skipped: "internal", reporter: reporter.displayName });
    }

    const { base, auth } = getJiraAuth();
    const project        = process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";
    const summary        = (fields.summary as string) ?? "";
    const description    = extractDescription(fields.description);
    const duedate        = (fields.duedate as string) ?? null;
    const jiraLink       = `${process.env.JIRA_BASE_URL?.trim() || ""}/browse/${issueKey}`;
    const solicitante    = reporter?.displayName || "desconhecido";

    // Presentation → comment + stop (no subtasks)
    if (isPresentation(summary, description)) {
      await postJiraComment(
        issueKey,
        "Olá! 👋\n\nSim, podemos ajudar com revisão e melhorias visuais de apresentações!\n\n" +
        "Para agilizar, precisamos que o conteúdo já esteja estruturado em Google Slides — " +
        "assim focamos na parte visual e brand design.\n\n" +
        "Pode compartilhar o link do slide com o conteúdo? 😊\n\n" +
        "---\n📌 Mensagem gerada por agente de IA."
      );
      await sendSlackAlert(
        `🗂️ *Briefing novo:* ${summary}\n` +
        `Solicitante: ${solicitante}\n` +
        `📊 É apresentação — instrução de template enviada no Jira.\n` +
        `🔗 ${jiraLink}`
      );
      return NextResponse.json({ issueKey, stage: "presentation" });
    }

    // Call Claude — determine subtasks
    const today             = new Date(); today.setHours(0, 0, 0, 0);
    const workDaysAvailable = duedate ? countWorkDays(today, new Date(duedate)) : null;

    const userPrompt =
      `Título: ${summary}\n\nDescrição:\n${description || "(sem descrição)"}` +
      (duedate ? `\n\nPrazo: ${duedate} (${workDaysAvailable} dias úteis disponíveis)` : "\n\nPrazo: não informado");

    const raw      = await callClaude(ANALYSIS_SYSTEM, userPrompt);
    const match    = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Claude returned no JSON");
    const analysis: BriefingAnalysis = JSON.parse(match[0]);

    // Set Country = Brasil on parent
    try { await forceSetCountry(base, auth, issueKey); } catch { /* non-fatal */ }

    // Create subtasks — assign + set deadline
    const createdSubtasks: Array<{ key: string | null; summary: string; person: string; deadline: string }> = [];

    for (const st of analysis.subtasks ?? []) {
      const stSummary = `${analysis.nome_curto} | ${st.entrega}`;

      // Deadline: work backwards from duedate by enough days for this subtask
      let subtaskDeadline = duedate ?? today.toISOString().split("T")[0];
      if (duedate) {
        const capPerDay  = DAILY_CAPACITY[st.person] ?? 5.5;
        const daysNeeded = Math.max(1, Math.ceil(st.hours / capPerDay));
        const due        = new Date(duedate);
        let   d          = new Date(due);
        let   workDaysCounted = 0;
        // Walk backwards
        while (workDaysCounted < daysNeeded - 1) {
          d.setDate(d.getDate() - 1);
          if (d.getDay() !== 0 && d.getDay() !== 6) workDaysCounted++;
        }
        // Make sure it's a workday
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
        // Don't go before today
        if (d < today) d = new Date(today);
        subtaskDeadline = d.toISOString().split("T")[0];
      }

      const key = await createSubtask(issueKey, stSummary, project);

      if (key) {
        // Assign to person
        const accountId = await findAccountId(base, auth, st.person);
        if (accountId) await assignIssue(base, auth, key, accountId);
        // Set due date
        if (subtaskDeadline) await setDuedate(base, auth, key, subtaskDeadline);
      }

      createdSubtasks.push({
        key,
        summary: stSummary,
        person: PERSON_DISPLAY[st.person] ?? st.person,
        deadline: subtaskDeadline,
      });
    }

    // Capacity check — informational note if person > 80% booked
    let capacityNote: string | null = null;
    const hoursMap = await getTeamHours();
    const peopleInvolved = [...new Set((analysis.subtasks ?? []).map(s => s.person))];
    const overloaded: string[] = [];
    for (const person of peopleInvolved) {
      for (const [name, hours] of hoursMap) {
        if (normFirst(name) === person) {
          const weekCap = (DAILY_CAPACITY[person] ?? 5.5) * 5;
          const pct     = Math.round((hours / weekCap) * 100);
          if (pct > 80) overloaded.push(`${PERSON_DISPLAY[person]} (${pct}% da capacidade semanal)`);
          break;
        }
      }
    }
    if (overloaded.length > 0) {
      capacityNote = `⚠️ Atenção: ${overloaded.join(", ")} com pauta cheia. Considerar redistribuição ou Monstra (rafaela.ceragioli).`;
    }

    // Post comment if there's a warning (deadline tight or capacity)
    const warnings = [analysis.warning, capacityNote].filter(Boolean).join("\n");
    if (warnings) {
      await postJiraComment(
        issueKey,
        `⚠️ Aviso do agente criativo:\n\n${warnings}\n\n---\n📌 Mensagem gerada por agente de IA.`
      );
    }

    // Format subtask lines for Slack
    const subtaskLines = createdSubtasks
      .map(s => `  • ${s.summary} → ${s.person} | prazo ${s.deadline}`)
      .join("\n");

    const slackParts = [
      `✅ *Briefing processado: ${summary}*`,
      `Solicitante: ${solicitante}`,
      `Subtasks criadas e distribuídas:`,
      subtaskLines || "  (nenhuma subtask identificada)",
    ];
    if (warnings) slackParts.push(`⚠️ ${warnings}`);
    slackParts.push(`🔗 ${jiraLink}`);

    await sendSlackAlert(slackParts.join("\n"));

    return NextResponse.json({
      issueKey,
      stage: "ok",
      subtasksCreated: createdSubtasks,
      warnings: warnings || null,
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[briefing-agent]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
