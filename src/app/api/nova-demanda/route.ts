import { NextResponse } from "next/server";
import { sendSlackAlert } from "@/lib/slack";
import {
  fetchPipeline,
  planSubtasks,
  parseLocalDate,
  formatDate,
  DAILY_CAPACITY,
} from "@/lib/scheduler";

export const dynamic   = "force-dynamic";
export const maxDuration = 60;

/* ─── Config ─── */

const JIRA_BASE = () => process.env.JIRA_BASE_URL?.trim() || "";
const JIRA_AUTH = () => {
  const e = process.env.JIRA_EMAIL?.trim() || "";
  const t = process.env.JIRA_API_TOKEN?.trim() || "";
  return Buffer.from(`${e}:${t}`).toString("base64");
};
const PROJECT = () => process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";

// Country field candidates (tries each until one works)
const COUNTRY_CANDIDATES = ["customfield_15854", "customfield_21359", "customfield_10670"];

/* ─── Types ─── */

interface NovaDemandaBody {
  mode: "validate" | "create" | "force_create";
  // Fields
  nomeTask: string;
  area: string;
  areaOutros?: string;
  tipos: string[];
  estaticos: number;
  videos: number;
  dimensoesEstaticos?: string;
  dimensoesVideos?: string;
  duracaoVideos?: string;
  sobreOQue: string;
  pedidoResumido: string;
  mensagem: string;
  prazo: string;
  solicitanteNome: string;
  solicitanteEmail: string;
}

export interface SubtaskResult {
  label: string;
  assignee: string;
  deadline: string;
  hours: number;
  key: string | null;
}

/* ─── Helpers ─── */

function countWorkDays(from: Date, to: Date): number {
  let count = 0;
  const cur = new Date(from); cur.setHours(0, 0, 0, 0);
  const end = new Date(to);   end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function addWorkDays(from: Date, n: number): Date {
  const r = new Date(from);
  let i = 0;
  while (i < n) {
    r.setDate(r.getDate() + 1);
    if (r.getDay() !== 0 && r.getDay() !== 6) i++;
  }
  return r;
}

async function findAccountId(base: string, auth: string, hint: string): Promise<string | null> {
  try {
    const url = `${base}/rest/api/3/user/search?query=${encodeURIComponent(hint)}&maxResults=5`;
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
    if (!res.ok) return null;
    const users = await res.json();
    return Array.isArray(users) && users.length > 0 ? users[0].accountId : null;
  } catch { return null; }
}

async function uploadAttachments(base: string, auth: string, issueKey: string, files: File[]): Promise<void> {
  const url = `${base.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}/attachments`;
  for (const file of files) {
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "X-Atlassian-Token": "no-check",
          // Note: do NOT set Content-Type — browser must set multipart boundary automatically
        },
        body: fd,
      });
    } catch (err) {
      console.warn("[nova-demanda] attachment upload failed:", err);
    }
  }
}

async function forceSetCountry(base: string, auth: string, issueKey: string): Promise<void> {
  const url = `${base.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}`;
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" };
  for (const field of COUNTRY_CANDIDATES) {
    const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ fields: { [field]: [{ value: "Brasil" }] } }) });
    if (res.ok) return;
  }
}

async function createJiraIssue(
  base: string, auth: string, project: string,
  summary: string, descText: string, duedate: string,
  assigneeId: string | null, reporterId: string | null, parentKey?: string
): Promise<{ key: string; self?: string } | null> {
  const url     = `${base.replace(/\/$/, "")}/rest/api/3/issue`;
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" };
  const fields: Record<string, unknown> = {
    project:     { key: project },
    summary,
    description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: descText }] }] },
    issuetype:   parentKey ? { name: "Subtask" } : { name: "Task" },
    ...(duedate     ? { duedate }                             : {}),
    ...(assigneeId  ? { assignee: { accountId: assigneeId } } : {}),
    ...(reporterId && !parentKey ? { reporter: { accountId: reporterId } } : {}),
    ...(parentKey   ? { parent: { key: parentKey } }          : {}),
  };

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ fields }) });

  if (!res.ok) {
    console.error("[createJiraIssue] FAILED", res.status);
    console.error("[createJiraIssue] Fields sent:", JSON.stringify(fields, null, 2));
    const errorBody = await res.text();
    console.error("[createJiraIssue] Jira error response:", errorBody);

    // 400 with reporter → field is frequently rejected when "Modify Reporter"
    // permission is disabled; retry without it so the task still gets created
    if (res.status === 400 && fields.reporter) {
      console.warn("[createJiraIssue] Retrying WITHOUT reporter field...");
      const { reporter: _r, ...fieldsNoReporter } = fields;
      const retry = await fetch(url, { method: "POST", headers, body: JSON.stringify({ fields: fieldsNoReporter }) });
      if (!retry.ok) {
        console.error("[createJiraIssue] Retry also failed", retry.status);
        console.error("[createJiraIssue] Retry error:", await retry.text());
        return null;
      }
      console.log("[createJiraIssue] Retry SUCCESS (without reporter)");
      return retry.json();
    }

    return null;
  }

  return res.json();
}

/* ─── Claude validation ─── */

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 512,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

const VALIDATION_SYSTEM = `Você valida briefings criativos. Seja PERMISSIVO — o time resolve detalhes de execução.

BLOQUEAR (needs_clarification) APENAS SE:
1. Tipo de peça indefinido — não dá pra saber se é estático, vídeo ou copy.
2. Anúncio/Performance com estáticos > 0 E campo de dimensões vazio — specs exatas são obrigatórias para rodar na plataforma.
3. Motion/Vídeo com vídeos > 0 E dimensões/duração ausentes — necessário para produção.
4. Todos os 3 campos descritivos (sobre, pedido, mensagem) vazios ou completamente ininteligíveis.

NUNCA BLOQUEAR POR:
- Público-alvo não detalhado
- Tom de comunicação não especificado
- Detalhes de execução (cores, fontes, estilo visual, referências)
- Número aproximado ou estimado de peças
- Contextos internos conhecidos: D2C, Summit, SMB, ADS, PMM, Elo7, Nuvemshop, lojistas

SE TIVER DÚVIDA → retorne { "ok": true }

Responda APENAS com JSON:
{ "ok": true }
ou
{ "ok": false, "questions": ["pergunta objetiva e direta"] }

Máximo 1 pergunta. Sem texto fora do JSON.`;

async function validateBriefing(body: NovaDemandaBody): Promise<{ ok: boolean; questions?: string[] }> {
  const tipo  = body.tipos.join(", ");
  const user  = `
Tipo(s): ${tipo}
Estáticos: ${body.estaticos}
Vídeos: ${body.videos}
Dimensões estáticos: ${body.dimensoesEstaticos || "(não informado)"}
Dimensões vídeos: ${body.dimensoesVideos || "(não informado)"}
Duração vídeos: ${body.duracaoVideos || "(não informado)"}
Sobre: ${body.sobreOQue}
Pedido: ${body.pedidoResumido}
Mensagem: ${body.mensagem}
  `.trim();

  const raw   = await callClaude(VALIDATION_SYSTEM, user);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ok: true };
  return JSON.parse(match[0]);
}

/* ─── Deadline viability check ─── */

interface ViabilityResult {
  viable: boolean;
  min_date?: string;
  min_days?: number;
  hours_needed?: number;
  capacity_available?: number;
}

async function checkViability(
  body: NovaDemandaBody,
  pipeline: Record<string, { daily: Map<string, number> }>
): Promise<ViabilityResult> {
  const { estaticos, videos, prazo, tipos } = body;

  // Hour estimates per responsible:
  //   Eduardo : estáticos × 1h  +  vídeos × 4h (layout)
  //   Larissa : vídeos × 4h (motion)
  //   Beatriz : 2h fixas se houver Copy
  const hasCopy   = tipos.some(t => t === "Copy");
  const eduHours  = estaticos * 1 + videos * 4;
  const larHours  = videos * 4;
  const beatHours = hasCopy ? 2 : 0;
  const totalHours = eduHours + larHours + beatHours;

  if (totalHours === 0) return { viable: true };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const D     = parseLocalDate(prazo);
  const workDays = Math.max(1, countWorkDays(today, D));

  // ── Available capacity in the [today, prazo] window ──────────────────────
  // Total capacity in window minus hours already committed (from pipeline)
  function availCap(person: string): number {
    const cap   = DAILY_CAPACITY[person] ?? 5.5;
    const pLoad = pipeline[person];
    let booked  = 0;
    if (pLoad) {
      for (const [dateStr, hrs] of pLoad.daily) {
        const d = parseLocalDate(dateStr);
        if (d >= today && d <= D) booked += hrs;
      }
    }
    return Math.max(0, workDays * cap - booked);
  }

  const eduAvail  = availCap("eduardo");
  const larAvail  = availCap("larissa");
  const beatAvail = availCap("beatriz");

  const eduViable  = eduHours  === 0 || eduHours  <= eduAvail;
  const larViable  = larHours  === 0 || larHours  <= larAvail;
  const beatViable = beatHours === 0 || beatHours <= beatAvail;

  if (eduViable && larViable && beatViable) return { viable: true };

  // ── Minimum viable date — walkforward using real pipeline load ────────────
  // Walk day-by-day from today, accumulating *free* hours (cap − already booked).
  // This respects that on a day where someone is already 80% committed,
  // only 20% of their capacity is available for this new task.
  function minDateForPerson(person: string, hoursNeeded: number): Date {
    if (hoursNeeded <= 0) return new Date(today);
    const cap = DAILY_CAPACITY[person] ?? 5.5;
    let accum = 0;
    const d   = new Date(today);
    // Safety cap: never walk more than 120 days forward
    for (let i = 0; i < 120 && accum < hoursNeeded; i++) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() === 0 || d.getDay() === 6) continue; // skip weekends
      const booked = pipeline[person]?.daily.get(formatDate(d)) ?? 0;
      accum += Math.max(0, cap - booked);
    }
    return new Date(d);
  }

  const candidates: Date[] = [];
  if (eduHours  > 0) candidates.push(minDateForPerson("eduardo", eduHours));
  if (larHours  > 0) candidates.push(minDateForPerson("larissa", larHours));
  if (beatHours > 0) candidates.push(minDateForPerson("beatriz", beatHours));

  // The task is only done when ALL responsible have finished their part
  const minDate = candidates.reduce((latest, d) => (d > latest ? d : latest), new Date(today));
  const minDays = Math.max(1, countWorkDays(today, minDate));

  return {
    viable: false,
    min_date: formatDate(minDate),
    min_days: minDays,
    hours_needed: totalHours,
    capacity_available: eduAvail + larAvail + (hasCopy ? beatAvail : 0),
  };
}

/* ─── POST handler ─── */

export async function POST(req: Request) {
  try {
    let body: NovaDemandaBody;
    let attachments: File[] = [];

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      const raw: Record<string, unknown> = {};
      for (const [key, val] of fd.entries()) {
        if (key === "files") {
          if (val instanceof File && val.size > 0) attachments.push(val);
        } else {
          const str = val as string;
          try { raw[key] = JSON.parse(str); } catch { raw[key] = str; }
        }
      }
      body = raw as unknown as NovaDemandaBody;
    } else {
      body = await req.json();
    }

    const { mode, nomeTask, area, areaOutros, tipos, estaticos, videos,
            sobreOQue, pedidoResumido, mensagem, prazo,
            solicitanteNome, solicitanteEmail } = body;

    const base    = JIRA_BASE();
    const auth    = JIRA_AUTH();
    const project = PROJECT();

    // ── VALIDATE mode ────────────────────────────────────────────────────
    if (mode === "validate") {
      // Step 1: briefing quality
      try {
        const check = await validateBriefing(body);
        if (!check.ok && check.questions?.length) {
          return NextResponse.json({ status: "needs_clarification", questions: check.questions });
        }
      } catch { /* fail-safe: continue */ }

      // Step 2: deadline viability
      try {
        const pipeline  = await fetchPipeline(base, auth, project);
        const viability = await checkViability(body, pipeline);
        if (!viability.viable) {
          return NextResponse.json({
            status: "deadline_issue",
            min_date:           viability.min_date,
            min_days:           viability.min_days,
            hours_needed:       viability.hours_needed,
            capacity_available: viability.capacity_available,
          });
        }
      } catch { /* fail-safe: continue */ }

      return NextResponse.json({ status: "ok" });
    }

    // ── CREATE / FORCE_CREATE mode ────────────────────────────────────────
    const forceUnassigned = mode === "force_create";
    const areaLabel = area === "Outros" ? (areaOutros || "Outros") : area;

    // Fetch pipeline for scheduler (only needed for normal create)
    const pipeline = forceUnassigned ? null : await fetchPipeline(base, auth, project).catch(() => null);
    const plans = pipeline
      ? planSubtasks(tipos, `${sobreOQue}. ${pedidoResumido}`, prazo, pipeline)
      : [];

    // Look up reporter + all assignees in parallel
    const thaisHint = "thais.boaventura";
    const [reporterAccountId, thaisAccountId, ...assigneeIds] = await Promise.all([
      findAccountId(base, auth, solicitanteNome),
      findAccountId(base, auth, thaisHint),
      ...plans.map(p => findAccountId(base, auth, p.person)),
    ]);

    // Build parent description
    const descLines = [
      `Solicitante: ${solicitanteNome} <${solicitanteEmail}>`,
      `Área: ${areaLabel}`,
      `Tipos: ${tipos.join(", ")}`,
      `Estáticos: ${estaticos}  |  Vídeos: ${videos}`,
      body.dimensoesEstaticos ? `Dimensões estáticos: ${body.dimensoesEstaticos}` : null,
      body.dimensoesVideos    ? `Dimensões vídeos: ${body.dimensoesVideos}` : null,
      body.duracaoVideos      ? `Duração vídeos: ${body.duracaoVideos}` : null,
      "",
      `Sobre: ${sobreOQue}`,
      `Pedido: ${pedidoResumido}`,
      `Mensagem: ${mensagem}`,
      `Prazo: ${prazo}`,
    ].filter(l => l !== null).join("\n");

    // Create parent task
    const parentAssignee = forceUnassigned ? thaisAccountId : null;
    const parentIssue    = await createJiraIssue(
      base, auth, project,
      nomeTask,
      descLines,
      prazo,
      parentAssignee,
      reporterAccountId,
    );
    const issueKey = parentIssue?.key ?? null;
    if (issueKey) {
      try { await forceSetCountry(base, auth, issueKey); } catch { /* non-fatal */ }

      // Try to set OWNER field (area) via PUT if configured
      const ownerField = process.env.JIRA_OWNER_FIELD?.trim();
      if (ownerField) {
        try {
          await fetch(`${base.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}`, {
            method: "PUT",
            headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { [ownerField]: areaLabel } }),
          });
        } catch { /* non-fatal */ }
      }
    }

    const jiraBase = parentIssue?.self ? parentIssue.self.split("/rest/")[0] : base.replace(/\/$/, "");
    const jiraLink = issueKey ? `${jiraBase}/browse/${issueKey}` : null;

    // Upload attachments (if any)
    if (issueKey && attachments.length > 0) {
      await uploadAttachments(base, auth, issueKey, attachments);
    }

    // Force-create: subtasks unassigned, Slack alert
    if (forceUnassigned) {
      const subtaskResults: SubtaskResult[] = [];
      if (issueKey) {
        // Create subtasks for the relevant types, no assignee, deadline = prazo
        const basicPlans = planSubtasks(tipos, `${sobreOQue}. ${pedidoResumido}`, prazo, {
          eduardo: { daily: new Map() },
          larissa: { daily: new Map() },
          joao:    { daily: new Map() },
          beatriz: { daily: new Map() },
          rafa:    { daily: new Map() },
        });
        for (const plan of basicPlans) {
          const st = await createJiraIssue(base, auth, project,
            `${nomeTask} | ${plan.label}`,
            `Subtask de ${plan.label} — prazo: ${plan.deadline}`,
            plan.deadline, null, null, issueKey
          );
          const stKey = st?.key ?? null;
          if (stKey) { try { await forceSetCountry(base, auth, stKey); } catch { /* */ } }
          subtaskResults.push({ label: plan.label, assignee: "—", deadline: plan.deadline, hours: plan.hours, key: stKey });
        }
      }

      await sendSlackAlert(
        `⚠️ *Prazo impossível — ${nomeTask}*\n` +
        `Solicitante: ${solicitanteNome} | ${solicitanteEmail}\n` +
        `Task criada mas NÃO distribuída — prazo não cobre o volume.\n` +
        `🔗 ${jiraLink}`
      );

      return NextResponse.json({
        status: "created_unassigned",
        issueKey,
        jiraLink,
        reason: "deadline_impossible",
      });
    }

    // Normal create: subtasks with scheduler deadlines + assignees
    const subtaskResults: SubtaskResult[] = [];
    if (issueKey) {
      for (let i = 0; i < plans.length; i++) {
        const plan      = plans[i];
        const accountId = assigneeIds[i] ?? null;
        const st = await createJiraIssue(base, auth, project,
          `${nomeTask} | ${plan.label}`,
          `Subtask de ${plan.label} — estimativa: ${plan.hours}h — prazo: ${plan.deadline}`,
          plan.deadline, accountId, null, issueKey
        );
        const stKey = st?.key ?? null;
        if (stKey) { try { await forceSetCountry(base, auth, stKey); } catch { /* */ } }
        subtaskResults.push({ label: plan.label, assignee: plan.assignee, deadline: plan.deadline, hours: plan.hours, key: stKey });
      }
    }

    const workDays     = countWorkDays(new Date(), parseLocalDate(prazo));
    const subtaskLines = subtaskResults.map(s => `  • ${nomeTask} | ${s.label} → ${s.assignee} (${s.deadline})`).join("\n");

    await sendSlackAlert([
      `🗂️ *Nova demanda: ${nomeTask}*`,
      `Área: ${areaLabel} | Solicitante: ${solicitanteNome}`,
      `Prazo: ${prazo} (${workDays} dias úteis)`,
      subtaskLines,
      `🔗 ${jiraLink}`,
    ].join("\n"));

    return NextResponse.json({
      status:   "created",
      issueKey,
      jiraLink,
      subtasks: subtaskResults,
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[nova-demanda]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
