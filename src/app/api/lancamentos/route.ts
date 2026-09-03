import { NextResponse } from "next/server";
import { estimateHours } from "@/lib/estimate";
import type { PerfTask, PerfSubtask } from "@/app/api/performance/route";

export const dynamic = "force-dynamic";

const COUNTRY_FIELD = "customfield_15854";

const FIELDS = [
  "summary", "status", "priority", "assignee", "reporter",
  "duedate", "created", "subtasks", "issuetype", "timeoriginalestimate",
  "resolutiondate", "parent",
  COUNTRY_FIELD,
  "customfield_10021",
];

function getAuth() {
  const email = process.env.JIRA_EMAIL?.trim() || "";
  const token = process.env.JIRA_API_TOKEN?.trim() || "";
  const base  = (process.env.JIRA_BASE_URL?.trim() || "").replace(/\/$/, "");
  const auth  = Buffer.from(`${email}:${token}`).toString("base64");
  return { base, auth };
}

function mapStatus(name: string): string {
  const l = name.toLowerCase();
  if (l.includes("done") || l.includes("conclu") || l.includes("finaliz") ||
      l.includes("entregue") || l.includes("resolv") || l.includes("closed") ||
      l.includes("encerr") || l.includes("complet")) return "done";
  if (l.includes("review") || l.includes("revis") || l.includes("waiting") ||
      l.includes("aguard") || l.includes("feedback") || l.includes("approval") ||
      l.includes("aprova")) return "in_review";
  if (l.includes("progress") || l.includes("andamento") || l.includes("doing") ||
      l.includes("sendo")) return "in_progress";
  return "to_do";
}

function isBrasil(fields: Record<string, unknown>): boolean {
  const val = fields[COUNTRY_FIELD];
  if (!val) return true;
  const str = JSON.stringify(val).toLowerCase();
  return str.includes("brasil") || str.includes("brazil");
}

function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Matches parent title OR any subtask stub title — robust to accent/case variation
function matchesLancamentos(i: RawIssue): boolean {
  const parent = normalizeText((i.fields.summary as string) ?? "");
  if (parent.includes("lancamentos")) return true;
  const subs = (i.fields.subtasks as Array<{ fields?: { summary?: string } }>) ?? [];
  return subs.some((s) => normalizeText(s.fields?.summary ?? "").includes("lancamentos"));
}

interface RawIssue {
  key: string;
  fields: Record<string, unknown>;
}

async function fetchIssues(base: string, auth: string, jql: string): Promise<RawIssue[]> {
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };
  const qf = FIELDS.map((f) => `fields=${f}`).join("&");
  const all: RawIssue[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 5; page++) {
    const cursorParam = cursor ? `&nextPageToken=${encodeURIComponent(cursor)}` : "";
    const url = `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&${qf}${cursorParam}`;
    const res = await fetch(url, { headers });
    if (!res.ok) break;
    const data = await res.json();
    if (Array.isArray(data.issues)) all.push(...data.issues);
    if (!data.nextPageToken || (data.issues?.length || 0) < 100) break;
    cursor = data.nextPageToken as string;
  }
  return all;
}

async function fetchSingleIssue(base: string, auth: string, key: string): Promise<RawIssue | null> {
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };
  const qf = FIELDS.map((f) => `fields=${f}`).join("&");
  const res = await fetch(`${base}/rest/api/3/issue/${key}?${qf}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

function isFlagged(fields: Record<string, unknown>): boolean {
  const val = fields["customfield_10021"];
  if (!Array.isArray(val) || val.length === 0) return false;
  return (val as Array<{ value?: string }>).some((v) => v?.value?.toLowerCase() === "impediment");
}

function toSubtask(issue: RawIssue): PerfSubtask {
  const f = issue.fields;
  const est = estimateHours(f.summary as string, f.timeoriginalestimate as number | null);
  return {
    key:            issue.key,
    title:          (f.summary as string) ?? "",
    status:         mapStatus((f.status as { name: string })?.name ?? ""),
    assignee:       (f.assignee as { displayName: string } | null)?.displayName ?? "",
    dueDate:        (f.duedate as string) ?? null,
    resolvedAt:     ((f.resolutiondate as string) ?? null)?.split("T")[0] ?? null,
    createdAt:      ((f.created as string) ?? "").split("T")[0],
    estimatedHours: est.hours,
    flagged:        isFlagged(f),
  };
}

function toTask(issue: RawIssue, base: string, subtasks: PerfSubtask[]): PerfTask {
  const f = issue.fields;
  const est = estimateHours(f.summary as string, f.timeoriginalestimate as number | null);
  return {
    key:            issue.key,
    title:          (f.summary as string) ?? "",
    status:         mapStatus((f.status as { name: string })?.name ?? ""),
    assignee:       (f.assignee as { displayName: string } | null)?.displayName ?? "",
    reporter:       (f.reporter as { displayName: string } | null)?.displayName ?? "",
    dueDate:        (f.duedate as string) ?? null,
    resolvedAt:     ((f.resolutiondate as string) ?? null)?.split("T")[0] ?? null,
    createdAt:      ((f.created as string) ?? "").split("T")[0],
    estimatedHours: est.hours,
    jiraLink:       `${base}/browse/${issue.key}`,
    subtasks,
    flagged:        isFlagged(f),
  };
}

export async function GET(req: Request) {
  try {
    const { base, auth } = getAuth();
    const project = process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";

    const { searchParams } = new URL(req.url);
    const singleKey = searchParams.get("key");

    if (singleKey) {
      const issue = await fetchSingleIssue(base, auth, singleKey.toUpperCase());
      if (!issue) return NextResponse.json({ error: "Issue não encontrada" }, { status: 404 });

      const rawSubs = (issue.fields.subtasks as Array<{ key: string }>) ?? [];
      const subtasks = await Promise.all(
        rawSubs.map(async (s) => {
          const sub = await fetchSingleIssue(base, auth, s.key);
          return sub ? toSubtask(sub) : null;
        })
      );
      const task = toTask(issue, base, subtasks.filter(Boolean) as PerfSubtask[]);
      return NextResponse.json({ task });
    }

    const currentYear = new Date().getFullYear();

    // JQL: Jira's ~ is accent/case-insensitive, so "Lançamentos" already catches all accent
    // variants ("lancamentos", "Lançamentos", etc.). Use plural to match real titles.
    const jql1 = `project = ${project} AND summary ~ "Lançamentos" AND issuetype not in subTaskIssueTypes() AND statusCategory != Done AND status != Backlog ORDER BY updated DESC`;
    const jql2 = `project = ${project} AND summary ~ "Lançamentos" AND issuetype not in subTaskIssueTypes() AND statusCategory = Done AND created >= "${currentYear}-01-01" ORDER BY updated DESC`;

    const [raw1, raw2] = await Promise.all([
      fetchIssues(base, auth, jql1),
      fetchIssues(base, auth, jql2),
    ]);

    const seen = new Set(raw1.map((i) => i.key));
    const raw = [
      ...raw1,
      ...raw2.filter((i) => !seen.has(i.key)),
    ];

    // Code-level title filter: normalize accents + lowercase, check parent and subtask stubs
    const filtered = raw.filter((i) => matchesLancamentos(i) && isBrasil(i.fields));

    const tasks: PerfTask[] = await Promise.all(
      filtered.map(async (issue) => {
        const rawSubs = (issue.fields.subtasks as Array<{ key: string }>) ?? [];
        const subtasks = rawSubs.length
          ? await Promise.all(
              rawSubs.map(async (s) => {
                const sub = await fetchSingleIssue(base, auth, s.key);
                return sub ? toSubtask(sub) : null;
              })
            ).then((r) => r.filter(Boolean) as PerfSubtask[])
          : [];
        return toTask(issue, base, subtasks);
      })
    );

    return NextResponse.json({
      tasks,
      meta: { total_jql: raw.length, total_title_match: filtered.length, tasks: tasks.length },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[lancamentos]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
