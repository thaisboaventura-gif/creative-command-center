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

const TEAM_FILTER = ["joao", "beatriz", "francisco", "eduardo", "larissa", "rafaela.ceragioli", "rafaela", "ceragioli", "gasparetto", "gabriel", "cassino"];

function isTeamMember(displayName: string): boolean {
  const lower = displayName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return TEAM_FILTER.some((n) => lower.includes(n));
}

function mapStatus(name: string): string {
  const l = name.toLowerCase();
  if (l.includes("done") || l.includes("conclu") || l.includes("finaliz") ||
      l.includes("entregue") || l.includes("resolv") || l.includes("closed") ||
      l.includes("encerr") || l.includes("complet"))
    return "done";
  if (
    l.includes("review") || l.includes("revis") ||
    l.includes("waiting") || l.includes("aguard") ||
    l.includes("feedback") || l.includes("approval") || l.includes("aprova")
  )
    return "in_review";
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

// Country custom field candidates for BDSL project
const COUNTRY_FIELDS = ["customfield_21359", "customfield_15854", "customfield_10670"];

const FIELDS = [
  "summary",
  "status",
  "priority",
  "assignee",
  "created",
  "duedate",
  "labels",
  "timeoriginalestimate",
  "parent",   // needed to identify parent key when fetching subtasks
  ...COUNTRY_FIELDS,
];

// Jira usernames used for the subtask-assignee lookup
const TEAM_USERNAMES = [
  "eduardo.oliveira", "eduardo.gasparetto", "larissa.delarue", "joao.camargo",
  "beatriz", "rafaela.ceragioli", "francisco.fernandes",
  // gabriel.cassino sem conta Jira ainda — não entra no JQL
];

function isBrasil(issue: JiraIssue): boolean {
  for (const f of COUNTRY_FIELDS) {
    const val = issue.fields[f];
    if (!val) continue;
    const str = JSON.stringify(val).toLowerCase();
    if (str.includes("brasil") || str.includes("brazil") || str.includes("br")) return true;
  }
  // If no country field is set at all, include the task (field might not be used)
  const hasAnyCountry = COUNTRY_FIELDS.some(f => issue.fields[f]);
  return !hasAnyCountry;
}

/** Strict version: only tasks EXPLICITLY marked as Brasil — no fallback for missing country. */
function isExplicitlyBrasil(issue: JiraIssue): boolean {
  for (const f of COUNTRY_FIELDS) {
    const val = issue.fields[f];
    if (!val) continue;
    const str = JSON.stringify(val).toLowerCase();
    if (str.includes("brasil") || str.includes("brazil")) return true;
  }
  return false;
}

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

    // statusCategory = Done covers ALL done statuses regardless of name (Done, Entregue, Concluído, etc.)
    // issuetype not in subTaskIssueTypes() keeps subtasks out of the board — they come via subJql only
    const boardJql = `project = ${project} AND issuetype not in subTaskIssueTypes() AND statusCategory != Done AND status != Backlog AND assignee IS NOT EMPTY ORDER BY updated DESC`;
    const newJql   = `project = ${project} AND created >= -14d ORDER BY created DESC`;
    // Query 3: active subtasks assigned to any team member
    const subJql   = `project = ${project} AND issuetype in subTaskIssueTypes() AND assignee in (${TEAM_USERNAMES.join(", ")}) AND statusCategory != Done AND status != Backlog`;
    // Query 4: tasks created by Thais with no assignee yet
    const thaisJql = `project = ${project} AND reporter = "thais.boaventura" AND assignee is EMPTY AND statusCategory != Done AND status != Backlog ORDER BY created DESC`;

    const [boardIssues, newIssues, teamSubsRaw, thaisUnassigned] = await Promise.all([
      fetchAllIssues(base, auth, boardJql, 6),
      fetchAllIssues(base, auth, newJql, 2),
      fetchAllIssues(base, auth, subJql, 3).catch((e) => {
        console.error("[jira] subJql failed:", e);
        return [] as JiraIssue[];
      }),
      fetchAllIssues(base, auth, thaisJql, 2).catch((e) => {
        console.error("[jira] thaisJql failed:", e);
        return [] as JiraIssue[];
      }),
    ]);

    // Also detect team members via subtasks already embedded in boardIssues
    // (boardIssues won't have subtask detail, but teamSubsRaw should cover it)
    const teamSubs = teamSubsRaw;
    console.log("[jira] teamSubs fetched:", teamSubs.length, "subJql:", subJql);

    // Filter to only the direct team members AND country = Brasil (explicit only — no fallback)
    const teamIssues = boardIssues.filter((issue) =>
      issue.fields?.assignee
        ? isTeamMember(issue.fields.assignee.displayName) && isExplicitlyBrasil(issue)
        : false
    );

    // Build map: parentKey → set of team-member display names who have a child task there.
    // Two sources:
    //   1. teamSubs (issuetype = subTaskIssueTypes — true Jira subtasks)
    //   2. teamIssues that have a parent field (regular tasks that are children of a parent)
    const subParentMap = new Map<string, Set<string>>();

    function addToParentMap(parentKey: string, name: string) {
      if (!subParentMap.has(parentKey)) subParentMap.set(parentKey, new Set());
      subParentMap.get(parentKey)!.add(name);
    }

    for (const sub of teamSubs) {
      const parentKey = (sub.fields.parent as { key: string } | null)?.key;
      const name = sub.fields.assignee?.displayName;
      if (parentKey && name) addToParentMap(parentKey, name);
    }

    // Also capture parent keys from team issues already in the board
    // (these may be regular task-type children, not captured by subJql)
    for (const issue of teamIssues) {
      const parentKey = (issue.fields.parent as { key: string } | null)?.key;
      const name = issue.fields.assignee?.displayName;
      if (parentKey && name) addToParentMap(parentKey, name);
    }

    console.log("[jira] subParentMap keys:", [...subParentMap.keys()]);

    // Fetch parent tasks not already present in boardIssues
    const boardKeys  = new Set(boardIssues.map((i) => i.key));
    const missingKeys = [...subParentMap.keys()].filter((k) => !boardKeys.has(k));
    console.log("[jira] missingParentKeys:", missingKeys);
    const extraParents: JiraIssue[] = missingKeys.length
      ? await fetchAllIssues(base, auth, `key in (${missingKeys.join(", ")}) AND statusCategory != Done AND status not in ("Backlog")`, 1)
      : [];

    // Build set of parent keys that are NOT in backlog (used to gate subtask visibility)
    const allParentIssues = [
      ...boardIssues.filter(i => subParentMap.has(i.key)),
      ...extraParents,
    ];
    const activeParentKeys = new Set(
      allParentIssues
        .filter(i => {
          const s = (i.fields.status as { name: string } | null)?.name?.toLowerCase() ?? "";
          return !s.includes("backlog");
        })
        .map(i => i.key)
    );

    // allSubParents now derived from the pre-filtered list above
    const allSubParents = allParentIssues;

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
        parentKey?: string;
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
        parentKey: (issue.fields.parent as { key: string } | null)?.key ?? undefined,
      });
    }

    for (const issue of allSubParents) {
      const assigneeNames = subParentMap.get(issue.key);
      if (!assigneeNames) continue;
      // Skip parent tasks that are in Backlog or any Done-category status
      const rawStatus = (issue.fields.status as { name: string } | null)?.name?.toLowerCase() ?? "";
      const statusCat = ((issue.fields.status as { statusCategory?: { key?: string } } | null)?.statusCategory?.key ?? "").toLowerCase();
      if (rawStatus.includes("backlog") || statusCat === "done" ||
          rawStatus.includes("done") || rawStatus.includes("conclu") || rawStatus.includes("entregue") ||
          rawStatus.includes("finaliz") || rawStatus.includes("resolv") || rawStatus.includes("closed")) continue;
      // Only Brasil tasks as parents (use fallback — parent may not have field set)
      if (!isBrasil(issue)) continue;

      for (const name of assigneeNames) {
        if (!teamMap.has(name)) {
          const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
          teamMap.set(name, { name, avatar: initials, role: "", tasks: [] });
        }
        const member = teamMap.get(name)!;
        // Skip if already present (e.g. parent assignee is also a team member)
        if (member.tasks.some((t) => t.key === issue.key)) continue;

        const est = estimateHours(issue.fields.summary, issue.fields.timeoriginalestimate);
        member.tasks.push({
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
          // allSubParents tasks are always root-level — no parentKey here
        });
      }
    }

    // Add subtasks from teamSubs into each member's task list (for hierarchy rendering)
    // Only add if: subtask not already present, parent IS in the member's list, país=Brasil
    const existingTaskKeys = new Set(
      [...teamMap.values()].flatMap((m) => m.tasks.map((t) => t.key))
    );
    for (const sub of teamSubs) {
      const parentKey = (sub.fields.parent as { key: string } | null)?.key;
      const name = sub.fields.assignee?.displayName;
      if (!name || !parentKey) continue;
      if (!teamMap.has(name)) continue;
      if (existingTaskKeys.has(sub.key)) continue;
      if (!isBrasil(sub)) continue;
      if (!activeParentKeys.has(parentKey)) continue; // skip subtasks of backlog parents
      const member = teamMap.get(name)!;
      if (!member.tasks.some((t) => t.key === parentKey)) continue; // only if parent is visible
      const est = estimateHours(sub.fields.summary, sub.fields.timeoriginalestimate);
      member.tasks.push({
        id: sub.key, key: sub.key, title: sub.fields.summary,
        status: mapStatus(sub.fields.status?.name || ""),
        priority: mapPriority(sub.fields.priority?.name || "Medium"),
        assignee: name, dueDate: sub.fields.duedate || null,
        estimatedHours: est.hours, estimatedDetail: est.detail,
        createdAt: sub.fields.created?.split("T")[0] || "",
        parentKey,
      });
    }

    // Unassigned tasks created by Thais → virtual "Sem dono" row
    const SEM_DONO = "Sem dono";
    const thaisBrasil = thaisUnassigned.filter(isBrasil);
    console.log("[jira] thaisUnassigned brasil:", thaisBrasil.length);
    for (const issue of thaisBrasil) {
      if (!teamMap.has(SEM_DONO)) {
        teamMap.set(SEM_DONO, { name: SEM_DONO, avatar: "SD", role: "", tasks: [] });
      }
      // Skip if somehow already present
      if (teamMap.get(SEM_DONO)!.tasks.some((t) => t.key === issue.key)) continue;
      const est = estimateHours(issue.fields.summary, issue.fields.timeoriginalestimate);
      teamMap.get(SEM_DONO)!.tasks.push({
        id: issue.key,
        key: issue.key,
        title: issue.fields.summary,
        status: mapStatus(issue.fields.status?.name || ""),
        priority: mapPriority(issue.fields.priority?.name || "Medium"),
        assignee: SEM_DONO,
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

    // New demands — strictly filtered by Country=Brasil (explicit field only, no fallback)
    const newDemands = newIssues.filter(isExplicitlyBrasil).slice(0, 200).map((issue) => {
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
        subTasksFound: teamSubs.length,
        subParentKeys: [...subParentMap.keys()],
        extraParentsFetched: extraParents.length,
        thaisUnassignedFetched: thaisUnassigned.length,
        thaisUnassignedBrasil: thaisBrasil.length,
        subJql,
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
