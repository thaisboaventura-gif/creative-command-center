import { NextResponse } from "next/server";
import { estimateHours } from "@/lib/estimate";

export const dynamic = "force-dynamic";

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority: { name: string } | null;
    assignee: { displayName: string } | null;
    created: string;
    duedate: string | null;
    labels: string[];
    timeoriginalestimate: number | null;
    [key: string]: unknown;
  };
}

const TEAM_FILTER = ["joao", "beatriz", "francisco", "eduardo", "lucas", "larissa", "rafaela.ceragioli", "rafaela", "ceragioli"];

function isTeamMember(displayName: string): boolean {
  const lower = displayName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return TEAM_FILTER.some((n) => lower.includes(n));
}

function mapStatus(name: string): string {
  const l = name.toLowerCase();
  if (l.includes("done") || l.includes("conclu") || l.includes("finaliz"))
    return "done";
  if (l.includes("review") || l.includes("revis")) return "in_review";
  if (
    l.includes("progress") ||
    l.includes("andamento") ||
    l.includes("doing") ||
    l.includes("sendo")
  )
    return "in_progress";
  return "to_do";
}

function mapPriority(name: string): string {
  const l = name.toLowerCase();
  if (l.includes("critical") || l.includes("highest") || l.includes("blocker"))
    return "critical";
  if (l.includes("high") || l.includes("alta")) return "high";
  if (l.includes("low") || l.includes("baixa") || l.includes("lowest"))
    return "low";
  return "medium";
}

const FIELDS = [
  "summary",
  "status",
  "priority",
  "assignee",
  "created",
  "duedate",
  "labels",
  "timeoriginalestimate",
];

async function fetchAllIssues(
  base: string,
  auth: string,
  jql: string,
  maxPages = 5
): Promise<JiraIssue[]> {
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
  const qf = FIELDS.map((f) => `fields=${f}`).join("&");
  const all: JiraIssue[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const cursorParam: string = cursor
      ? `&nextPageToken=${encodeURIComponent(cursor)}`
      : "";
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

export async function GET() {
  try {
    const email = process.env.JIRA_EMAIL?.trim();
    const token = process.env.JIRA_API_TOKEN?.trim();
    const base = process.env.JIRA_BASE_URL?.trim();
    const project = process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";

    if (!email || !token || !base) {
      return NextResponse.json(
        { error: "Env vars ausentes", team: [], alerts: [], newDemands: [] },
        { status: 500 }
      );
    }

    const auth = Buffer.from(`${email}:${token}`).toString("base64");

    const boardJql = `project = ${project} AND status != Done AND assignee IS NOT EMPTY ORDER BY assignee, priority DESC`;
    const newJql = `project = ${project} AND created >= -14d ORDER BY created DESC`;

    const [boardIssues, newIssues] = await Promise.all([
      fetchAllIssues(base, auth, boardJql, 3),
      fetchAllIssues(base, auth, newJql, 1),
    ]);

    // Log all unique assignees to debug
    const allAssignees = [...new Set(boardIssues.map(i => i.fields?.assignee?.displayName).filter(Boolean))];
    console.log("ALL ASSIGNEES IN JIRA:", JSON.stringify(allAssignees));

    // Filter to only the direct team
    const teamIssues = boardIssues.filter((issue) =>
      issue.fields?.assignee ? isTeamMember(issue.fields.assignee.displayName) : false
    );

    // Build team map
    const teamMap = new Map<
      string,
      {
        name: string;
        avatar: string;
        role: string;
        tasks: Array<{
          id: string;
          key: string;
          title: string;
          status: string;
          priority: string;
          assignee: string;
          dueDate: string | null;
        estimatedHours: number;
        estimatedDetail: string;
        createdAt: string;
        }>;
      }
    >();

    for (const issue of teamIssues) {
      if (!issue.fields?.assignee) continue;
      const name = issue.fields.assignee.displayName;
      if (!teamMap.has(name)) {
        const initials = name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
        teamMap.set(name, { name, avatar: initials, role: "", tasks: [] });
      }
      const est = estimateHours(issue.fields.summary, issue.fields.timeoriginalestimate);
      teamMap.get(name)!.tasks.push({
        id: issue.key,
        key: issue.key,
        title: issue.fields.summary,
        status: mapStatus(issue.fields.status?.name || ""),
        priority: mapPriority(issue.fields.priority?.name || "Medium"),
        assignee: name,
        dueDate: issue.fields.duedate || null,
        estimatedHours: est.hours,
        estimatedDetail: est.detail,
        createdAt: issue.fields.created?.split("T")[0] || "",
      });
    }

    const WEEKLY_HOURS = 40;
    const team = Array.from(teamMap.values())
      .map((m) => ({
        ...m,
        totalHours: Math.round(m.tasks.filter(t => t.status !== "done").reduce((s, t) => s + t.estimatedHours, 0) * 10) / 10,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    // Alerts
    const alerts: Array<{ type: string; message: string; severity: string }> = [];
    const now = Date.now();
    for (const m of team) {

      for (const t of m.tasks) {
        if (!t.dueDate) continue;
        const days = Math.ceil(
          (new Date(t.dueDate).getTime() - now) / 86400000
        );
        if (days < 0 && t.status !== "done")
          alerts.push({
            type: "deadline",
            message: `${t.key} (${t.title.slice(0, 35)}) está ATRASADO`,
            severity: "critical",
          });
        else if (days <= 3 && days >= 0 && t.status !== "done")
          alerts.push({
            type: "deadline",
            message: `${t.key} (${t.title.slice(0, 35)}) vence em ${days}d`,
            severity: "warning",
          });
      }
    }
    alerts.sort((a, b) => {
      const s: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      return (s[a.severity] ?? 2) - (s[b.severity] ?? 2);
    });

    // New demands (unfiltered — all recent project tasks)
    const newDemands = newIssues.slice(0, 10).map((issue) => {
      const est = estimateHours(issue.fields.summary, issue.fields.timeoriginalestimate);
      return {
        id: issue.key,
        key: issue.key,
        title: issue.fields.summary,
        status: mapStatus(issue.fields.status?.name || ""),
        priority: mapPriority(issue.fields.priority?.name || "Medium"),
        assignee: issue.fields.assignee?.displayName || "",
        dueDate: issue.fields.duedate || null,
        estimatedHours: est.hours,
        estimatedDetail: est.detail,
        createdAt: issue.fields.created?.split("T")[0] || "",
      };
    });

    return NextResponse.json({
      team,
      alerts: alerts.slice(0, 15),
      newDemands,
      _meta: {
        totalFetched: boardIssues.length,
        teamFiltered: teamIssues.length,
        teamMembers: team.map((m) => m.name),
        allAssignees: [...new Set(boardIssues.map(i => i.fields?.assignee?.displayName).filter(Boolean))],
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Jira API error:", msg);
    return NextResponse.json(
      { error: msg, team: [], alerts: [], newDemands: [] },
      { status: 500 }
    );
  }
}
