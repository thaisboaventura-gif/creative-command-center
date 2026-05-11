export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description: unknown;
    status: { name: string; statusCategory: { key: string } };
    priority: { name: string };
    assignee: { displayName: string; emailAddress: string; avatarUrls: Record<string, string> } | null;
    created: string;
    updated: string;
    duedate: string | null;
    issuetype: { name: string };
    labels: string[];
    [key: string]: unknown;
  };
}

interface JiraSearchResponse {
  total: number;
  issues: JiraIssue[];
}

function getAuth() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const baseUrl = process.env.JIRA_BASE_URL;

  if (!email || !token || !baseUrl) {
    throw new Error("Missing Jira credentials in environment variables");
  }

  return {
    baseUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
}

export async function searchIssues(jql: string, maxResults = 50): Promise<JiraSearchResponse> {
  const { baseUrl, headers } = getAuth();
  const url = `${baseUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,description,status,priority,assignee,created,updated,duedate,issuetype,labels,timetracking,timeestimate,timeoriginalestimate`;

  const res = await fetch(url, { headers, next: { revalidate: 300 } });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function getProjectIssues() {
  const projectKey = process.env.JIRA_PROJECT_KEY || "BDSL";
  const jql = `project = ${projectKey} AND status != Done ORDER BY created DESC`;
  return searchIssues(jql, 100);
}

export async function getBoardIssues() {
  const projectKey = process.env.JIRA_PROJECT_KEY || "BDSL";
  const jql = `project = ${projectKey} AND status != Done AND assignee IS NOT EMPTY ORDER BY assignee, priority DESC`;
  return searchIssues(jql, 100);
}

export async function getNewDemands() {
  const projectKey = process.env.JIRA_PROJECT_KEY || "BDSL";
  const jql = `project = ${projectKey} AND created >= -14d ORDER BY created DESC`;
  return searchIssues(jql, 20);
}

function mapStatus(jiraStatus: string): "to_do" | "in_progress" | "in_review" | "done" {
  const lower = jiraStatus.toLowerCase();
  if (lower.includes("done") || lower.includes("conclu") || lower.includes("finaliz")) return "done";
  if (lower.includes("review") || lower.includes("revis")) return "in_review";
  if (lower.includes("progress") || lower.includes("andamento") || lower.includes("doing")) return "in_progress";
  return "to_do";
}

function mapPriority(jiraPriority: string): "low" | "medium" | "high" | "critical" {
  const lower = jiraPriority.toLowerCase();
  if (lower.includes("critical") || lower.includes("highest") || lower.includes("blocker")) return "critical";
  if (lower.includes("high") || lower.includes("alta")) return "high";
  if (lower.includes("low") || lower.includes("baixa") || lower.includes("lowest")) return "low";
  return "medium";
}

function estimateDays(issue: JiraIssue): number {
  const timeOriginal = issue.fields.timeoriginalestimate as number | null;
  if (timeOriginal) return Math.ceil(timeOriginal / 28800);

  const summary = issue.fields.summary.toLowerCase();
  if (summary.includes("vídeo") || summary.includes("video")) return 4;
  if (summary.includes("campanha")) return 3;
  if (summary.includes("landing") || summary.includes("página")) return 3;
  if (summary.includes("banner")) return 1;
  if (summary.includes("post") || summary.includes("story") || summary.includes("stories")) return 1;
  if (summary.includes("email") || summary.includes("newsletter")) return 1;
  if (summary.includes("adaptação") || summary.includes("adaptacion")) return 0.5;
  return 2;
}

export function transformIssues(issues: JiraIssue[]) {
  const teamMap = new Map<
    string,
    { name: string; avatar: string; role: string; tasks: ReturnType<typeof transformTask>[] }
  >();

  const unassigned: ReturnType<typeof transformTask>[] = [];

  for (const issue of issues) {
    const task = transformTask(issue);
    if (!issue.fields.assignee) {
      unassigned.push(task);
      continue;
    }
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
    teamMap.get(name)!.tasks.push(task);
  }

  const CAPACITY_DAYS_PER_SPRINT = 10;

  const team = Array.from(teamMap.values()).map((member) => {
    const totalDays = member.tasks.reduce((sum, t) => sum + t.estimatedDays, 0);
    const capacityPercent = Math.round((totalDays / CAPACITY_DAYS_PER_SPRINT) * 100);
    return { ...member, capacityPercent };
  });

  team.sort((a, b) => b.capacityPercent - a.capacityPercent);

  return { team, unassigned };
}

function transformTask(issue: JiraIssue) {
  return {
    id: issue.key,
    key: issue.key,
    title: issue.fields.summary,
    status: mapStatus(issue.fields.status.name),
    priority: mapPriority(issue.fields.priority?.name || "Medium"),
    assignee: issue.fields.assignee?.displayName || "",
    dueDate: issue.fields.duedate,
    estimatedDays: estimateDays(issue),
    createdAt: issue.fields.created.split("T")[0],
    description: extractDescription(issue.fields.description),
  };
}

function extractDescription(desc: unknown): string {
  if (!desc) return "";
  if (typeof desc === "string") return desc;

  try {
    const content = desc as { content?: Array<{ content?: Array<{ text?: string }> }> };
    if (content.content) {
      return content.content
        .map((block) =>
          block.content?.map((inline) => inline.text || "").join("") || ""
        )
        .filter(Boolean)
        .join("\n");
    }
  } catch {
    // ADF format parsing failed
  }

  return JSON.stringify(desc).slice(0, 500);
}

export function generateAlerts(
  team: Array<{ name: string; capacityPercent: number; tasks: Array<{ key: string; title: string; dueDate: string | null; status: string }> }>
) {
  const alerts: Array<{ type: "capacity" | "deadline" | "briefing"; message: string; severity: "critical" | "warning" | "info" }> = [];

  for (const member of team) {
    if (member.capacityPercent >= 100) {
      alerts.push({
        type: "capacity",
        message: `${member.name.split(" ")[0]} está com ${member.capacityPercent}% da capacidade alocada`,
        severity: "critical",
      });
    } else if (member.capacityPercent >= 80) {
      alerts.push({
        type: "capacity",
        message: `${member.name.split(" ")[0]} está com ${member.capacityPercent}% — cuidado ao alocar novas demandas`,
        severity: "warning",
      });
    }
  }

  const now = Date.now();
  for (const member of team) {
    for (const task of member.tasks) {
      if (!task.dueDate) continue;
      const daysLeft = Math.ceil((new Date(task.dueDate).getTime() - now) / 86400000);
      if (daysLeft < 0 && task.status !== "done") {
        alerts.push({
          type: "deadline",
          message: `${task.key} (${task.title.slice(0, 40)}) está ATRASADO — venceu há ${Math.abs(daysLeft)} dias`,
          severity: "critical",
        });
      } else if (daysLeft <= 3 && daysLeft >= 0 && task.status !== "done") {
        alerts.push({
          type: "deadline",
          message: `${task.key} (${task.title.slice(0, 40)}) vence em ${daysLeft} dia${daysLeft !== 1 ? "s" : ""}`,
          severity: "warning",
        });
      }
    }
  }

  alerts.sort((a, b) => {
    const sev = { critical: 0, warning: 1, info: 2 };
    return sev[a.severity] - sev[b.severity];
  });

  return alerts;
}
