import { NextResponse } from "next/server";
import { sendSlackAlert } from "@/lib/slack";

export const dynamic = "force-dynamic";

const JIRA_BASE = () => process.env.JIRA_BASE_URL?.trim() || "";
const JIRA_AUTH = () => {
  const email = process.env.JIRA_EMAIL?.trim() || "";
  const token = process.env.JIRA_API_TOKEN?.trim() || "";
  return Buffer.from(`${email}:${token}`).toString("base64");
};
const PROJECT = () => process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";

interface DemandaBody {
  titulo: string;
  tipos: string[];
  descricao: string;
  prazo: string;
  solicitante: string;
  quemSolicitou?: string;
  apoio?: string;
}

export interface SubtaskResult {
  tipo: string;
  label: string;
  assignee: string;
  estimatedHours: number;
  key: string | null;
}

// Maps UI label → internal key
const TIPO_MAP: Record<string, string> = {
  "Anúncio/Performance":     "anuncio_performance",
  "Sinalização/Evento":      "sinalizacao_evento",
  "Motion/Vídeo":            "motion_video",
  "Copy":                    "copy",
  "Produto/Demo":            "produto_demo",
  "Desdobramento/Adaptação": "desdobramento",
};

// Maps internal key → subtask label shown in Jira
const SUBTASK_LABEL: Record<string, string> = {
  anuncio_performance: "LAYOUT ESTÁTICOS",
  sinalizacao_evento:  "SINALIZAÇÃO",
  motion_video:        "MOTION",
  copy:                "COPY",
  produto_demo:        "PRODUTO/DEMO",
  desdobramento:       "DESDOBRAMENTO",
};

const TEAM_RULES: Record<string, { assignee: string; accountHint: string }> = {
  anuncio_performance: { assignee: "Eduardo", accountHint: "eduardo" },
  sinalizacao_evento:  { assignee: "João",    accountHint: "joao" },
  motion_video:        { assignee: "Larissa", accountHint: "larissa" },
  copy:                { assignee: "Beatriz", accountHint: "beatriz" },
  produto_demo:        { assignee: "João",    accountHint: "joao" },
  desdobramento:       { assignee: "Rafa",    accountHint: "rafa" },
};

// Default hour estimates per type (used as fallback without Claude)
const DEFAULT_HOURS: Record<string, number> = {
  anuncio_performance: 4,
  sinalizacao_evento:  4,
  motion_video:        6,
  copy:                2,
  produto_demo:        3,
  desdobramento:       2,
};

const CAPACITY: Record<string, number> = {
  eduardo: 13.5,
  joao:    5.5,
  beatriz: 5.5,
  larissa: 13.5,
  rafa:    8,
};

function countWorkDays(from: Date, to: Date): number {
  let count = 0;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

async function findAccountId(base: string, auth: string, hint: string): Promise<string | null> {
  try {
    const url = `${base}/rest/api/3/user/search?query=${encodeURIComponent(hint)}&maxResults=5`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const users = await res.json();
    if (Array.isArray(users) && users.length > 0) return users[0].accountId;
    return null;
  } catch {
    return null;
  }
}

const COUNTRY_CANDIDATES = ["customfield_21359", "customfield_15854", "customfield_10670"];

async function createJiraIssue(
  base: string,
  auth: string,
  project: string,
  summary: string,
  description: string,
  duedate: string,
  accountId: string | null,
  parentKey?: string
): Promise<{ key: string; self?: string } | null> {
  const url = `${base.replace(/\/$/, "")}/rest/api/3/issue`;
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const countryFields = Object.fromEntries(
    COUNTRY_CANDIDATES.map((f) => [f, { value: "Brasil" }])
  );

  const baseFields: Record<string, unknown> = {
    project: { key: project },
    summary,
    description: {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
    },
    issuetype: parentKey ? { name: "Subtask" } : { name: "Task" },
    ...(duedate ? { duedate } : {}),
    ...(accountId ? { assignee: { accountId } } : {}),
    ...(parentKey ? { parent: { key: parentKey } } : {}),
  };

  // First attempt: with Country fields
  let res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields: { ...baseFields, ...countryFields } }),
  });

  // If Jira rejects due to invalid custom fields, retry without country
  if (!res.ok) {
    const errText = await res.text();
    const hasFieldError = errText.includes("customfield") || errText.includes("field");
    if (hasFieldError) {
      console.warn("[nova-demanda] Country fields rejected, retrying without:", errText.slice(0, 200));
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ fields: baseFields }),
      });
    }
    if (!res.ok) {
      const finalErr = await res.text();
      console.error("[nova-demanda] Jira create failed:", res.status, finalErr);
      return null;
    }
  }

  return res.json();
}

async function addJiraComment(base: string, auth: string, issueKey: string, comment: string): Promise<boolean> {
  const res = await fetch(`${base}/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }],
      },
    }),
  });
  return res.ok;
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
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
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// Ask Claude to estimate hours per tipo given the full briefing
async function estimatePerTipo(
  titulo: string,
  descricao: string,
  tipos: string[]
): Promise<Record<string, number>> {
  const tipoList = tipos.map((t) => `- ${t}`).join("\n");
  const system = `Você estima horas de trabalho para o time de Brand Creative.

REGRAS DE ESTIMATIVA:
- Layout estático (post, banner, card): 2h cada
- Copy post: 45min por peça
- Copy LP / email: 2h
- Motion 30s: 4h
- Edição de vídeo: 4h por vídeo
- Sinalização/evento: 4h
- Produto/demo: 3h
- Desdobramento/adaptação: 2h por peça
- Default: 2h

Responda APENAS com JSON: { "Tipo": horas, ... }
Use exatamente os nomes de tipo fornecidos como chaves.`;

  const user = `Título: ${titulo}\nDescrição: ${descricao}\n\nTipos selecionados:\n${tipoList}\n\nEstime horas para cada tipo.`;

  try {
    const raw = await callClaude(system, user);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (err) {
    console.warn("[nova-demanda] Claude estimate failed, using defaults:", err);
  }
  return {};
}

export async function POST(req: Request) {
  try {
    const body: DemandaBody = await req.json();
    const { titulo, tipos, descricao, prazo, solicitante, quemSolicitou, apoio } = body;

    if (!titulo || !tipos?.length || !descricao || !prazo || !solicitante) {
      return NextResponse.json({ error: "Campos obrigatórios faltando" }, { status: 400 });
    }

    const base = JIRA_BASE();
    const auth = JIRA_AUTH();
    const project = PROJECT();
    const baseUrl = base.replace(/\/$/, "");

    // Get Claude's hour estimates for all selected types at once
    const claudeEstimates = await estimatePerTipo(titulo, descricao, tipos);

    // Build subtask definitions (rule-based assignee, Claude-estimated hours)
    const subtaskDefs = tipos.map((tipo) => {
      const tipoKey = TIPO_MAP[tipo] || "";
      const rule = TEAM_RULES[tipoKey];
      const estimatedHours = claudeEstimates[tipo] ?? DEFAULT_HOURS[tipoKey] ?? 2;
      return {
        tipo,
        tipoKey,
        label: SUBTASK_LABEL[tipoKey] || tipo.toUpperCase(),
        assignee: rule?.assignee || "Eduardo",
        accountHint: rule?.accountHint || "eduardo",
        estimatedHours,
      };
    });

    const totalHours = subtaskDefs.reduce((s, d) => s + d.estimatedHours, 0);
    const tiposStr = tipos.join(", ");

    // Create parent task (no specific assignee — subtasks carry the assignment)
    const fullDesc = [
      quemSolicitou ? `Solicitante: ${quemSolicitou}` : null,
      `Tipos: ${tiposStr}`,
      `Estimativa total: ${totalHours}h`,
      apoio ? `Material de apoio: ${apoio}` : "",
      "",
      descricao,
    ]
      .filter(Boolean)
      .join("\n");

    const parentIssue = await createJiraIssue(base, auth, project, titulo, fullDesc, prazo, null);
    const issueKey = parentIssue?.key || null;

    // Derive browse URL from Jira's own "self" field — more reliable than JIRA_BASE_URL
    const jiraBase = parentIssue?.self
      ? parentIssue.self.split("/rest/")[0]
      : baseUrl;
    const jiraLink = issueKey ? `${jiraBase}/browse/${issueKey}` : null;

    // Look up all accountIds in parallel
    const accountIds = await Promise.all(
      subtaskDefs.map((d) => findAccountId(base, auth, d.accountHint))
    );

    // Create subtasks in parallel
    const subtaskResults: SubtaskResult[] = await Promise.all(
      subtaskDefs.map(async (def, i) => {
        const accountId = accountIds[i];
        const stSummary = `${titulo} | ${def.label}`;
        let stKey: string | null = null;

        if (issueKey) {
          const st = await createJiraIssue(
            base, auth, project,
            stSummary,
            `Subtask de ${def.tipo} — estimativa: ${def.estimatedHours}h`,
            prazo,
            accountId,
            issueKey   // parentKey → creates as Subtask
          );
          stKey = st?.key || null;
        }

        return {
          tipo: def.tipo,
          label: def.label,
          assignee: def.assignee,
          estimatedHours: def.estimatedHours,
          key: stKey,
        };
      })
    );

    // If Copy is one of the types, generate a draft and post as comment on parent
    const hasCopy = tipos.some((t) => TIPO_MAP[t] === "copy");
    if (hasCopy && issueKey) {
      try {
        const copySystem = "Você é copywriter sênior de marca da Nuvemshop. Escreva em português brasileiro, tom profissional e criativo.";
        const copyPrompt = `Gere uma proposta de copy criativa em português para o seguinte briefing. Seja conciso e entregue texto pronto para revisão.

Título: ${titulo}
Descrição: ${descricao}
${apoio ? `Referência: ${apoio}` : ""}

Responda apenas com o texto da copy, sem explicações.`;

        const copyText = await callClaude(copySystem, copyPrompt);
        if (copyText) {
          await addJiraComment(base, auth, issueKey, `💡 Proposta de copy (gerada por IA):\n\n${copyText}`);
        }
      } catch (err) {
        console.error("[nova-demanda] Copy generation failed:", err);
      }
    }

    // Alerts
    const alerts: string[] = [];
    const workDays = countWorkDays(new Date(), new Date(prazo));

    if (totalHours > 8 && workDays < 2) {
      alerts.push(`⚠️ *Prazo apertado*: ${totalHours}h estimadas no total, mas só ${workDays} dia(s) útil(eis) até ${prazo}`);
    }

    const overloaded = subtaskDefs.filter((d) => {
      const cap = CAPACITY[d.accountHint] || 5.5;
      return d.estimatedHours > cap * workDays * 0.8;
    });
    for (const d of overloaded) {
      alerts.push(`📊 *Volume alto para ${d.assignee}*: ${d.estimatedHours}h estimadas (${d.tipo})`);
    }

    if (alerts.length > 0) {
      const subtaskLines = subtaskResults
        .map((s) => `  • ${s.label} → ${s.assignee} (${s.estimatedHours}h)`)
        .join("\n");

      await sendSlackAlert([
        `🚨 *Alerta — Nova demanda: ${titulo}*`,
        `Solicitante: ${solicitante}`,
        `Prazo: ${prazo} (${workDays} dias úteis)`,
        `Subtasks:\n${subtaskLines}`,
        "",
        ...alerts,
        "",
        `🔗 ${jiraLink}`,
      ].join("\n"));
    }

    return NextResponse.json({
      success: true,
      issueKey,
      jiraLink,
      subtasks: subtaskResults,
      alerts,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[nova-demanda]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
