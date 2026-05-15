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

// Country custom field for the BDSL project.
// Confirmed via Jira API: customfield_15854, multi-select array format.
// Fallbacks kept in case field ID differs in other environments.
const COUNTRY_CANDIDATES = ["customfield_15854", "customfield_21359", "customfield_10670"];

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

// Tries each country candidate field individually via PUT until one sticks.
// Called after every issue creation — never skipped.
async function forceSetCountry(base: string, auth: string, issueKey: string): Promise<void> {
  const url = `${base.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}`;
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  for (const field of COUNTRY_CANDIDATES) {
    console.log(`[nova-demanda] forceSetCountry → trying ${field} on ${issueKey}`);
    const res = await fetch(url, {
      method: "PUT",
      headers,
      // customfield_15854 is a multi-select array — value must be wrapped in []
      body: JSON.stringify({ fields: { [field]: [{ value: "Brasil" }] } }),
    });
    if (res.ok) {
      console.log(`[nova-demanda] forceSetCountry ✅ Country = Brasil set via ${field} on ${issueKey}`);
      return;
    }
    const errText = await res.text();
    console.warn(`[nova-demanda] forceSetCountry ❌ ${field} → HTTP ${res.status} on ${issueKey} | body: ${errText.slice(0, 500)}`);
  }

  console.error(`[nova-demanda] forceSetCountry ⚠️ All 3 fields failed for ${issueKey} — Country is unset`);
}

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

  const fields: Record<string, unknown> = {
    project: { key: project },
    summary,
    description: {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
    },
    // Issue type IDs confirmed via Jira API for BDSL project:
    // 10004 = Tarefa (Task), 10005 = Subtarefa (Sub-task)
    issuetype: parentKey ? { id: "10005" } : { id: "10004" },
    ...(duedate ? { duedate } : {}),
    ...(accountId ? { assignee: { accountId } } : {}),
    ...(parentKey ? { parent: { key: parentKey } } : {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[nova-demanda] Jira create failed:", res.status, errText);
    return null;
  }

  return res.json();
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

    // Claude estimates hours for all types at once
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

    // Build parent task description
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

    // Create parent task
    const parentIssue = await createJiraIssue(base, auth, project, titulo, fullDesc, prazo, null);
    const issueKey = parentIssue?.key || null;

    // Force-set Country = Brasil on parent (tries each candidate field until one works)
    if (issueKey) {
      try {
        await forceSetCountry(base, auth, issueKey);
      } catch (err) {
        console.error("[nova-demanda] forceSetCountry threw on parent:", err);
      }
    }

    // Derive browse URL from Jira's own "self" field — reliable regardless of env var format
    const jiraBase = parentIssue?.self
      ? parentIssue.self.split("/rest/")[0]
      : baseUrl;
    const jiraLink = issueKey ? `${jiraBase}/browse/${issueKey}` : null;

    // Look up all accountIds in parallel
    const accountIds = await Promise.all(
      subtaskDefs.map((d) => findAccountId(base, auth, d.accountHint))
    );

    // Create subtasks sequentially (Jira can be flaky with rapid parallel subtask creation)
    const subtaskResults: SubtaskResult[] = [];
    for (let i = 0; i < subtaskDefs.length; i++) {
      const def = subtaskDefs[i];
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
          issueKey
        );
        stKey = st?.key || null;

        // Force-set Country = Brasil on each subtask as well
        if (stKey) {
          try {
            await forceSetCountry(base, auth, stKey);
          } catch (err) {
            console.error(`[nova-demanda] forceSetCountry threw on subtask ${stKey}:`, err);
          }
        }
      }

      subtaskResults.push({
        tipo: def.tipo,
        label: def.label,
        assignee: def.assignee,
        estimatedHours: def.estimatedHours,
        key: stKey,
      });
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
