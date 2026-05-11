import { NextResponse } from "next/server";
import { estimateHours } from "@/lib/estimate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// --- Team config ---

const INTERNAL_NAMES = ["eduardo", "joao", "beatriz", "larissa", "rafa"];
const INTERNAL_EMAILS = ["rafaela.ceragioli"];

const WEEKLY_CAPACITY: Record<string, number> = {
  eduardo: 67.5, // 13.5h/day × 5 (tem freela design)
  larissa: 67.5, // 13.5h/day × 5 (tem freela motion)
  joao: 27.5,    // 5.5h/day × 5
  beatriz: 27.5,
};

// Country custom field — update JIRA_COUNTRY_FIELD env var when field ID is confirmed
// Example: JIRA_COUNTRY_FIELD=customfield_10100
const COUNTRY_FIELD = process.env.JIRA_COUNTRY_FIELD || "";
const COUNTRY_VALUE = "Brasil";

const PRESENTATION_KEYWORDS = [
  "apresentacao", "apresentacoes", "powerpoint", "ppt",
  "google slides", "deck", "slides",
];

// --- Helpers ---

function isInternalUser(reporter: { displayName?: string; emailAddress?: string }): boolean {
  const name = normalize(reporter.displayName || "");
  const email = (reporter.emailAddress || "").toLowerCase();
  return (
    INTERNAL_NAMES.some((n) => name.includes(n)) ||
    INTERNAL_EMAILS.some((e) => email.includes(e))
  );
}

function normalize(str: string): string {
  return str.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
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
  } catch {
    // ignore ADF parse failure
  }
  return JSON.stringify(desc).slice(0, 2000);
}

function countWorkDays(from: Date, to: Date): number {
  let count = 0;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0 && cur.getDay() !== 6) count++;
  }
  return count;
}

// --- Jira ---

function getJiraAuth() {
  const email = process.env.JIRA_EMAIL?.trim() || "";
  const token = process.env.JIRA_API_TOKEN?.trim() || "";
  const base = process.env.JIRA_BASE_URL?.trim() || "";
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  return { base, auth };
}

async function postJiraComment(issueKey: string, text: string): Promise<boolean> {
  const { base, auth } = getJiraAuth();
  if (!base) return false;

  const content = text.split("\n").map((line) => ({
    type: "paragraph" as const,
    content: line.trim() ? [{ type: "text" as const, text: line }] : [],
  }));

  const res = await fetch(`${base}/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body: { type: "doc", version: 1, content } }),
  });
  return res.ok;
}

async function createSubtask(
  parentKey: string,
  summary: string,
  project: string
): Promise<string | null> {
  const { base, auth } = getJiraAuth();

  const fields: Record<string, unknown> = {
    project: { key: project },
    summary,
    issuetype: { name: "Subtask" },
    parent: { key: parentKey },
  };

  // Set Country = Brasil when field ID is configured
  if (COUNTRY_FIELD) {
    fields[COUNTRY_FIELD] = { value: COUNTRY_VALUE };
  }

  const res = await fetch(`${base}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    console.error("[briefing-agent] subtask failed:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data.key as string;
}

async function getTeamHours(): Promise<Map<string, number>> {
  const { base, auth } = getJiraAuth();
  const project = process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";
  const jql = `project = ${project} AND status != Done AND assignee IS NOT EMPTY`;
  const url = `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,status,assignee,timeoriginalestimate`;

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) return new Map();

  const data = await res.json();
  const issues: Array<{ fields: Record<string, unknown> }> = data.issues ?? [];

  const hoursMap = new Map<string, number>();
  for (const issue of issues) {
    const assignee = (issue.fields.assignee as { displayName?: string } | null)?.displayName;
    if (!assignee) continue;
    const timeOrig = issue.fields.timeoriginalestimate as number | null;
    const est = estimateHours(issue.fields.summary as string, timeOrig);
    hoursMap.set(assignee, (hoursMap.get(assignee) ?? 0) + est.hours);
  }
  return hoursMap;
}

function capacityPercent(displayName: string, totalHours: number): number {
  const key = normalize(displayName).split(" ")[0];
  const cap = WEEKLY_CAPACITY[key];
  if (!cap) return 0;
  return Math.round((totalHours / cap) * 100);
}

// --- Claude ---

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

// --- Types ---

interface SubtaskDef {
  nome_curto: string; // max 2 words, uppercase
  entrega: string;    // "COPY" | "LAYOUT ESTÁTICOS" | "LAYOUT VÍDEOS" | "MOTION VIDEO A" | etc.
}

interface StaticRangeAdjustment {
  original_min: number;
  original_max: number;
  using: number;
}

interface BriefingAnalysis {
  has_issues: boolean;
  missing_objective: boolean;
  piece_count_mismatch: { found: boolean; mentioned: number; detailed: number } | null;
  missing_specs: boolean;
  missing_specs_detail: string | null;
  deadline_viable: boolean | null;
  min_days_needed: number | null;
  suggested_date: string | null;
  responsible: "eduardo" | "larissa" | "joao" | "beatriz" | null;
  is_production_job: boolean;
  // Regra 1 + Regra 3: blocks subtask creation until clarified
  needs_clarification: boolean;
  // Regra 2: range adjusted to minimum, informational only
  static_range_adjusted: StaticRangeAdjustment | null;
  subtasks: SubtaskDef[];
  comment: string | null;
}

function buildAnalysisPrompt(todayStr: string, duedate: string | null, workDaysAvailable: number | null): string {
  return `Você é o agente de análise de briefings do time de Brand Creative da Nuvemshop.

ESTIMATIVA DE PRAZO (dias úteis mínimos por tipo):
- Peça estática (post, banner, card, story): 1 dia útil cada; 5+ peças = mínimo 3 dias
- Motion/animação (até 30s): 2 dias úteis cada
- Vídeo produção completa: 5 dias úteis
- Edição de vídeo: 2 dias úteis cada
- Copy simples: 0.5 dia por peça
- Apresentação/deck: 2 dias úteis
- Pacote misto: somar os tempos individuais

RESPONSÁVEL POR TIPO:
- "eduardo" → performance, anúncios, growth, ads, banners digitais
- "larissa" → motion, vídeo, animação, edição
- "joao" → sinalização, eventos, stands, product demo
- "beatriz" → copy, texto, conteúdo escrito

JOB DE PRODUÇÃO (is_production_job=true):
Execução de peças — animações, motion, edição de vídeo, artes de campanha, banners, posts,
stories, material rico, ebooks, peças para eventos, templates, media kits, battle cards,
adaptações, desdobramentos, lifecycle campanhas.

JOB NÃO DE PRODUÇÃO (is_production_job=false):
Estratégia, conceito novo, planejamento, brand identity, copy estratégica.

REGRA — VÍDEOS EM MÚLTIPLOS FORMATOS:
Se o briefing pedir vídeos em múltiplos formatos (ex: 16:9, 1:1, 9:16, 4:5, vertical, horizontal),
defina needs_clarification=true e subtasks=[].
No campo "comment" escreva EXATAMENTE:
"Os vídeos precisam ter conteúdo diferente para cada formato, ou podemos adaptar o mesmo vídeo nos [formatos mencionados]?"

REGRA — RANGE DE QUANTIDADE (ESTÁTICOS):
Se o briefing usar range de quantidade ("3 a 5 peças", "4 a 6 cards", "entre 2 e 4"), use sempre
o número menor. Defina static_range_adjusted com os valores e continue normalmente (não bloqueia).
Nunca pergunte — já decide pelo mínimo.

REGRA — MÚLTIPLAS VARIAÇÕES DE FORMATO (ESTÁTICOS):
Se o briefing pedir quantidade POR formato (ex: "3 paisagem + 3 quadrada + 3 retrato",
"2 banner 1200×628 + 2 banner 1200×1200"), calcule o total e defina needs_clarification=true
e subtasks=[]. No campo "comment" escreva EXATAMENTE:
"O briefing pede [total] peças no total ([N] por formato). Podemos criar [base count] artes base e desdobrar nos [X] formatos? Ou cada formato precisa de composição visual diferente?"

CRIAÇÃO DE SUBTASKS (só quando briefing OK E needs_clarification=false):
Identifique as subtasks necessárias com base no briefing.

Regra do nome_curto:
- Título curto e claro → usa em maiúsculas (ex: "LUMI MERCHANTS")
- Título longo ou confuso → resume o briefing em máximo 2 palavras em maiúsculas
  Ex: "Assets para ComEcomm Ribeirão Preto - Nuvem Envio" → "COMECOMM MANDAÊ"

Tipos de subtasks e agrupamento:
- COPY → 1 subtask única para todos os textos
- LAYOUT ESTÁTICOS → 1 subtask única para todos os estáticos
- LAYOUT VÍDEOS → 1 subtask única para todos os layouts de vídeo
- MOTION VIDEO A / MOTION VIDEO B → 1 subtask por vídeo com mensagem diferente
  (mesmo vídeo em 9x16 + 4x5 = 1 subtask só; mensagem A + mensagem B = 2 subtasks)

Se has_issues=true ou needs_clarification=true, retorne subtasks=[].

Hoje: ${todayStr}
${duedate
    ? `Prazo solicitado: ${duedate} (${workDaysAvailable} dias úteis disponíveis)`
    : "Prazo: não informado"}

Responda SOMENTE com JSON válido, sem texto antes ou depois:
{
  "has_issues": boolean,
  "missing_objective": boolean,
  "piece_count_mismatch": { "found": boolean, "mentioned": number, "detailed": number } | null,
  "missing_specs": boolean,
  "missing_specs_detail": string | null,
  "deadline_viable": boolean | null,
  "min_days_needed": number | null,
  "suggested_date": "YYYY-MM-DD" | null,
  "responsible": "eduardo" | "larissa" | "joao" | "beatriz" | null,
  "is_production_job": boolean,
  "needs_clarification": boolean,
  "static_range_adjusted": { "original_min": number, "original_max": number, "using": number } | null,
  "subtasks": [{ "nome_curto": string, "entrega": string }],
  "comment": string | null
}

Regras para "comment":
- null se o briefing estiver perfeito (sem issues, sem clarificações, prazo viável)
- Liste TODOS os problemas encontrados, numerados
- Se piece_count_mismatch: use EXATAMENTE "Você mencionou X peças mas só detalhamos Y. Preciso do detalhamento das Z restantes."
- Se prazo inviável: "Com [N] peças sendo [tipo], precisamos de mínimo X dias úteis. Prazo mínimo viável: [data]. Pode ajustar?"
- Se needs_clarification: veja as regras acima para o texto exato`;
}

// --- Route handler ---

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const issue = payload.issue;
    if (!issue) return NextResponse.json({ skipped: "no issue in payload" });

    const issueKey = issue.key as string;
    const fields = issue.fields as Record<string, unknown>;
    const project = (process.env.JIRA_PROJECT_KEY?.trim() || "BDSL");
    const reporter = fields.reporter as { displayName?: string; emailAddress?: string } | null;

    // Step 1 — ignore internal team
    if (reporter && isInternalUser(reporter)) {
      return NextResponse.json({ skipped: "internal", reporter: reporter?.displayName });
    }

    const summary = (fields.summary as string) ?? "";
    const description = extractDescription(fields.description);
    const duedate = (fields.duedate as string) ?? null;

    // Step 2 — detect presentation request
    if (isPresentation(summary, description)) {
      const msg =
        "Apresentações: atualmente só revisamos copy e melhoramos visual. " +
        "Precisamos da apresentação no template da Nuvemshop já com conteúdo completo.";
      const commented = await postJiraComment(issueKey, msg);
      return NextResponse.json({ issueKey, commented, stage: "presentation" });
    }

    // Step 3 — analyze briefing with Claude
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const workDaysAvailable = duedate ? countWorkDays(today, new Date(duedate)) : null;

    const analysisRaw = await callClaude(
      buildAnalysisPrompt(todayStr, duedate, workDaysAvailable),
      `Analise este briefing:\n\nTítulo: ${summary}\n\nDescrição:\n${description || "(sem descrição)"}${duedate ? `\n\nPrazo: ${duedate}` : ""}`
    );

    const jsonMatch = analysisRaw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude returned no JSON");
    const analysis: BriefingAnalysis = JSON.parse(jsonMatch[0]);

    // Step 4a — briefing has issues → post comment and stop
    if (analysis.has_issues && analysis.comment) {
      const commented = await postJiraComment(issueKey, analysis.comment);
      return NextResponse.json({ issueKey, commented, stage: "briefing_issues", analysis });
    }

    // Step 4b — needs clarification (video formats or static format variations)
    //            → post question and stop, no subtasks created
    if (analysis.needs_clarification && analysis.comment) {
      const commented = await postJiraComment(issueKey, analysis.comment);
      return NextResponse.json({ issueKey, commented, stage: "pending_clarification", analysis });
    }

    // Step 4c — static range adjusted (Rule 2): post informational comment and continue
    if (analysis.static_range_adjusted) {
      const { original_min, original_max, using } = analysis.static_range_adjusted;
      const rangeMsg =
        `Consideramos ${using} peças (mínimo do range indicado de ${original_min} a ${original_max}). ` +
        `Se precisar do máximo, nos avise.`;
      await postJiraComment(issueKey, rangeMsg);
    }

    // Step 5 — briefing OK → create subtasks
    const createdSubtasks: Array<{ key: string | null; summary: string }> = [];
    if (analysis.subtasks?.length) {
      for (const st of analysis.subtasks) {
        const stSummary = `${st.nome_curto} | ${st.entrega}`;
        const key = await createSubtask(issueKey, stSummary, project);
        createdSubtasks.push({ key, summary: stSummary });
      }
    }

    // Step 6 — check team capacity → possibly suggest Monstra
    const eligibleForMonstra =
      !analysis.has_issues &&
      analysis.deadline_viable !== false &&
      !!analysis.responsible &&
      analysis.is_production_job;

    if (eligibleForMonstra) {
      const hoursMap = await getTeamHours();

      let memberName: string | undefined;
      let memberHours = 0;
      for (const [name, hours] of hoursMap) {
        if (normalize(name).split(" ")[0] === analysis.responsible) {
          memberName = name;
          memberHours = hours;
          break;
        }
      }

      if (memberName) {
        const pct = capacityPercent(memberName, memberHours);
        if (pct > 80) {
          const firstName = memberName.split(" ")[0];
          const monstraComment =
            `⚠️ Atenção @thais.boaventura: ${firstName} está com a pauta cheia nesse período (${pct}% da capacidade). ` +
            `Esse job pode ser candidato para a Monstra (rafaela.ceragioli). ` +
            `Tipos de job que a Monstra já executou: animações, edição de vídeo, artes de campanha, ` +
            `material rico, templates, peças para eventos, adaptações e desdobramentos.`;

          const commented = await postJiraComment(issueKey, monstraComment);
          return NextResponse.json({
            issueKey,
            commented,
            stage: "monstra_suggestion",
            responsible: memberName,
            capacityPct: pct,
            subtasksCreated: createdSubtasks,
          });
        }
      }
    }

    return NextResponse.json({
      issueKey,
      stage: "ok",
      message: "Briefing completo, prazo viável, capacidade disponível.",
      subtasksCreated: createdSubtasks,
      analysis,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[briefing-agent]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
