import { NextResponse } from "next/server";
import { sendSlackAlert } from "@/lib/slack";
import {
  fetchPipeline,
  planSubtasks,
  parseLocalDate,
  formatDate,
  DAILY_CAPACITY,
} from "@/lib/scheduler";

export const dynamic    = "force-dynamic";
export const maxDuration = 60;

/* ─── Config ─── */

const JIRA_BASE = () => process.env.JIRA_BASE_URL?.trim() || "";
const JIRA_AUTH = () => {
  const e = process.env.JIRA_EMAIL?.trim() || "";
  const t = process.env.JIRA_API_TOKEN?.trim() || "";
  return Buffer.from(`${e}:${t}`).toString("base64");
};
const PROJECT = () => process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";

const COUNTRY_CANDIDATES = ["customfield_15854", "customfield_21359", "customfield_10670"];

/* ─── Types ─── */

interface CriativoCard {
  tipo: string;
  formatos: string[];
  formatoOutros?: string;
  dimensoes?: string;
  tipoOutrosDesc?: string;
  duracao?: string;
  direcao?: string;
  docLink?: string;
}

interface NovaDemandaBody {
  mode: "validate" | "create" | "force_create";
  nomeTask: string;
  area: string;
  areaOutros?: string;
  contexto: string;
  objetivo: string;
  criativos: CriativoCard[];
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

/* ─── Type helpers ─── */

const isVideoTipo = (t: string) => t === "Vídeo" || t === "Motion";
const isPPTTipo   = (t: string) => t === "PPT/Apresentação";

function deriveTipos(criativos: CriativoCard[]): string[] {
  const tipos: string[] = [];
  const hasStatic = criativos.some(c => c.tipo && !isVideoTipo(c.tipo) && !isPPTTipo(c.tipo));
  const hasVideo  = criativos.some(c => isVideoTipo(c.tipo));
  if (hasStatic) tipos.push("Anúncio/Performance");
  if (hasVideo)  tipos.push("Motion/Vídeo");
  return tipos;
}

function countStatic(criativos: CriativoCard[]) {
  return criativos.filter(c => c.tipo && !isVideoTipo(c.tipo) && !isPPTTipo(c.tipo)).length;
}

function countVideo(criativos: CriativoCard[]) {
  return criativos.filter(c => isVideoTipo(c.tipo)).length;
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
        },
        body: fd,
      });
    } catch (err) {
      console.warn("[nova-demanda] attachment upload failed:", err);
    }
  }
}

async function forceSetCountry(base: string, auth: string, issueKey: string): Promise<void> {
  const url     = `${base.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}`;
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" };
  for (const field of COUNTRY_CANDIDATES) {
    const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ fields: { [field]: [{ value: "Brasil" }] } }) });
    if (res.ok) return;
  }
}

async function createJiraIssue(
  base: string, auth: string, project: string,
  summary: string, description: object, duedate: string,
  assigneeId: string | null, reporterId: string | null, parentKey?: string
): Promise<{ key: string; self?: string } | null> {
  const url     = `${base.replace(/\/$/, "")}/rest/api/3/issue`;
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" };
  const fields: Record<string, unknown> = {
    project:     { key: project },
    summary,
    description,
    issuetype:   parentKey ? { name: "Subtask" } : { name: "Task" },
    ...(duedate    ? { duedate }                             : {}),
    ...(assigneeId ? { assignee: { accountId: assigneeId } } : {}),
    ...(reporterId && !parentKey ? { reporter: { accountId: reporterId } } : {}),
    ...(parentKey  ? { parent: { key: parentKey } }          : {}),
  };

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ fields }) });

  if (!res.ok) {
    console.error("[createJiraIssue] FAILED", res.status);
    console.error("[createJiraIssue] Fields sent:", JSON.stringify(fields, null, 2));
    const errorBody = await res.text();
    console.error("[createJiraIssue] Jira error response:", errorBody);

    if (res.status === 400 && fields.reporter) {
      console.warn("[createJiraIssue] Retrying WITHOUT reporter field...");
      const { reporter: _r, ...fieldsNoReporter } = fields;
      const retry = await fetch(url, { method: "POST", headers, body: JSON.stringify({ fields: fieldsNoReporter }) });
      if (!retry.ok) {
        console.error("[createJiraIssue] Retry also failed", retry.status, await retry.text());
        return null;
      }
      console.log("[createJiraIssue] Retry SUCCESS (without reporter)");
      return retry.json();
    }
    return null;
  }
  return res.json();
}

/* ─── ADF builder ─── */

function t(text: string) { return { type: "text", text }; }
function bold(text: string) { return { type: "text", text, marks: [{ type: "strong" }] }; }
function heading(level: number, text: string) {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}
function para(...nodes: object[]) { return { type: "paragraph", content: nodes }; }
function rule() { return { type: "rule" }; }

function buildADF(body: NovaDemandaBody): object {
  const { contexto, objetivo, criativos, solicitanteNome, solicitanteEmail, area, areaOutros, prazo } = body;
  const areaLabel = area === "Outros" ? (areaOutros || "Outros") : area;
  const content: object[] = [];

  // Contexto
  content.push(heading(2, "Contexto"));
  content.push(para(t(contexto || "(não informado)")));
  content.push(rule());

  // Objetivo
  content.push(heading(2, "Objetivo"));
  content.push(para(t(objetivo || "(não informado)")));
  content.push(rule());

  // Criativos
  content.push(heading(2, `Criativos (${criativos.length})`));

  for (let i = 0; i < criativos.length; i++) {
    const c = criativos[i];
    content.push(heading(3, `Criativo ${i + 1} — ${c.tipo || "Sem tipo"}`));

    if (isPPTTipo(c.tipo)) {
      if (c.docLink) {
        content.push(para(bold("Link para documento: "), t(c.docLink)));
      } else {
        content.push(para(t("Sem link de documento informado.")));
      }
    } else {
      if (c.formatos && c.formatos.length > 0) {
        const fmtParts = c.formatos.map(f => f === "Outros" && c.formatoOutros ? `Outros (${c.formatoOutros})` : f);
        content.push(para(bold("Formatos: "), t(fmtParts.join(", "))));
      }
      if (c.tipo === "Banner físico" && c.dimensoes) {
        content.push(para(bold("Dimensões: "), t(c.dimensoes)));
      }
      if (c.tipo === "Outros" && c.tipoOutrosDesc) {
        content.push(para(bold("Formato: "), t(c.tipoOutrosDesc)));
      }
      if (isVideoTipo(c.tipo) && c.duracao) {
        content.push(para(bold("Duração: "), t(c.duracao)));
      }
      if (c.direcao) {
        content.push(para(bold("Direção criativa:")));
        content.push(para(t(c.direcao)));
      } else {
        content.push(para(t("Sem direção criativa informada.")));
      }
    }

    if (i < criativos.length - 1) content.push(rule());
  }

  content.push(rule());

  // Info block
  content.push(heading(2, "Informações"));
  content.push(para(bold("Solicitante: "), t(`${solicitanteNome} <${solicitanteEmail}>`)));
  content.push(para(bold("Área: "), t(areaLabel)));
  content.push(para(bold("Prazo: "), t(prazo)));

  return { type: "doc", version: 1, content };
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

const VALIDATION_SYSTEM = `Você valida briefings criativos para um time de design.

REGRA ÚNICA: retorne { "ok": false } SOMENTE se os campos contexto E objetivo estiverem AMBOS completamente vazios (string vazia ou ausente).

Em qualquer outro caso — mesmo que o briefing seja vago, curto, operacional, sem detalhes, sem público, sem tom — retorne { "ok": true }.

NUNCA questionar:
- Objetivo da campanha (já existe campo próprio)
- Público-alvo
- Tom de comunicação
- Referências visuais
- Número de peças
- Formatos, dimensões, duração
- Tasks operacionais: legenda, edição, adaptação, desdobramento, revisão, banner, header

SE TIVER QUALQUER DÚVIDA → { "ok": true }

Responda APENAS com JSON válido, sem texto fora do JSON:
{ "ok": true }
ou (apenas se AMBOS contexto e objetivo vazios):
{ "ok": false, "questions": ["Descreva brevemente o contexto e o objetivo desta demanda."] }`;

async function validateBriefing(body: NovaDemandaBody): Promise<{ ok: boolean; questions?: string[] }> {
  const criativosSummary = body.criativos.map((c, i) =>
    `Criativo ${i + 1}: tipo="${c.tipo}", formatos=[${(c.formatos || []).join(", ")}], duracao="${c.duracao || ""}", direcao="${c.direcao || ""}"`
  ).join("\n");

  const user = `
Contexto: ${body.contexto}
Objetivo: ${body.objetivo}
Criativos:
${criativosSummary}
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
  const staticPieces = countStatic(body.criativos);
  const videoPieces  = countVideo(body.criativos);
  const { prazo }    = body;

  // Eduardo: statics × 1h + videos × 4h
  // Larissa: videos × 4h (motion/video)
  const eduHours  = staticPieces * 1 + videoPieces * 4;
  const larHours  = videoPieces * 4;
  const totalHours = eduHours + larHours;

  if (totalHours === 0) return { viable: true };

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const D        = parseLocalDate(prazo);
  const workDays = Math.max(1, countWorkDays(today, D));

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

  const eduAvail = availCap("eduardo");
  const larAvail = availCap("larissa");

  const eduViable = eduHours === 0 || eduHours <= eduAvail;
  const larViable = larHours === 0 || larHours <= larAvail;

  if (eduViable && larViable) return { viable: true };

  function minDateForPerson(person: string, hoursNeeded: number): Date {
    if (hoursNeeded <= 0) return new Date(today);
    const cap = DAILY_CAPACITY[person] ?? 5.5;
    let accum = 0;
    const d   = new Date(today);
    for (let i = 0; i < 120 && accum < hoursNeeded; i++) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const booked = pipeline[person]?.daily.get(formatDate(d)) ?? 0;
      accum += Math.max(0, cap - booked);
    }
    return new Date(d);
  }

  const candidates: Date[] = [];
  if (eduHours > 0) candidates.push(minDateForPerson("eduardo", eduHours));
  if (larHours > 0) candidates.push(minDateForPerson("larissa", larHours));

  const minDate = candidates.reduce((latest, d) => (d > latest ? d : latest), new Date(today));
  const minDays = Math.max(1, countWorkDays(today, minDate));

  return {
    viable: false,
    min_date: formatDate(minDate),
    min_days: minDays,
    hours_needed: totalHours,
    capacity_available: eduAvail + larAvail,
  };
}

/* ─── POST handler ─── */

export async function POST(req: Request) {
  try {
    let body: NovaDemandaBody;
    let attachments: File[] = [];

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const fd  = await req.formData();
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

    // Ensure criativos is array
    if (!Array.isArray(body.criativos)) {
      try { body.criativos = JSON.parse(body.criativos as unknown as string); } catch { body.criativos = []; }
    }

    // ── Log for debugging ──────────────────────────────────────────────────
    console.log("[nova-demanda] body recebido:", JSON.stringify({
      mode:        body.mode,
      nomeTask:    body.nomeTask,
      area:        body.area,
      contexto:    body.contexto?.slice(0, 80),
      objetivo:    body.objetivo?.slice(0, 80),
      criativos:   body.criativos?.length,
      prazo:       body.prazo,
      solicitante: body.solicitanteNome,
    }, null, 2));

    // ── Fallback: suporte a campos do formulário antigo (cache de navegador) ─
    const legacyBody = body as unknown as Record<string, string>;
    if (!body.contexto && legacyBody["sobreOQue"]) {
      body.contexto = legacyBody["sobreOQue"];
    }
    if (!body.objetivo) {
      const fallback = [legacyBody["pedidoResumido"], legacyBody["mensagem"]]
        .filter(Boolean).join("\n\n");
      if (fallback) body.objetivo = fallback;
    }
    if (!body.criativos?.length && legacyBody["tipos"]) {
      const tiposStr = legacyBody["tipos"];
      let tipos: string[] = [];
      try { tipos = JSON.parse(tiposStr); } catch { tipos = [tiposStr]; }
      body.criativos = tipos.map(t => ({
        tipo: t, formatos: [], formatoOutros: "", dimensoes: "",
        tipoOutrosDesc: "", duracao: "", direcao: legacyBody["mensagem"] ?? "", docLink: "",
      }));
    }
    // ──────────────────────────────────────────────────────────────────────

    const { mode, nomeTask, area, areaOutros, contexto, objetivo, criativos, prazo, solicitanteNome, solicitanteEmail } = body;

    const base    = JIRA_BASE();
    const auth    = JIRA_AUTH();
    const project = PROJECT();

    // ── VALIDATE mode ──────────────────────────────────────────────────────
    if (mode === "validate") {
      try {
        const check = await validateBriefing(body);
        if (!check.ok && check.questions?.length) {
          return NextResponse.json({ status: "needs_clarification", questions: check.questions });
        }
      } catch { /* fail-safe */ }

      try {
        const pipeline  = await fetchPipeline(base, auth, project);
        const viability = await checkViability(body, pipeline);
        if (!viability.viable) {
          return NextResponse.json({
            status:             "deadline_issue",
            min_date:           viability.min_date,
            min_days:           viability.min_days,
            hours_needed:       viability.hours_needed,
            capacity_available: viability.capacity_available,
          });
        }
      } catch { /* fail-safe */ }

      return NextResponse.json({ status: "ok" });
    }

    // ── CREATE / FORCE_CREATE mode ─────────────────────────────────────────
    const forceUnassigned = mode === "force_create";
    const areaLabel = area === "Outros" ? (areaOutros || "Outros") : area;

    // Derive scheduler-compatible tipos from criativos
    const derivedTipos = deriveTipos(criativos);
    const descBlob     = `${contexto}. ${objetivo}`;

    const pipeline = forceUnassigned ? null : await fetchPipeline(base, auth, project).catch(() => null);
    const plans    = pipeline
      ? planSubtasks(derivedTipos, descBlob, prazo, pipeline)
      : [];

    // Look up reporter + assignees
    const thaisHint = "thais.boaventura";
    const [reporterAccountId, thaisAccountId, ...assigneeIds] = await Promise.all([
      findAccountId(base, auth, solicitanteNome),
      findAccountId(base, auth, thaisHint),
      ...plans.map(p => findAccountId(base, auth, p.person)),
    ]);

    // Build ADF description
    const adfDescription = buildADF(body);

    // Create parent task
    const parentAssignee = forceUnassigned ? thaisAccountId : null;
    const parentIssue    = await createJiraIssue(
      base, auth, project,
      nomeTask,
      adfDescription,
      prazo,
      parentAssignee,
      reporterAccountId,
    );
    const issueKey = parentIssue?.key ?? null;

    if (issueKey) {
      try { await forceSetCountry(base, auth, issueKey); } catch { /* non-fatal */ }

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

    // Upload attachments
    if (issueKey && attachments.length > 0) {
      await uploadAttachments(base, auth, issueKey, attachments);
    }

    // Force-create path
    if (forceUnassigned) {
      if (issueKey) {
        const basicPlans = planSubtasks(derivedTipos, descBlob, prazo, {
          eduardo: { daily: new Map() },
          larissa: { daily: new Map() },
          joao:    { daily: new Map() },
          beatriz: { daily: new Map() },
          rafa:    { daily: new Map() },
        });
        for (const plan of basicPlans) {
          const st = await createJiraIssue(
            base, auth, project,
            `${nomeTask} | ${plan.label}`,
            { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: `Subtask de ${plan.label} — prazo: ${plan.deadline}` }] }] },
            plan.deadline, null, null, issueKey
          );
          const stKey = st?.key ?? null;
          if (stKey) { try { await forceSetCountry(base, auth, stKey); } catch { /* */ } }
        }
      }

      await sendSlackAlert(
        `⚠️ *Prazo impossível — ${nomeTask}*\n` +
        `Solicitante: ${solicitanteNome} | ${solicitanteEmail}\n` +
        `Task criada mas NÃO distribuída — prazo não cobre o volume.\n` +
        `🔗 ${jiraLink}`
      );

      return NextResponse.json({ status: "created_unassigned", issueKey, jiraLink, reason: "deadline_impossible" });
    }

    // Normal create: subtasks with scheduler
    const subtaskResults: SubtaskResult[] = [];
    if (issueKey) {
      for (let i = 0; i < plans.length; i++) {
        const plan      = plans[i];
        const accountId = assigneeIds[i] ?? null;
        const st = await createJiraIssue(
          base, auth, project,
          `${nomeTask} | ${plan.label}`,
          { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: `Subtask de ${plan.label} — estimativa: ${plan.hours}h — prazo: ${plan.deadline}` }] }] },
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
      `${criativos.length} criativo(s): ${criativos.map(c => c.tipo || "—").join(", ")}`,
      subtaskLines,
      `🔗 ${jiraLink}`,
    ].join("\n"));

    return NextResponse.json({ status: "created", issueKey, jiraLink, subtasks: subtaskResults });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[nova-demanda]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
