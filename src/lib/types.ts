export interface TeamMember {
  name: string;
  avatar: string;
  role: string;
  tasks: Task[];
  capacityPercent: number;
}

export interface Task {
  id: string;
  key: string;
  title: string;
  status: "to_do" | "in_progress" | "in_review" | "done";
  priority: "low" | "medium" | "high" | "critical";
  assignee: string;
  dueDate: string | null;
  estimatedDays: number;
  createdAt: string;
  briefingAnalysis?: BriefingAnalysis;
}

export interface BriefingAnalysis {
  summary: string;
  complexity: "baixa" | "média" | "alta";
  estimatedEffort: string;
  missingInfo: string[];
  suggestedQuestions: string[];
  deliverables: string[];
}

export type CapacityStatus = "available" | "moderate" | "full" | "overloaded";

export function getCapacityStatus(percent: number): CapacityStatus {
  if (percent <= 50) return "available";
  if (percent <= 80) return "moderate";
  if (percent <= 100) return "full";
  return "overloaded";
}

export function getCapacityColor(status: CapacityStatus) {
  const colors = {
    available: { bg: "var(--color-green-soft)", text: "var(--color-green)", label: "Disponível" },
    moderate: { bg: "var(--color-yellow-soft)", text: "var(--color-yellow)", label: "Quase cheio" },
    full: { bg: "var(--color-red-soft)", text: "var(--color-red)", label: "Lotado" },
    overloaded: { bg: "var(--color-red-soft)", text: "var(--color-red)", label: "Sobrecarregado" },
  };
  return colors[status];
}
