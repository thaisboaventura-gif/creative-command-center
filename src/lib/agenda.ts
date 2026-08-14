/* ─── Shared types and config for /agenda ─── */

export interface TeamMember {
  key: string;
  display: string;
  username: string | null;
  email: string;
  dailyH: number;
  role: string;
  area: "design" | "copy" | "motion";
}

export const TEAM_MEMBERS: TeamMember[] = [
  { key: "eduardo",    display: "Eduardo",    username: "eduardo.oliveira",    email: "eduardo.oliveira@nuvemshop.com.br",    dailyH: 6.5,  role: "Design + Motion",    area: "design" },
  { key: "gasparetto", display: "Gasparetto", username: "eduardo.gasparetto",  email: "eduardo.gasparetto@nuvemshop.com.br",  dailyH: 6.5,  role: "Design (EnP)",       area: "design" },
  { key: "gabriel",    display: "Gabriel",    username: null,                   email: "gabriel.cassino@nuvemshop.com.br",     dailyH: 6.5,  role: "Design",             area: "design" },
  { key: "larissa",    display: "Larissa",    username: "larissa.delarue",     email: "larissa.delarue@nuvemshop.com.br",     dailyH: 10.5, role: "Motion + Gravação",  area: "motion" },
  { key: "francisco",  display: "Francisco",  username: "francisco.fernandes",  email: "francisco.fernandes@nuvemshop.com.br", dailyH: 6.5,  role: "Audiovisual",        area: "motion" },
  { key: "joao",       display: "João",       username: "joao.camargo",         email: "joao.camargo@nuvemshop.com.br",        dailyH: 6.5,  role: "Sinalização",        area: "design" },
  { key: "beatriz",    display: "Beatriz",    username: "beatriz",              email: "beatriz@nuvemshop.com.br",             dailyH: 6.5,  role: "Copy",               area: "copy"   },
  { key: "rafa",       display: "Rafa",       username: "rafaela.ceragioli",    email: "rafaela.ceragioli@nuvemshop.com.br",   dailyH: 8,    role: "Overflow (Monstra)", area: "design" },
];

export interface AgendaTask {
  key: string;
  title: string;
  status: string;
  dueDate: string | null;
  estimatedH: number;
  isRecording: boolean;
  recordingDate: string | null;
  recordingTime: string | null;
  parentKey: string | null;
  assignee: string | null;
}

export interface DaySlot {
  date: string;
  label: string;
  totalCap: number;
  tasks: Array<{ key: string; title: string; hours: number; color: string }>;
  freeH: number;
  overloaded: boolean;
}

export interface AgendaResponse {
  member: TeamMember;
  tasks: AgendaTask[];
  days: DaySlot[];
  unassigned: AgendaTask[];
}

export const SLA_MAP: Record<string, number> = {
  "copy post":        0.5,
  "copy roteiro":     1,
  "copy estatico":    0.5,
  "copy carrossel":   1,
  "layout estatico":  3,
  "layout carrossel": 5,
  "storyboard 30s":   6,
  "storyboard 15s":   3,
  "thumbnail":        1,
  "cartela":          2,
  "gravacao":         5,
  "gravação":         5,
  "motion 6s":        1,
  "motion 15s":       2.5,
  "motion 30s":       5,
  "motion 1min":      10,
  "motion 60s":       10,
};

export function estimateFromSLA(title: string, description = ""): number {
  const t = (title + " " + description).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");

  const motionMatch = t.match(/motion[^0-9]*(\d+)\s*(s|seg|sec|min|m)\b/);
  if (motionMatch) {
    const val  = parseInt(motionMatch[1]);
    const unit = motionMatch[2];
    const secs = unit.startsWith("m") ? val * 60 : val;
    return Math.max(1, (secs / 30) * 5);
  }

  const countMatch = t.match(/(\d+)\s*(posts?|pecas?|estaticos?|cards?|banners?|artes?|roteiros?|cartelas?|thumbnails?)/);
  const count = countMatch ? parseInt(countMatch[1]) : 1;

  if (t.includes("gravac")) return 5;
  if (t.includes("storyboard") && t.includes("30")) return 6 * count;
  if (t.includes("storyboard") && t.includes("15")) return 3 * count;
  if (t.includes("carrossel") && t.includes("copy")) return 1 * count;
  if (t.includes("carrossel")) return 5 * count;
  if (t.includes("thumbnail")) return 1 * count;
  if (t.includes("cartela")) return 2 * count;
  if (t.includes("copy") || t.includes("roteiro")) return 0.5 * count;
  if (t.includes("layout") || t.includes("estatico") || t.includes("banner") || t.includes("post")) return 3 * count;
  if (t.includes("motion") || t.includes("animac")) return 5 * count;

  return 2;
}
