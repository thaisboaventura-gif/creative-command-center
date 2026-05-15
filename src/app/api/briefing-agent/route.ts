import { NextResponse } from "next/server";
import { estimateHours } from "@/lib/estimate";
import { sendSlackAlert } from "@/lib/slack";

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

// Tries each country candidate field until one works.
// Same approach as nova-demanda route — reliable regardless of env var.
const COUNTRY_CANDIDATES_AGENT = ["customfield_15854", "customfield_21359", "customfield_10670"];

async function forceSetCountry(base: string, auth: string, issueKey: string): Promise<void> {
  const url = `${base.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}`;
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  for (const field of COUNTRY_CANDIDATES_AGENT) {
    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ fields: { [field]: [{ value: "Brasil" }] } }),
    });
    if (res.ok) {
      console.log(`[briefing-agent] forceSetCountry ✅ ${field} on ${issueKey}`);
      return;
    }
  }
  console.warn(`[briefing-agent] forceSetCountry failed for ${issueKey}`);
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

const RESPONSIBLE_DISPLAY: Record<string, string> = {
  eduardo: "Eduardo",
  larissa: "Larissa",
  joao:    "João",
  beatriz: "Beatriz",
};

function buildFriendlyADF(
  accountId: string | null,
  bodyText: string,
  isCopyRelated: boolean,
  responsible?: string | null
): object[] {
  const nodes: object[] = [];

  // First line: responsible team member (when known)
  if (responsible && RESPONSIBLE_DISPLAY[responsible]) {
    nodes.push({
      type: "paragraph",
      content: [{ type: "text", text: `Responsável: ${RESPONSIBLE_DISPLAY[responsible]} 🎯`, marks: [{ type: "strong" }] }],
    });
  }

  // Greeting with mention
  nodes.push({
    type: "paragraph",
    content: accountId
      ? [
          { type: "text", text: "Olá, " },
          { type: "mention", attrs: { id: accountId } },
          { type: "text", text: "! 👋" },
        ]
      : [{ type: "text", text: "Olá! 👋" }],
  });

  // Context line
  nodes.push({
    type: "paragraph",
    content: [{ type: "text", text: "Analisamos seu briefing e verificamos que faltam algumas informações. Consegue nos ajudar? 🙏" }],
  });

  // Main body — split by lines
  for (const line of bodyText.split("\n")) {
    if (line.trim()) {
      nodes.push({ type: "paragraph", content: [{ type: "text", text: line }] });
    }
  }

  // Copy tip
  if (isCopyRelated) {
    nodes.push({
      type: "paragraph",
      content: [{ type: "text", text: "📝 Para agilizar, recomendamos criar um direcionamento de copy usando nosso agente: https://gemini.google.com/u/0/gem/db916d4624fc" }],
    });
  }

  // Closing
  nodes.push({
    type: "paragraph",
    content: [{ type: "text", text: "Qualquer dúvida, é só chamar! 😊" }],
  });

  // AI disclaimer
  nodes.push({
    type: "paragraph",
    content: [{ type: "text", text: "---" }],
  });
  nodes.push({
    type: "paragraph",
    content: [{ type: "text", text: "📌 Esta mensagem foi gerada por um agente de IA. Precisamos de todas essas informações para abrir o briefing e distribuir as subtasks corretamente. Obrigada! 😊" }],
  });

  return nodes;
}

async function postFriendlyComment(
  issueKey: string,
  accountId: string | null,
  bodyText: string,
  isCopyRelated = false,
  responsible?: string | null
): Promise<boolean> {
  const { base, auth } = getJiraAuth();
  if (!base) return false;

  const content = buildFriendlyADF(accountId, bodyText, isCopyRelated, responsible);

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

// --- Fetch issue comments ---

interface JiraComment {
  author: { displayName?: string };
  body: unknown;
}

function extractADFText(body: unknown): string {
  if (!body) return "";
  if (typeof body === "string") return body;
  try {
    const doc = body as { content?: Array<{ content?: Array<{ text?: string }> }> };
    return (doc.content ?? [])
      .flatMap((block) => block.content?.map((n) => n.text || "") ?? [])
      .filter(Boolean)
      .join(" ");
  } catch {
    return JSON.stringify(body).slice(0, 500);
  }
}

async function fetchIssueComments(issueKey: string): Promise<Array<{ author: string; text: string }>> {
  const { base, auth } = getJiraAuth();
  if (!base) return [];
  try {
    const res = await fetch(
      `${base}/rest/api/3/issue/${issueKey}/comment?maxResults=50&orderBy=created`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.comments as JiraComment[] ?? []).map((c) => ({
      author: c.author?.displayName || "desconhecido",
      text: extractADFText(c.body),
    }));
  } catch {
    return [];
  }
}

// --- Fetch Google Doc content ---

const GDOC_REGEX = /docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/;

async function fetchGoogleDocContent(text: string): Promise<string | null> {
  const match = text.match(GDOC_REGEX);
  if (!match) return null;
  const docId = match[1];
  try {
    const res = await fetch(
      `https://docs.google.com/document/d/${docId}/export?format=txt`,
      { redirect: "follow" }
    );
    if (!res.ok) {
      console.log(`Google Doc fetch failed: ${res.status} — assuming edit-only job`);
      return null;
    }
    const txt = await res.text();
    return txt.slice(0, 8000); // cap to avoid huge tokens
  } catch (e) {
    console.log(`Google Doc fetch error: ${e} — assuming edit-only job`);
    return null;
  }
}

function detectCartela(docText: string): boolean {
  const lower = docText.toLowerCase();
  const cartelaKeywords = ["cartela", "insert", "texto na tela", "letreiro", "lower third", "grafismo"];
  const editOnlyKeywords = ["corte", "edição", "edicao", "legenda", "ajuste", "montagem"];
  const hasCartela = cartelaKeywords.some((k) => lower.includes(k));
  const editOnly = editOnlyKeywords.some((k) => lower.includes(k)) && !hasCartela;
  return hasCartela && !editOnly;
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
  const key = data.key as string;

  // Always set Country = Brasil on each subtask
  try { await forceSetCountry(base, auth, key); } catch { /* non-fatal */ }

  return key;
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
  // blocks subtask creation until clarified
  needs_clarification: boolean;
  // range adjusted to minimum, informational only
  static_range_adjusted: StaticRangeAdjustment | null;
  // Regra 3: textos auxiliares Meta/Google/CTAs variados detectados — NÃO bloqueia
  has_auxiliary_texts: boolean;
  subtasks: SubtaskDef[];
  comment: string | null;
}

function buildAnalysisPrompt(todayStr: string, duedate: string | null, workDaysAvailable: number | null): string {
  return `Você é o agente de análise de briefings do time de Brand Creative da Nuvemshop.

═══════════════════════════════════════
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

═══════════════════════════════════════
REGRA 1 — VOLUME DE PEÇAS
Só questionar se o número declarado NÃO bater com as dimensões/specs descritas.

✅ Questionar:
  Briefing diz "6 peças" mas descreve "4:5 + 9:16, estático + vídeo cada"
  → 2 formatos × 2 tipos = 4 peças, não 6
  → needs_clarification=true
  → comment EXATAMENTE: "Você mencionou X peças mas só detalhamos Y. Preciso do detalhamento das Z restantes."

❌ NÃO questionar:
  Briefing diz "6 estáticos em 4:5 e 9:16" e descreve exatamente 6 peças
  → Contagem bate → não perguntar

═══════════════════════════════════════
REGRA 2 — MENSAGEM PRINCIPAL / CONCEITO
Quando o briefing NÃO tiver direcionamento claro de mensagem principal:

→ needs_clarification=true
→ No campo "comment": dê 3 sugestões de conceito baseadas no contexto do briefing.
  Formato EXATO do comment:
  "Analisamos seu briefing. Temos algumas sugestões:

  Mensagem principal: Baseado no contexto [resumo do contexto], algumas opções de conceito:
  - [Sugestão 1]
  - [Sugestão 2]
  - [Sugestão 3]

  Qual dessas faz mais sentido ou prefere outro caminho?

  Ou crie um direcionamento completo com nosso agente: https://gemini.google.com/u/0/gem/db916d4624fc"

ATENÇÃO — "mensagem principal" é O QUE o criativo comunica (headline, conceito visual, proposta).
NÃO confundir com textos auxiliares (Regra 3 abaixo).

═══════════════════════════════════════
REGRA 3 — TEXTOS AUXILIARES (Meta, Google, legendas, CTAs variados)
Quando o briefing pedir textos auxiliares de campanhas:
  - "3 textos principais + 3 títulos + 1 descrição" (Meta Ads)
  - "Até 5 títulos + 5 descrições" (Google)
  - "Legendas para vídeo"
  - "CTAs variados" (múltiplas opções de CTA para A/B)
  - "Copies" de e-mail/in-app de lifecycle/retention

→ NÃO definir needs_clarification=true por causa desses textos
→ NÃO abrir pergunta sobre esses textos
→ Definir has_auxiliary_texts=true
→ No campo "comment": "Para textos auxiliares, damos autonomia para a área. Recomendamos criar com nosso agente: https://gemini.google.com/u/0/gem/db916d4624fc ✅"
→ Criar as subtasks normalmente (não bloquear)

CASO MISTO — briefing pede MENSAGEM PRINCIPAL + textos auxiliares:
→ Perguntar APENAS sobre a mensagem principal (Regra 2)
→ Incluir no mesmo "comment" o aviso sobre textos auxiliares (Regra 3)
→ needs_clarification=true (bloqueia até ter a mensagem principal)
→ has_auxiliary_texts=true

ATENÇÃO — "copies" de lifecycle/retention (e-mail, in-app) = textos auxiliares.
O time tem autonomia para criar esses textos. Não bloquear.

═══════════════════════════════════════
REGRA 4 — CONTEXTO D2C SUMMIT
Quando o briefing mencionar "D2C Summit", "D2C", "Summit":
→ O time já conhece o evento — NÃO pedir contexto sobre o que é
→ Só validar specs técnicas (dimensões), volume de peças e prazo

═══════════════════════════════════════
REGRA 5 — PÚBLICOS / SEGMENTAÇÃO / VARIAÇÕES DE PLATAFORMA
Quando briefing mencionar:
  - "Públicos Google"
  - "Até 5 títulos", "até 5 descrições"
  - "Variações para teste"
  - Slots de texto que a plataforma permite

→ São capacidades técnicas da plataforma, NÃO direcionamento de copy
→ NÃO definir needs_clarification=true por causa desses itens

═══════════════════════════════════════
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

REGRA — COPY ESTRATÉGICA (NÃO auxiliar):
Aplique APENAS quando o job envolver mensagem principal/conceito criativo (NÃO textos auxiliares):

1. MENSAGEM: Se mencionar "conceitos", "ângulos" ou "temas" sem descrever o que cada um diz:
   → Aplicar Regra 2 (dar 3 sugestões + needs_clarification=true)

2. DADOS: Se mencionar números ou cases sem dizer em qual peça usar:
   → needs_clarification=true
   → comment: "Quais dados vão em quais peças? Ex: Conceito 1 usa '+180 mil marcas', Conceito 2 usa case X."

3. CTA (APENAS para ads/performance sem CTA declarado):
   → needs_clarification=true
   → comment: "Qual o CTA? Trial gratuito, fale com vendas ou outro?"
   ATENÇÃO: "CTAs variados" como deliverable = textos auxiliares (Regra 3) → não bloquear.
   Só perguntar se o CTA está COMPLETAMENTE ausente em um briefing de ads/performance.

PADRÃO DE BRIEFING INSUFICIENTE (detectar ativamente):
- Fala em "X conceitos" ou "X ângulos" sem descrever o que cada um comunica
- Lista dados, cases ou números sem dizer qual vai em qual peça
- Muito contexto de estratégia/mercado, zero direção de execução por peça
Se o briefing tem esse padrão → needs_clarification=true.
Quantidade de informação não é qualidade de briefing.
Máximo 3 perguntas. Diretas.

═══════════════════════════════════════
REGRA — PEÇAS BÁSICAS DE BRAND DESIGN (não pedir dimensões):
As peças abaixo têm dimensões padrão conhecidas — NUNCA pedir specs delas:

| Peça                    | Dimensão padrão              |
|-------------------------|------------------------------|
| Header de e-mail        | 600×300px                    |
| Footer de e-mail        | 600×100px                    |
| In-app / slideout       | 600×600px                    |
| Banner web fixo         | 600×120px ou 728×90px        |
| Banner lateral          | 300×600px                    |
| Assinatura de e-mail    | 600×150px                    |
| Avatar / profile pic    | 400×400px                    |
| Cover / capa            | 1584×396px                   |
| Story highlight cover   | 1080×1920px (círculo 161px)  |

LÓGICA DE VALIDAÇÃO DE SPECS:
1. Separar as peças em dois grupos:
   - Grupo A: peças da lista acima → dimensões já conhecidas, OK
   - Grupo B: todas as outras peças (banners Meta, display, OOH, etc.)
2. Validar specs APENAS do Grupo B
3. Se Grupo B tiver peças sem dimensões:
   → missing_specs=true, missing_specs_detail lista SÓ as peças do Grupo B sem specs
4. Se todas as peças forem do Grupo A:
   → missing_specs=false, não mencionar nada sobre dimensões

═══════════════════════════════════════
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

ATENÇÃO — has_auxiliary_texts=true NÃO impede criação de subtasks.
Textos auxiliares (Regra 3) não geram subtask de COPY — o time cria com autonomia.
Gera subtask de COPY APENAS para copy estratégica/mensagem principal.

Se has_issues=true ou needs_clarification=true, retorne subtasks=[].

═══════════════════════════════════════
EXEMPLOS REAIS

EXEMPLO 1 — Briefing Elo7 (mensagem principal ausente + textos auxiliares):
Briefing: contexto Elo7 fechando, specs Meta (2 estáticos + 2 vídeos, 4:5 e 9:16) + textos Meta
("3 Texto Principal + 3 Título + 1 Descrição") + Google Demand Gen (21 imagens + vídeos) +
textos Google ("Até 5 títulos + Até 5 descrições").

Análise correta:
- Volume: 2 est Meta + 2 vid Meta + 21 img Google + vídeos Google ✅ bate
- Mensagem principal: NÃO definida → Regra 2 (dar sugestões, needs_clarification=true)
- Textos Meta + Google: textos auxiliares → Regra 3 (has_auxiliary_texts=true, avisar Gemini)
- "Públicos Google": Regra 5 → ignorar
- Resultado: needs_clarification=true, has_auxiliary_texts=true, subtasks=[]

Comment correto (formato exato):
"Analisamos seu briefing. Temos algumas sugestões:

Mensagem principal: Baseado no contexto da Elo7 fechando, algumas opções de conceito:
- Da Elo7 pra Nuvemshop: sua loja continua
- Seu artesanato merece uma casa própria
- 130 mil artesãos precisam de uma nova plataforma

Qual dessas faz mais sentido ou prefere outro caminho?

Ou crie um direcionamento completo com nosso agente: https://gemini.google.com/u/0/gem/db916d4624fc

Para textos auxiliares (Meta e Google), damos autonomia para a área. Recomendamos criar com nosso agente: https://gemini.google.com/u/0/gem/db916d4624fc ✅"

---

EXEMPLO 2 — Briefing D2C Summit Lifecycle (copies de e-mail + artes):
Briefing: "[D2C Summit] Lifecycle | Artes e copy Lote 2. Solicito os criativos para a virada de lote.
Foco: ROI e Crescimento. CTA: Garantir preço exclusivo.
COPIES: E-mail 01, 02, 03 + In-app 01, 02, 03.
ARTES: 2 variações header e-mail + 2 variações in-app slideout + 1 banner fixo."

Análise correta:
- D2C Summit: contexto conhecido → Regra 4, não pedir sobre o evento ✅
- Copies (e-mail + in-app): textos auxiliares de lifecycle → Regra 3 (has_auxiliary_texts=true)
- Artes (headers, in-apps, banner): peças básicas de brand design → specs padrão conhecidas ✅
- Mensagem principal: definida ("ROI e Crescimento", CTA declarado) → não precisa perguntar
- Resultado: has_issues=false, needs_clarification=false, has_auxiliary_texts=true
- Subtasks criadas: LAYOUT ESTÁTICOS (headers + in-apps + banner)

Comment correto:
"Para textos auxiliares, damos autonomia para a área. Recomendamos criar com nosso agente: https://gemini.google.com/u/0/gem/db916d4624fc ✅"

═══════════════════════════════════════
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
  "has_auxiliary_texts": boolean,
  "subtasks": [{ "nome_curto": string, "entrega": string }],
  "comment": string | null
}

Regras para "comment":
- null se briefing perfeito E sem textos auxiliares (sem issues, sem clarificações, prazo viável)
- Se needs_clarification=true: lista TODOS os problemas, numerados
- Se piece_count_mismatch: EXATAMENTE "Você mencionou X peças mas só detalhamos Y. Preciso do detalhamento das Z restantes."
- Se prazo inviável: "Com [N] peças sendo [tipo], precisamos de mínimo X dias úteis. Prazo mínimo viável: [data]. Pode ajustar?"
- Se has_auxiliary_texts=true e needs_clarification=false: "Para textos auxiliares, damos autonomia para a área. Recomendamos criar com nosso agente: https://gemini.google.com/u/0/gem/db916d4624fc ✅"
- Se has_auxiliary_texts=true E needs_clarification=true: inclua AMBOS no comment (pergunta sobre mensagem + aviso textos auxiliares)`;
}

// --- Route handler ---

export async function POST(req: Request) {
  try {
    // Kill switch — pause agent via environment variable
    if (process.env.AGENT_PAUSED === "true") {
      return NextResponse.json({ paused: true, message: "Agent is paused" });
    }

    const payload = await req.json();

    // Support both issue_created and comment_created webhook events
    const webhookEvent: string = payload.webhookEvent || "";
    let issue = payload.issue;

    // For comment events, skip if the commenter is our bot (avoid infinite loops)
    if (webhookEvent === "comment_created" || webhookEvent === "comment_updated") {
      const commenterEmail: string = payload.comment?.author?.emailAddress || "";
      const botEmail = process.env.JIRA_EMAIL?.trim() || "";
      if (commenterEmail === botEmail) {
        return NextResponse.json({ skipped: "bot_comment" });
      }
    }

    if (!issue) return NextResponse.json({ skipped: "no issue in payload" });

    const issueKey = issue.key as string;
    const fields = issue.fields as Record<string, unknown>;

    // Country filter — only process Brasil tickets
    const COUNTRY_FIELDS_AGENT = ["customfield_21359", "customfield_15854", "customfield_10670"];
    const hasAnyCountry = COUNTRY_FIELDS_AGENT.some((f) => fields[f]);
    if (hasAnyCountry) {
      const countryStr = COUNTRY_FIELDS_AGENT.map((f) => JSON.stringify(fields[f] ?? "").toLowerCase()).join(" ");
      const isBrasil = countryStr.includes("brasil") || countryStr.includes("brazil");
      if (!isBrasil) {
        return NextResponse.json({ skipped: "country", issueKey, country: countryStr.slice(0, 100) });
      }
    }
    const project = (process.env.JIRA_PROJECT_KEY?.trim() || "BDSL");
    const reporter = fields.reporter as { displayName?: string; emailAddress?: string; accountId?: string } | null;

    // Step 1 — ignore internal team
    if (reporter && isInternalUser(reporter)) {
      return NextResponse.json({ skipped: "internal", reporter: reporter?.displayName });
    }

    const summary = (fields.summary as string) ?? "";
    const description = extractDescription(fields.description);
    const duedate = (fields.duedate as string) ?? null;
    const jiraLink = `${process.env.JIRA_BASE_URL?.trim() || ""}/browse/${issueKey}`;
    const solicitante = reporter?.displayName || "desconhecido";
    const reporterAccountId = reporter?.accountId || null;

    // Detect copy-related job
    const copyKeywords = ["copy", "texto", "conteúdo", "conteudo", "caption", "legenda"];
    const isCopyJob = (text: string) =>
      copyKeywords.some((k) => text.toLowerCase().includes(k));

    // Step 2 — detect presentation request
    if (isPresentation(summary, description)) {
      const msg =
        "Sim, podemos fazer revisão de apresentações e melhorias visuais!\n\n" +
        "Para agilizar o processo, precisamos que o conteúdo já esteja estruturado em Google Slides. " +
        "Assim conseguimos focar na parte visual e de brand design.\n\n" +
        "Pode compartilhar o link do slide com o conteúdo? 😊";
      await postFriendlyComment(issueKey, reporterAccountId, msg);
      await sendSlackAlert(
        `🗂️ *Briefing novo:* ${summary}\n` +
        `Solicitante: ${solicitante}\n` +
        `⚠️ É uma apresentação — respondido com instrução de template.\n` +
        `🔗 ${jiraLink}`
      );
      return NextResponse.json({ issueKey, stage: "presentation" });
    }

    // Step 3 — enrich context: fetch comments + Google Doc
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const workDaysAvailable = duedate ? countWorkDays(today, new Date(duedate)) : null;

    // 3a — fetch all existing comments
    const issueComments = await fetchIssueComments(issueKey);
    const commentsContext = issueComments.length
      ? "\n\nComentários anteriores no ticket:\n" +
        issueComments.map((c, i) => `[${i + 1}] ${c.author}: "${c.text}"`).join("\n")
      : "";

    // 3b — fetch Google Doc if linked
    const fullText = `${description} ${commentsContext}`;
    const docContent = await fetchGoogleDocContent(fullText);
    const docContext = docContent
      ? `\n\nConteúdo do Google Doc vinculado:\n${docContent}`
      : "";
    const hasCartelaInDoc = docContent ? detectCartela(docContent) : false;

    const userPrompt =
      `Analise este briefing:\n\nTítulo: ${summary}\n\nDescrição:\n${description || "(sem descrição)"}` +
      (duedate ? `\n\nPrazo: ${duedate}` : "") +
      commentsContext +
      docContext +
      (docContent && !hasCartelaInDoc ? "\n\n[Doc analisado: sem cartelas — job é só edição/motion direto]" : "") +
      (hasCartelaInDoc ? "\n\n[Doc analisado: contém cartelas — criar subtask CARTELA (Eduardo) antes do MOTION (Larissa)]" : "") +
      (!docContent && fullText.match(GDOC_REGEX) ? "\n\n[Google Doc vinculado não acessível — assumir job de edição/motion direto]" : "");

    const analysisRaw = await callClaude(
      buildAnalysisPrompt(todayStr, duedate, workDaysAvailable),
      userPrompt
    );

    const jsonMatch = analysisRaw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude returned no JSON");
    const analysis: BriefingAnalysis = JSON.parse(jsonMatch[0]);

    // Step 4a — briefing has issues → post comment, notify Slack and stop
    if (analysis.has_issues && analysis.comment) {
      const copyRelated = analysis.responsible === "beatriz" || analysis.missing_objective || isCopyJob(`${summary} ${description}`);
      await postFriendlyComment(issueKey, reporterAccountId, analysis.comment, copyRelated, analysis.responsible);
      await sendSlackAlert(
        `🗂️ *Briefing novo:* ${summary}\n` +
        `Solicitante: ${solicitante}\n` +
        `❌ Briefing incompleto — pedi informações no Jira.\n` +
        `🔗 ${jiraLink}`
      );
      return NextResponse.json({ issueKey, stage: "briefing_issues", analysis });
    }

    // Step 4b — needs clarification → post question, notify Slack and stop
    if (analysis.needs_clarification && analysis.comment) {
      const copyRelated = analysis.responsible === "beatriz" || analysis.missing_objective || isCopyJob(`${summary} ${description}`);
      await postFriendlyComment(issueKey, reporterAccountId, analysis.comment, copyRelated, analysis.responsible);
      await sendSlackAlert(
        `🗂️ *Briefing novo:* ${summary}\n` +
        `Solicitante: ${solicitante}\n` +
        `❓ Precisa de esclarecimento — fiz pergunta no Jira.\n` +
        `🔗 ${jiraLink}`
      );
      return NextResponse.json({ issueKey, stage: "pending_clarification", analysis });
    }

    // Step 4c — static range adjusted: post informational comment and continue
    if (analysis.static_range_adjusted) {
      const { original_min, original_max, using } = analysis.static_range_adjusted;
      await postFriendlyComment(
        issueKey,
        reporterAccountId,
        `Consideramos ${using} peças (mínimo do range indicado de ${original_min} a ${original_max}). Se precisar do máximo, nos avise.`
      );
    }

    // Step 4d — auxiliary texts detected and briefing not blocked → post Gemini informational comment
    if (analysis.has_auxiliary_texts && !analysis.has_issues && !analysis.needs_clarification && analysis.comment) {
      await postFriendlyComment(issueKey, reporterAccountId, analysis.comment);
    }

    // Step 5 — briefing OK → set Country=Brasil on parent, then create subtasks
    const { base: jiraBase, auth: jiraAuth } = getJiraAuth();
    try { await forceSetCountry(jiraBase, jiraAuth, issueKey); } catch { /* non-fatal */ }

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
            `material rico, templates, peças para eventos, adaptações e desdobramentos.\n\n` +
            `---\n📌 Esta mensagem foi gerada por um agente de IA. Precisamos de todas essas informações para abrir o briefing e distribuir as subtasks corretamente. Obrigada! 😊`;

          await postJiraComment(issueKey, monstraComment);
          await sendSlackAlert(
            `🗂️ *Briefing novo:* ${summary}\n` +
            `Solicitante: ${solicitante}\n` +
            `✅ Briefing completo — subtasks criadas.\n` +
            `⚠️ ${firstName} está com ${pct}% da capacidade — sugeri Monstra no Jira.\n` +
            `🔗 ${jiraLink}`
          );
          return NextResponse.json({
            issueKey,
            stage: "monstra_suggestion",
            responsible: memberName,
            capacityPct: pct,
            subtasksCreated: createdSubtasks,
          });
        }
      }
    }

    // Step 7 — all good, notify Slack
    await sendSlackAlert(
      `🗂️ *Briefing novo:* ${summary}\n` +
      `Solicitante: ${solicitante}\n` +
      `✅ Briefing completo — subtasks criadas${createdSubtasks.length ? `: ${createdSubtasks.map(s => s.summary).join(", ")}` : ""}.\n` +
      `🔗 ${jiraLink}`
    );

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
