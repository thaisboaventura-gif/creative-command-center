import { NextResponse } from "next/server";
import { estimateHours } from "@/lib/estimate";
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
  tipo: string;
  descricao: string;
  prazo: string;
  solicitante: string;
  apoio?: string;
}

const TEAM_RULES: Record<string, { assignee: string; accountHint: string }> = {
  "anuncio_performance": { assignee: "Eduardo", accountHint: "eduardo" },
  "sinalizacao_evento":  { assignee: "João",    accountHint: "joao" },
  "motion_video":        { assignee: "Larissa", accountHint: "larissa" },
  "copy":                { assignee: "Beatriz", accountHint: "beatriz" },
  "produto_demo":        { assignee: "João",    accountHint: "joao" },
  "desdobramento":       { assignee: "Rafa",    accountHint: "rafa" },
};

const CAPACITY: Record<string, number> = {
  eduardo: 13.5,
  joao: 5.5,
  beatriz: 5.5,
  larissa: 13.5,
  rafa: 8,
};

const TIPO_MAP: Record<string, string> = {
  "Anúncio/Performance":      "anuncio_performance",
  "Sinalização/Evento":       "sinalizacao_evento",
  "Motion/Vídeo":             "motion_video",
  "Copy":                     "copy",
  "Produto/Demo":             "produto_demo",
  "Desdobramento/Adaptação":  "desdobramento",
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

async function createJiraIssue(
  base: string,
  auth: string,
  project: string,
  summary: string,
  description: string,
  duedate: string,
  accountId: string | null
): Promise<{ key: string } | null> {
  const body: Record<string, unknown> = {
    fields: {
      project: { key: project },
      summary,
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
      },
      issuetype: { name: "Task" },
      duedate: duedate || undefined,
      ...(accountId ? { assignee: { accountId } } : {}),
    },
  };

  const res = await fetch(`${base}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Jira create failed:", res.status, errText);
    return null;
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
      max_tokens: 1024,
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

export async function POST(req: Request) {
  try {
    const body: DemandaBody = await req.json();
    const { titulo, tipo, descricao, prazo, solicitante, apoio } = body;

    if (!titulo || !tipo || !descricao || !prazo || !solicitante) {
      return NextResponse.json({ error: "Campos obrigatórios faltando" }, { status: 400 });
    }

    const base = JIRA_BASE();
    const auth = JIRA_AUTH();
    const project = PROJECT();
    const tipoKey = TIPO_MAP[tipo] || "";
    const rule = TEAM_RULES[tipoKey];
    const est = estimateHours(titulo, null);

    const systemPrompt = `Você é a IA de distribuição de tarefas do time de Brand Creative da Nuvemshop.

REGRAS DO TIME:
- Eduardo → performance, growth, anúncios (tem freela design junto, capacidade 13h30/dia)
- João → sinalização, eventos, stands, product marketing, demos de produto (5h30/dia)
- Beatriz → todo job de copy (5h30/dia)
- Larissa → todo job de motion e vídeo (tem freela motion junto, capacidade 13h30/dia)
- Rafa (agência Monstra) → desdobramentos, adaptações, peças fáceis (8h/dia)
- Francisco → ignorar, sem tasks
- Lucas → ignorar, está saindo

REGRAS DE ESTIMATIVA (horas):
- Layout estático (post, banner, card): 2h cada
- Copy post: 45min cada
- Copy LP: 2h
- Motion 30s: 4h
- Roteiro 30s: 2h
- Storyboard: 4h
- Edição vídeo: 4h
- Vídeo produção completa: 24h
- Banner: 1h
- Email/newsletter: 1h30
- Apresentação/deck: 3h
- Template: 2h
- Default: 2h

Responda SEMPRE em JSON com esta estrutura:
{
  "assignee": "nome da pessoa",
  "estimatedHours": número,
  "reasoning": "explicação curta de por quê essa pessoa"
}`;

    const userPrompt = `Novo job recebido:
- Título: ${titulo}
- Tipo: ${tipo}
- Descrição: ${descricao}
- Prazo: ${prazo}
- Solicitante: ${solicitante}
${apoio ? `- Material de apoio: ${apoio}` : ""}

Quem deve pegar e quanto tempo leva?`;

    let assigneeName = rule?.assignee || "Eduardo";
    let estimatedH = est.hours;
    let reasoning = "Regra padrão por tipo";

    try {
      const claudeResponse = await callClaude(systemPrompt, userPrompt);
      const jsonMatch = claudeResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.assignee) assigneeName = parsed.assignee;
        if (parsed.estimatedHours) estimatedH = parsed.estimatedHours;
        if (parsed.reasoning) reasoning = parsed.reasoning;
      }
    } catch (err) {
      console.error("Claude fallback to rules:", err);
    }

    const accountHint = assigneeName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(" ")[0];
    const accountId = await findAccountId(base, auth, accountHint);

    const fullDesc = [
      `Solicitante: ${solicitante}`,
      `Tipo: ${tipo}`,
      `Estimativa: ${estimatedH}h`,
      `Atribuído para: ${assigneeName} (${reasoning})`,
      apoio ? `Material de apoio: ${apoio}` : "",
      "",
      descricao,
    ]
      .filter(Boolean)
      .join("\n");

    const issue = await createJiraIssue(base, auth, project, titulo, fullDesc, prazo, accountId);
    const issueKey = issue?.key || null;
    const jiraLink = issueKey ? `${base}/browse/${issueKey}` : "não criada";

    if (issueKey && tipoKey === "copy") {
      try {
        const copyPrompt = `Gere uma proposta de copy criativa em português para o seguinte briefing. Seja conciso e entregue texto pronto para revisão.

Título: ${titulo}
Descrição: ${descricao}
${apoio ? `Referência: ${apoio}` : ""}

Responda apenas com o texto da copy, sem explicações.`;

        const copyText = await callClaude(
          "Você é copywriter sênior de marca da Nuvemshop. Escreva em português brasileiro, tom profissional e criativo.",
          copyPrompt
        );
        if (copyText && issueKey) {
          await addJiraComment(base, auth, issueKey, `💡 Proposta de copy (gerada por IA):\n\n${copyText}`);
        }
      } catch (err) {
        console.error("Copy generation failed:", err);
      }
    }

    const alerts: string[] = [];
    const workDays = countWorkDays(new Date(), new Date(prazo));
    const dailyCap = CAPACITY[accountHint] || 5.5;

    if (estimatedH > 8 && workDays < 2) {
      alerts.push(`⚠️ *Prazo impossível*: ${estimatedH}h estimadas mas só ${workDays} dia(s) útil(eis) até ${prazo}`);
    }
    if (estimatedH > 6) {
      alerts.push(`📊 *Volume alto*: ${estimatedH}h estimadas para este job`);
    }
    if (!tipoKey) {
      alerts.push(`❓ *Job não classificado*: tipo "${tipo}" não mapeado automaticamente`);
    }

    if (alerts.length > 0) {
      const slackMsg = [
        `🚨 *Alerta — Nova demanda: ${titulo}*`,
        `Solicitante: ${solicitante}`,
        `Prazo: ${prazo}`,
        `Atribuído: ${assigneeName} (${estimatedH}h)`,
        "",
        ...alerts,
        "",
        `🔗 ${jiraLink}`,
      ].join("\n");

      await sendSlackAlert(slackMsg);
    }

    return NextResponse.json({
      success: true,
      issueKey,
      jiraLink,
      assignee: assigneeName,
      estimatedHours: estimatedH,
      reasoning,
      alerts,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Nova demanda error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
