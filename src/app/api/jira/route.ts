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
    customfield_10021?: Array<{ value?: string }> | null;
    [key: string]: unknown;
  };
}

function isFlagged(issue: JiraIssue): boolean {
  const val = issue.fields.customfield_10021;
  if (!Array.isArray(val) || val.length === 0) return false;
  return val.some((v) => v?.value?.toLowerCase() === "impediment");
}

const TEAM_FILTER = [
  "eduardo",
  "gasparetto",
  "gabriel", "cassino",
  "larissa", "delarue",
  "francisco",
  "joao",
  "beatriz", "pusso",
  "rafaela", "ceragioli",
];

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
  "customfield_10021", // Jira "Flagged" field
  ...COUNTRY_FIELDS,
];

// Jira accountIds used for the subtask-assignee lookup
const TEAM_USERNAMES = [
  "712020:4648823a-0cdc-4178-b186-597098121542", // Eduardo Oliveira
  "61aa13d5c75da800721a2623",                     // Eduardo Gasparetto
  "61b39fc4d2e64c0071f160d5",                     // Larissa Delarue
  "712020:2ee0f456-77e7-4f2a-8502-ff712b3ba6da", // João Camargo
  "6425a53f67102fc717c2902d",                     // Beatriz de Souza Pusso
  "712020:e2200010-bf69-4f6e-87a4-a792c42d8837", // Rafaela Ceragioli
  "712020:e22b3767-90e9-47d2-92cd-ef84adafaac6", // Francisco Fernandes
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
  hardCap = 600
): Promise<JiraIssue[]> {
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
  // cache: 'no-store' prevents Next.js from serving stale Jira responses from the Data Cache
  const fetchOpts: RequestInit = { headers, cache: "no-store" };
  const qf = FIELDS.map((f) => `fields=${f}`).join("&");
  const all: JiraIssue[] = [];
  const pageSize = 100;
  let cursor: string | null = null;

  while (all.length < hardCap) {
    const cursorParam = cursor ? `&nextPageToken=${encodeURIComponent(cursor)}` : "";
    const url = `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${pageSize}&${qf}${cursorParam}`;
    const res = await fetch(url, fetchOpts);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "(sem body)");
      console.error(`[jira] fetch falhou status=${res.status} jql="${jql.slice(0, 120)}" body=${errBody.slice(0, 300)}`);
      break;
    }
    const data = await res.json();
    const issues: JiraIssue[] = Array.isArray(data.issues) ? data.issues : [];
    all.push(...issues);
    console.log(`[jira] página cursor=${cursor ?? "inicio"} got=${issues.length} nextToken=${data.nextPageToken ?? "fim"} jql="${jql.slice(0, 80)}"`);
    if (!data.nextPageToken || issues.length < pageSize) break;
    cursor = data.nextPageToken as string;
  }

  return all;
}

export async function GET(_req: Request) {
  console.log("[jira] GET chamado — início absoluto");
  try {
    const base  = process.env.JIRA_BASE_URL?.trim();
    const email = process.env.JIRA_EMAIL?.trim();
    const token = process.env.JIRA_API_TOKEN?.trim();
    const project = process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";

    console.log("[jira] base:", base ? "ok" : "VAZIO");
    console.log("[jira] email:", email ? "ok" : "VAZIO");
    console.log("[jira] token:", token ? "ok" : "VAZIO");

    if (!base || !email || !token) {
      console.error("[jira] FALTANDO ENV VARS — retornando erro");
      return NextResponse.json(
        { error: "Env vars ausentes", team: [], alerts: [], newDemands: [] },
        { status: 500 }
      );
    }

    console.log("[jira] env vars ok — iniciando queries");

    const auth = Buffer.from(`${email}:${token}`).toString("base64");

    // Compute current week boundaries (Mon–Sun) for Done-this-week visibility
    const nowDate = new Date();
    const dow = nowDate.getDay(); // 0=Sun
    const daysFromMon = dow === 0 ? 6 : dow - 1;
    const weekMonday = new Date(nowDate);
    weekMonday.setDate(nowDate.getDate() - daysFromMon);
    weekMonday.setHours(0, 0, 0, 0);
    const weekSunday = new Date(weekMonday);
    weekSunday.setDate(weekMonday.getDate() + 6);
    const wStart = weekMonday.toISOString().split("T")[0];
    const wEnd   = weekSunday.toISOString().split("T")[0];

    function isDueThisWeek(duedate: string | null): boolean {
      if (!duedate) return false;
      return duedate >= wStart && duedate <= wEnd;
    }

    // Active parent tasks (non-subtask, non-done, non-backlog, non-cancelled)
    const boardJqlActive = `project = ${project} AND issuetype not in subTaskIssueTypes() AND statusCategory != Done AND status not in ("Backlog", "Cancelado") AND assignee IS NOT EMPTY ORDER BY updated DESC`;
    // Done parent tasks with duedate in current week
    const boardJqlDone = `project = ${project} AND issuetype not in subTaskIssueTypes() AND statusCategory = Done AND duedate >= "${wStart}" AND duedate <= "${wEnd}" AND assignee IS NOT EMPTY ORDER BY duedate ASC`;

    // Active subtasks for team members
    const subJqlActive = `project = ${project} AND issuetype in subTaskIssueTypes() AND assignee in (${TEAM_USERNAMES.join(", ")}) AND statusCategory != Done AND status not in ("Backlog", "Cancelado")`;
    // Done subtasks with duedate in current week
    const subJqlDone = `project = ${project} AND issuetype in subTaskIssueTypes() AND assignee in (${TEAM_USERNAMES.join(", ")}) AND statusCategory = Done AND duedate >= "${wStart}" AND duedate <= "${wEnd}"`;

    const newJql   = `project = ${project} AND created >= -14d ORDER BY created DESC`;
    const thaisJql = `project = ${project} AND reporter = "712020:1367b7ec-590a-42ff-b7d4-b98a2208f633" AND assignee is EMPTY AND statusCategory != Done AND status not in ("Backlog", "Cancelado") ORDER BY created DESC`;

    console.log("[jira] boardJqlActive:", boardJqlActive);
    console.log("[jira] subJqlActive:", subJqlActive);
    console.log("[jira] wStart:", wStart, "wEnd:", wEnd);

    const [boardActive, boardDone, subActive, subDone, newIssues, thaisUnassigned] = await Promise.all([
      fetchAllIssues(base, auth, boardJqlActive, 600),
      fetchAllIssues(base, auth, boardJqlDone, 200).catch(() => [] as JiraIssue[]),
      fetchAllIssues(base, auth, subJqlActive, 300).catch((e) => { console.error("[jira] subJqlActive failed:", e); return [] as JiraIssue[]; }),
      fetchAllIssues(base, auth, subJqlDone, 200).catch(() => [] as JiraIssue[]),
      fetchAllIssues(base, auth, newJql, 200),
      fetchAllIssues(base, auth, thaisJql, 200).catch((e) => { console.error("[jira] thaisJql failed:", e); return [] as JiraIssue[]; }),
    ]);

    // Merge and deduplicate board issues and subtasks
    const boardSeenKeys = new Set<string>();
    const boardIssues = [...boardActive, ...boardDone].filter(i =>
      boardSeenKeys.has(i.key) ? false : (boardSeenKeys.add(i.key), true)
    );
    const subSeenKeys = new Set<string>();
    const teamSubs = [...subActive, ...subDone].filter(i =>
      subSeenKeys.has(i.key) ? false : (subSeenKeys.add(i.key), true)
    );

    console.log("[jira] boardIssues total:", boardIssues.length, "(active:", boardActive.length, "done-week:", boardDone.length, ")");
    console.log("[jira] boardIssues assignees:", [...new Set(boardIssues.map(i => i.fields?.assignee?.displayName).filter(Boolean))]);
    console.log("[jira] teamSubs total:", teamSubs.length, "(active:", subActive.length, "done-week:", subDone.length, ")");
    console.log("[jira] teamSubs assignees:", [...new Set(teamSubs.map(i => i.fields?.assignee?.displayName).filter(Boolean))]);

    // Filter step 1: only direct team members
    const teamOnlyIssues = boardIssues.filter(i =>
      i.fields?.assignee ? isTeamMember(i.fields.assignee.displayName) : false
    );
    console.log("[jira] após filtro time:", teamOnlyIssues.length, "— descartados:", boardIssues.length - teamOnlyIssues.length);

    // Filter step 2: only Brasil (with fallback)
    const teamIssues = teamOnlyIssues.filter(i => isBrasil(i));
    console.log("[jira] após filtro Brasil:", teamIssues.length, "— descartados:", teamOnlyIssues.length - teamIssues.length);

    const descartadasPais = teamOnlyIssues.filter(i => !isBrasil(i));
    if (descartadasPais.length) {
      console.log("[jira] tasks descartadas por país:", descartadasPais.map(i => `${i.key} ${i.fields.summary?.slice(0, 30)}`));
    }


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
    // Fetch all missing parents by key (no status filter — we filter in code to support Done-this-week)
    const extraParentsAll: JiraIssue[] = missingKeys.length
      ? await fetchAllIssues(base, auth, `key in (${missingKeys.join(", ")})`, 1)
      : [];
    const extraParents = extraParentsAll.filter(i => {
      const s = (i.fields.status as { name: string } | null)?.name?.toLowerCase() ?? "";
      const cat = ((i.fields.status as { statusCategory?: { key?: string } } | null)?.statusCategory?.key ?? "").toLowerCase();
      if (s.includes("backlog") || s.includes("cancelad")) return false;
      if (cat === "done") return isDueThisWeek(i.fields.duedate);
      return true;
    });

    // Build set of parent keys that are NOT in backlog (used to gate subtask visibility)
    const allParentIssues = [
      ...boardIssues.filter(i => subParentMap.has(i.key)),
      ...extraParents,
    ];
    const activeParentKeys = new Set(
      allParentIssues
        .filter(i => {
          const s = (i.fields.status as { name: string } | null)?.name?.toLowerCase() ?? "";
          const cat = ((i.fields.status as { statusCategory?: { key?: string } } | null)?.statusCategory?.key ?? "").toLowerCase();
          if (s.includes("backlog") || s.includes("cancelad")) return false;
          if (cat === "done") return isDueThisWeek(i.fields.duedate);
          return true;
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
        flagged?: boolean;
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
      const rawParentKey = (issue.fields.parent as { key: string } | null)?.key;
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
        parentKey: rawParentKey && activeParentKeys.has(rawParentKey) ? rawParentKey : undefined,
        flagged: isFlagged(issue),
      });
    }

    for (const issue of allSubParents) {
      const assigneeNames = subParentMap.get(issue.key);
      if (!assigneeNames) continue;
      // Skip backlog and cancelled parents always; skip Done parents unless duedate is this week
      const rawStatus = (issue.fields.status as { name: string } | null)?.name?.toLowerCase() ?? "";
      const statusCat = ((issue.fields.status as { statusCategory?: { key?: string } } | null)?.statusCategory?.key ?? "").toLowerCase();
      if (rawStatus.includes("backlog") || rawStatus.includes("cancelad")) continue;
      if (statusCat === "done" || rawStatus.includes("done") || rawStatus.includes("conclu") ||
          rawStatus.includes("entregue") || rawStatus.includes("finaliz") || rawStatus.includes("resolv") ||
          rawStatus.includes("closed")) {
        if (!isDueThisWeek(issue.fields.duedate)) continue;
      }
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
          flagged: isFlagged(issue),
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
      const parentVisible = member.tasks.some((t) => t.key === parentKey);
      const est = estimateHours(sub.fields.summary, sub.fields.timeoriginalestimate);
      member.tasks.push({
        id: sub.key, key: sub.key, title: sub.fields.summary,
        status: mapStatus(sub.fields.status?.name || ""),
        priority: mapPriority(sub.fields.priority?.name || "Medium"),
        assignee: name, dueDate: sub.fields.duedate || null,
        estimatedHours: est.hours, estimatedDetail: est.detail,
        createdAt: sub.fields.created?.split("T")[0] || "",
        parentKey: parentVisible ? parentKey : undefined,
        flagged: isFlagged(sub),
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
        flagged: isFlagged(issue),
      });
    }

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
        subJqlActive,
      },
    });
  } catch (error) {
    console.error("[jira] ERRO NO CATCH:", error);
    console.error("[jira] stack:", error instanceof Error ? error.stack : "(sem stack)");
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: msg, team: [], alerts: [], newDemands: [] },
      { status: 500 }
    );
  }
}
