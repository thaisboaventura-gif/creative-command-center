import { NextResponse } from "next/server";
import { estimateHours } from "@/lib/estimate";

export const dynamic = "force-dynamic";

const PERFORMANCE_REPORTERS = ["andre.jesus", "ayslla", "matheus.tavares", "matheus.lopes"];
const PERFORMANCE_ASSIGNEES  = ["eduardo.oliveira"];

// Country field confirmed for BDSL project
const COUNTRY_FIELD = "customfield_15854";

const FIELDS = [
  "summary", "status", "priority", "assignee", "reporter",
  "duedate", "created", "subtasks", "issuetype", "timeoriginalestimate",
  COUNTRY_FIELD,
];

export interface PerfSubtask {
  key: string;
  title: string;
  status: string;
  assignee: string;
  dueDate: string | null;
  createdAt: string;
  estimatedHours: number;
}

export interface PerfTask {
  key: string;
  title: string;
  status: string;
  assignee: string;
  reporter: string;
  dueDate: string | null;
  createdAt: string;
  estimatedHours: number;
  jiraLink: string;
  subtasks: PerfSubtask[];
}

function getAuth() {
  const email = process.env.JIRA_EMAIL?.trim() || "";
  const token = process.env.JIRA_API_TOKEN?.trim() || "";
  const base  = (process.env.JIRA_BASE_URL?.trim() || "").replace(/\/$/, "");
  const auth  = Buffer.from(`${email}:${token}`).toString("base64");
  return { base, auth };
}

function mapStatus(name: string): string {
  const l = name.toLowerCase();
  if (l.includes("done") || l.includes("conclu") || l.includes("finaliz")) return "done";
  if (l.includes("review") || l.includes("revis") || l.includes("waiting") ||
      l.includes("aguard") || l.includes("feedback") || l.includes("approval") ||
      l.includes("aprova")) return "in_review";
  if (l.includes("progress") || l.includes("andamento") || l.includes("doing") ||
      l.includes("sendo")) return "in_progress";
  return "to_do";
}

function isBrasil(fields: Record<string, unknown>): boolean {
  const val = fields[COUNTRY_FIELD];
  if (!val) return true; // no country set → include
  const str = JSON.stringify(val).toLowerCase();
  return str.includes("brasil") || str.includes("brazil");
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

function toSubtask(issue: RawIssue, base: string): PerfSubtask {
  const f = issue.fields;
  const est = estimateHours(f.summary as string, f.timeoriginalestimate as number | null);
  return {
    key:            issue.key,
    title:          (f.summary as string) ?? "",
    status:         mapStatus((f.status as { name: string })?.name ?? ""),
    assignee:       (f.assignee as { displayName: string } | null)?.displayName ?? "",
    dueDate:        (f.duedate as string) ?? null,
    createdAt:      ((f.created as string) ?? "").split("T")[0],
    estimatedHours: est.hours,
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
    createdAt:      ((f.created as string) ?? "").split("T")[0],
    estimatedHours: est.hours,
    jiraLink:       `${base}/browse/${issue.key}`,
    subtasks,
  };
}

export async function GET(req: Request) {
  try {
    const { base, auth } = getAuth();
    const project = process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";

    // Support ?key=BDSL-XXXXX for single-issue lookup (add manually feature)
    const { searchParams } = new URL(req.url);
    const singleKey = searchParams.get("key");

    if (singleKey) {
      const issue = await fetchSingleIssue(base, auth, singleKey.toUpperCase());
      if (!issue) return NextResponse.json({ error: "Issue não encontrada" }, { status: 404 });

      const rawSubs = (issue.fields.subtasks as Array<{ key: string }>) ?? [];
      const subtasks = await Promise.all(
        rawSubs.map(async (s) => {
          const sub = await fetchSingleIssue(base, auth, s.key);
          return sub ? toSubtask(sub, base) : null;
        })
      );
      const task = toTask(issue, base, subtasks.filter(Boolean) as PerfSubtask[]);
      return NextResponse.json({ task });
    }

    // Main query: reporter in performance team OR assignee = eduardo
    const reporters = PERFORMANCE_REPORTERS.join(", ");
    const assignees = PERFORMANCE_ASSIGNEES.join(", ");
    const jql = `project = ${project} AND status != Done AND (reporter in (${reporters}) OR assignee in (${assignees})) ORDER BY updated DESC`;

    const raw = await fetchIssues(base, auth, jql);

    // Filter by Country = Brasil
    const filtered = raw.filter((i) => isBrasil(i.fields));

    // Fetch subtasks in parallel (batch by parent)
    const tasks: PerfTask[] = await Promise.all(
      filtered.map(async (issue) => {
        const rawSubs = (issue.fields.subtasks as Array<{ key: string }>) ?? [];
        const subtasks = rawSubs.length
          ? await Promise.all(
              rawSubs.map(async (s) => {
                const sub = await fetchSingleIssue(base, auth, s.key);
                return sub ? toSubtask(sub, base) : null;
              })
            ).then((r) => r.filter(Boolean) as PerfSubtask[])
          : [];
        return toTask(issue, base, subtasks);
      })
    );

    return NextResponse.json({
      tasks,
      meta: { total: raw.length, brasil: filtered.length },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[performance]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
