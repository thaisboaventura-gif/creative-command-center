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
}

export interface SubtaskResult {
  label: string;
  assignee: string;
  deadline: string;
  key: string | null;
}

// Country custom field — confirmed for BDSL project
const COUNTRY_CANDIDATES = ["customfield_15854", "customfield_21359", "customfield_10670"];

/* ─── Date helpers ─── */

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function subtractWorkDays(date: Date, days: number): Date {
  const result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() - 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) remaining--;
  }
  return result;
}

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

/* ─── Subtask plan calculator (backwards from main deadline) ───
 *
 * Order of delivery:
 *  1. Copy         → always first (copywriter delivers before design starts)
 *  2. Layout vídeo → D - 2 workdays  (Eduardo: designer delivers to motion)
 *  3. Layout estáticos → D - 1 workday (Eduardo: after video layout)
 *  4. Motion       → D (main deadline) (Larissa)
 *
 * Specialised types (Sinalização, Produto, Desdobramento) → main deadline
 */

interface SubtaskPlan {
  label: string;
  assignee: string;
  accountHint: string;
  deadline: string;
}

function calcSubtaskPlans(tipos: string[], mainDeadlineStr: string): SubtaskPlan[] {
  const D = parseLocalDate(mainDeadlineStr);
  const plans: SubtaskPlan[] = [];

  const hasMotion  = tipos.some((t) => t.includes("Motion") || t.includes("Vídeo"));
  const hasPerf    = tipos.some((t) => t.includes("Anúncio") || t.includes("Performance") || t.includes("Desdobramento") || t.includes("Adaptação"));
  const hasCopy    = tipos.some((t) => t === "Copy");
  const hasSinal   = tipos.some((t) => t.includes("Sinalização") || t.includes("Evento"));
  const hasProd    = tipos.some((t) => t.includes("Produto") || t.includes("Demo"));

  // Deadline for each role (backwards calculation)
  const motionDeadline         = D;
  const layoutVideoDeadline    = subtractWorkDays(D, 2);   // motion needs 2 days after
  const layoutStaticsDeadline  = hasMotion
    ? subtractWorkDays(D, 1)   // after video layout, 1 day before final
    : D;                        // if no motion, statics are the final delivery

  // Copy is always first
  let copyDeadline: Date;
  if (hasMotion)             copyDeadline = subtractWorkDays(D, 3); // before layout video
  else if (hasPerf || hasSinal || hasProd) copyDeadline = subtractWorkDays(D, 1); // 1 day before design
  else                       copyDeadline = D; // only copy job

  // 1 — Copy
  if (hasCopy) {
    plans.push({ label: "Copy", assignee: "Beatriz", accountHint: "beatriz", deadline: formatDate(copyDeadline) });
  }

  // 2 — Layout vídeo (Eduardo) → only when motion is involved
  if (hasMotion) {
    plans.push({ label: "Layout vídeo", assignee: "Eduardo", accountHint: "eduardo", deadline: formatDate(layoutVideoDeadline) });
  }

  // 3 — Layout estáticos (Eduardo) → performance / desdobramento
  if (hasPerf) {
    plans.push({ label: "Layout estáticos", assignee: "Eduardo", accountHint: "eduardo", deadline: formatDate(layoutStaticsDeadline) });
  }

  // 4 — Motion (Larissa)
  if (hasMotion) {
    plans.push({ label: "Motion", assignee: "Larissa", accountHint: "larissa", deadline: formatDate(motionDeadline) });
  }

  // Specialised — João
  if (hasSinal) {
    plans.push({ label: "Sinalização", assignee: "João", accountHint: "joao", deadline: mainDeadlineStr });
  }
  if (hasProd) {
    plans.push({ label: "Produto/Demo", assignee: "João", accountHint: "joao", deadline: mainDeadlineStr });
  }

  return plans;
}

/* ─── Jira helpers ─── */

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

async function forceSetCountry(base: string, auth: string, issueKey: string): Promise<void> {
  const url = `${base.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}`;
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  for (const field of COUNTRY_CANDIDATES) {
    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ fields: { [field]: [{ value: "Brasil" }] } }),
    });
    if (res.ok) {
      console.log(`[nova-demanda] forceSetCountry ✅ ${field} on ${issueKey}`);
      return;
    }
  }
  console.warn(`[nova-demanda] forceSetCountry failed for all fields on ${issueKey}`);
}

async function createJiraIssue(
  base: string,
  auth: string,
  project: string,
  summary: string,
  descriptionText: string,
  duedate: string,
  assigneeAccountId: string | null,
  reporterAccountId: string | null,
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
      content: [{ type: "paragraph", content: [{ type: "text", text: descriptionText }] }],
    },
    issuetype: parentKey ? { id: "10005" } : { id: "10004" },
    ...(duedate ? { duedate } : {}),
    ...(assigneeAccountId ? { assignee: { accountId: assigneeAccountId } } : {}),
    ...(reporterAccountId && !parentKey ? { reporter: { accountId: reporterAccountId } } : {}),
    ...(parentKey ? { parent: { key: parentKey } } : {}),
  };

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ fields }) });
  if (!res.ok) {
    const errText = await res.text();
    console.error("[nova-demanda] Jira create failed:", res.status, errText);
    return null;
  }
  return res.json();
}

/* ─── POST handler ─── */

export async function POST(req: Request) {
  try {
    const body: DemandaBody = await req.json();
    const { titulo, tipos, descricao, prazo, solicitante } = body;

    if (!titulo || !tipos?.length || !descricao || !prazo || !solicitante) {
      return NextResponse.json({ error: "Campos obrigatórios faltando" }, { status: 400 });
    }

    const base    = JIRA_BASE();
    const auth    = JIRA_AUTH();
    const project = PROJECT();

    // Look up reporter account (by solicitante name) and assignee accounts in parallel
    const plans = calcSubtaskPlans(tipos, prazo);
    const [reporterAccountId, ...assigneeAccountIds] = await Promise.all([
      findAccountId(base, auth, solicitante),
      ...plans.map((p) => findAccountId(base, auth, p.accountHint)),
    ]);

    // Build parent description
    const fullDesc = [
      `Solicitante: ${solicitante}`,
      `Tipos: ${tipos.join(", ")}`,
      `Prazo: ${prazo}`,
      "",
      descricao,
    ].join("\n");

    // Create parent task (with reporter = solicitante)
    const parentIssue = await createJiraIssue(
      base, auth, project,
      titulo,
      fullDesc,
      prazo,
      null,            // no assignee on parent
      reporterAccountId
    );
    const issueKey = parentIssue?.key ?? null;

    // Set Country = Brasil on parent
    if (issueKey) {
      try { await forceSetCountry(base, auth, issueKey); } catch { /* non-fatal */ }
    }

    const jiraBase  = parentIssue?.self ? parentIssue.self.split("/rest/")[0] : base.replace(/\/$/, "");
    const jiraLink  = issueKey ? `${jiraBase}/browse/${issueKey}` : null;

    // Create subtasks sequentially (Jira can be flaky with rapid parallel subtask creation)
    const subtaskResults: SubtaskResult[] = [];
    if (issueKey) {
      for (let i = 0; i < plans.length; i++) {
        const plan      = plans[i];
        const accountId = assigneeAccountIds[i] ?? null;
        const stSummary = `${titulo} | ${plan.label}`;

        const st = await createJiraIssue(
          base, auth, project,
          stSummary,
          `Subtask de ${plan.label} — prazo: ${plan.deadline}`,
          plan.deadline,
          accountId,
          null,        // no reporter on subtasks
          issueKey
        );
        const stKey = st?.key ?? null;

        // Set Country = Brasil on each subtask
        if (stKey) {
          try { await forceSetCountry(base, auth, stKey); } catch { /* non-fatal */ }
        }

        subtaskResults.push({
          label:    plan.label,
          assignee: plan.assignee,
          deadline: plan.deadline,
          key:      stKey,
        });
      }
    }

    // Slack alert
    const workDays    = countWorkDays(new Date(), parseLocalDate(prazo));
    const subtaskLines = subtaskResults
      .map((s) => `  • ${titulo} | ${s.label} → ${s.assignee} (${s.deadline})`)
      .join("\n");

    await sendSlackAlert([
      `🗂️ *Nova demanda: ${titulo}*`,
      `Solicitante: ${solicitante}`,
      `Prazo: ${prazo} (${workDays} dias úteis)`,
      `Subtasks:\n${subtaskLines}`,
      `🔗 ${jiraLink}`,
    ].join("\n"));

    return NextResponse.json({
      success:  true,
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
