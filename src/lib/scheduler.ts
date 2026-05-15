/**
 * Capacity-aware scheduler for nova-demanda subtasks.
 *
 * Strategy:
 *  1. Fetch each team member's open Jira tasks (due date + estimate)
 *  2. Build a daily commitment map (hours already booked per workday)
 *  3. For each new subtask, walk forward from the earliest possible start
 *     day looking for the FIRST workday with free capacity ≥ task hours.
 *  4. Respect dependency chains (Copy → Layout → Motion).
 *  5. If a person is fully booked in the allowed window, place the task at
 *     the latest acceptable date (will be tight but still ships on time).
 */

import { estimateHours } from "./estimate";

export const DAILY_CAPACITY: Record<string, number> = {
  eduardo: 13.5,
  larissa: 13.5,
  joao:    5.5,
  beatriz: 5.5,
  rafa:    8,
};

export const PERSON_DISPLAY: Record<string, string> = {
  eduardo: "Eduardo",
  larissa: "Larissa",
  joao:    "João",
  beatriz: "Beatriz",
  rafa:    "Rafa",
};

export interface PipelineLoad {
  /** Map: "YYYY-MM-DD" → committed hours on that day */
  daily: Map<string, number>;
}

/* ─── Date helpers ─── */

export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

function nextWorkDay(d: Date): Date {
  let r = new Date(d);
  while (isWeekend(r)) r = addDays(r, 1);
  return r;
}

function prevWorkDay(d: Date): Date {
  let r = new Date(d);
  while (isWeekend(r)) r = addDays(r, -1);
  return r;
}

export function subtractWorkDays(d: Date, n: number): Date {
  let r = new Date(d);
  let i = 0;
  while (i < n) {
    r = addDays(r, -1);
    if (!isWeekend(r)) i++;
  }
  return r;
}

/* ─── Fetch pipeline from Jira ─── */

interface RawIssue {
  fields: {
    summary?: string;
    duedate?: string | null;
    assignee?: { displayName?: string } | null;
    timeoriginalestimate?: number | null;
  };
}

function normName(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(" ")[0];
}

export async function fetchPipeline(
  base: string,
  auth: string,
  project: string
): Promise<Record<string, PipelineLoad>> {
  // Initialise empty load for every team member
  const result: Record<string, PipelineLoad> = {};
  for (const key of Object.keys(DAILY_CAPACITY)) {
    result[key] = { daily: new Map() };
  }

  const jql = `project = ${project} AND statusCategory != Done AND assignee IS NOT EMPTY AND duedate IS NOT EMPTY`;
  const fields = ["summary", "duedate", "assignee", "timeoriginalestimate"];
  const qf = fields.map((f) => `fields=${f}`).join("&");
  const url = `${base.replace(/\/$/, "")}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=200&${qf}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!res.ok) return result;
    const data = await res.json();
    const issues: RawIssue[] = data.issues ?? [];

    for (const issue of issues) {
      const assigneeName = issue.fields.assignee?.displayName ?? "";
      const key = normName(assigneeName);
      if (!result[key]) continue; // not on our team

      const due = issue.fields.duedate;
      if (!due) continue;

      const est = estimateHours(
        issue.fields.summary ?? "",
        issue.fields.timeoriginalestimate ?? null
      );
      const cur = result[key].daily.get(due) ?? 0;
      result[key].daily.set(due, cur + est.hours);
    }
  } catch (err) {
    console.warn("[scheduler] fetchPipeline failed:", err);
  }

  return result;
}

/* ─── Slot finder ─── */

export interface SlotConstraints {
  person: string;
  taskHours: number;
  earliest: Date;
  latest: Date;
}

/**
 * Returns the first workday in [earliest, latest] where the person has
 * enough free capacity for taskHours. If no day fits, returns latest.
 */
export function findSlot(load: PipelineLoad, c: SlotConstraints): Date {
  const cap = DAILY_CAPACITY[c.person] ?? 5.5;
  let start = nextWorkDay(c.earliest);
  const end = prevWorkDay(c.latest);

  // Window collapsed (earliest > latest) → return latest possible workday
  if (start > end) return end;

  // Walk forward looking for free slot
  let cur = new Date(start);
  while (cur <= end) {
    if (!isWeekend(cur)) {
      const committed = load.daily.get(formatDate(cur)) ?? 0;
      if (committed + c.taskHours <= cap) {
        return cur;
      }
    }
    cur = addDays(cur, 1);
  }

  // No free slot found — place at latest acceptable day (will be tight)
  return end;
}

/**
 * After scheduling a task, register its hours in the load map so the next
 * subtask sees the updated pipeline.
 */
export function bookSlot(load: PipelineLoad, day: Date, hours: number): void {
  const key = formatDate(day);
  load.daily.set(key, (load.daily.get(key) ?? 0) + hours);
}

/* ─── Hour estimation for new subtasks ─── */

interface PieceCount {
  statics: number;
  videos: number;
}

function parsePieceCounts(descricao: string): PieceCount {
  const s = descricao.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const staticsMatch = s.match(/(\d+)\s*(posts?|pecas?|estaticos?|cards?|banners?|artes?|stor(?:y|ies))/);
  const videosMatch  = s.match(/(\d+)\s*(videos?|motions?|reels?|animac|cartelas?)/);

  return {
    statics: staticsMatch ? parseInt(staticsMatch[1], 10) : 1,
    videos:  videosMatch  ? parseInt(videosMatch[1], 10)  : 1,
  };
}

export function estimateSubtaskHours(label: string, descricao: string, tipos: string[]): number {
  const counts = parsePieceCounts(descricao);
  const hasStatics = tipos.some((t) => t.includes("Anúncio") || t.includes("Performance") || t.includes("Desdobramento") || t.includes("Adaptação"));
  const hasMotion  = tipos.some((t) => t.includes("Motion") || t.includes("Vídeo"));

  switch (label) {
    case "Copy": {
      const sP = hasStatics ? counts.statics : 0;
      const vP = hasMotion  ? counts.videos  : 0;
      return Math.max(1, sP * 0.75 + vP * 0.5);
    }
    case "Layout vídeo":      return Math.max(2, counts.videos  * 4);
    case "Layout estáticos":  return Math.max(2, counts.statics * 2);
    case "Motion":            return Math.max(3, counts.videos  * 4);
    case "Sinalização":       return 4;
    case "Produto/Demo":      return 3;
    default:                  return 2;
  }
}

/* ─── Plan all subtasks ─── */

export interface SubtaskPlan {
  label:    string;   // "Copy" | "Layout vídeo" | etc.
  person:   string;   // "beatriz" | "eduardo" | etc.
  assignee: string;   // display name
  deadline: string;   // "YYYY-MM-DD"
  hours:    number;
}

export function planSubtasks(
  tipos: string[],
  descricao: string,
  mainDeadlineStr: string,
  pipeline: Record<string, PipelineLoad>
): SubtaskPlan[] {
  const D     = parseLocalDate(mainDeadlineStr);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const hasMotion  = tipos.some((t) => t.includes("Motion") || t.includes("Vídeo"));
  const hasPerf    = tipos.some((t) => t.includes("Anúncio") || t.includes("Performance") || t.includes("Desdobramento") || t.includes("Adaptação"));
  const hasCopy    = tipos.some((t) => t === "Copy");
  const hasSinal   = tipos.some((t) => t.includes("Sinalização") || t.includes("Evento"));
  const hasProd    = tipos.some((t) => t.includes("Produto") || t.includes("Demo"));

  // Hard deadlines (latest acceptable finish)
  const motionLatest  = D;
  const layoutVLatest = subtractWorkDays(D, 2);                       // motion needs 2 days after
  const layoutSLatest = hasMotion ? subtractWorkDays(D, 1) : D;       // 1 day before final, or D itself
  let copyLatest: Date;
  if      (hasMotion)             copyLatest = subtractWorkDays(layoutVLatest, 1);
  else if (hasPerf)               copyLatest = subtractWorkDays(layoutSLatest, 1);
  else                            copyLatest = D;

  const plans: SubtaskPlan[] = [];

  // 1 — Copy (Beatriz): as early as her calendar allows
  let copyFinish: Date | null = null;
  if (hasCopy) {
    const hours = estimateSubtaskHours("Copy", descricao, tipos);
    const slot  = findSlot(pipeline.beatriz, {
      person: "beatriz",
      taskHours: hours,
      earliest:  today,
      latest:    copyLatest,
    });
    copyFinish = slot;
    bookSlot(pipeline.beatriz, slot, hours);
    plans.push({ label: "Copy", person: "beatriz", assignee: "Beatriz", deadline: formatDate(slot), hours });
  }

  // 2 — Layout vídeo (Eduardo): after copy, earliest available
  let lvFinish: Date | null = null;
  if (hasMotion) {
    const hours    = estimateSubtaskHours("Layout vídeo", descricao, tipos);
    const earliest = copyFinish ? addDays(copyFinish, 1) : today;
    const slot     = findSlot(pipeline.eduardo, {
      person: "eduardo",
      taskHours: hours,
      earliest,
      latest:    layoutVLatest,
    });
    lvFinish = slot;
    bookSlot(pipeline.eduardo, slot, hours);
    plans.push({ label: "Layout vídeo", person: "eduardo", assignee: "Eduardo", deadline: formatDate(slot), hours });
  }

  // 3 — Layout estáticos (Eduardo): after layout vídeo (or after copy if no motion)
  if (hasPerf) {
    const hours    = estimateSubtaskHours("Layout estáticos", descricao, tipos);
    const earliest = lvFinish ? addDays(lvFinish, 1)
                   : copyFinish ? addDays(copyFinish, 1)
                   : today;
    const slot     = findSlot(pipeline.eduardo, {
      person: "eduardo",
      taskHours: hours,
      earliest,
      latest:    layoutSLatest,
    });
    bookSlot(pipeline.eduardo, slot, hours);
    plans.push({ label: "Layout estáticos", person: "eduardo", assignee: "Eduardo", deadline: formatDate(slot), hours });
  }

  // 4 — Motion (Larissa): after layout vídeo, finishes by D
  if (hasMotion) {
    const hours    = estimateSubtaskHours("Motion", descricao, tipos);
    const earliest = lvFinish ? addDays(lvFinish, 1) : today;
    const slot     = findSlot(pipeline.larissa, {
      person: "larissa",
      taskHours: hours,
      earliest,
      latest:    motionLatest,
    });
    bookSlot(pipeline.larissa, slot, hours);
    plans.push({ label: "Motion", person: "larissa", assignee: "Larissa", deadline: formatDate(slot), hours });
  }

  // Specialised (no dependency chain)
  if (hasSinal) {
    const hours = estimateSubtaskHours("Sinalização", descricao, tipos);
    const slot  = findSlot(pipeline.joao, { person: "joao", taskHours: hours, earliest: today, latest: D });
    bookSlot(pipeline.joao, slot, hours);
    plans.push({ label: "Sinalização", person: "joao", assignee: "João", deadline: formatDate(slot), hours });
  }
  if (hasProd) {
    const hours = estimateSubtaskHours("Produto/Demo", descricao, tipos);
    const slot  = findSlot(pipeline.joao, { person: "joao", taskHours: hours, earliest: today, latest: D });
    bookSlot(pipeline.joao, slot, hours);
    plans.push({ label: "Produto/Demo", person: "joao", assignee: "João", deadline: formatDate(slot), hours });
  }

  return plans;
}
