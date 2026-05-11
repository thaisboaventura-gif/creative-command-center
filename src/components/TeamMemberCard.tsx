"use client";

import { getCapacityStatus, getCapacityColor } from "@/lib/types";
import type { TeamMember } from "@/lib/types";

const JIRA_BASE = "https://tiendanube.atlassian.net/browse";

const statusLabels: Record<string, string> = {
  to_do: "A fazer",
  in_progress: "Em andamento",
  in_review: "Em revisão",
  done: "Concluído",
};

const priorityLabels: Record<string, { label: string; color: string }> = {
  critical: { label: "Crítica", color: "text-red-600" },
  high: { label: "Alta", color: "text-orange-600" },
  medium: { label: "Média", color: "text-amber-600" },
  low: { label: "Baixa", color: "text-green-600" },
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function TeamMemberCard({ member }: { member: TeamMember }) {
  const status = getCapacityStatus(member.capacityPercent);
  const colors = getCapacityColor(status);
  const clampedPercent = Math.min(member.capacityPercent, 100);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
            {member.avatar}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{member.name}</h3>
            <p className="text-xs text-gray-500">{member.role}</p>
          </div>
        </div>
        <div
          className="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
          style={{ backgroundColor: colors.bg, color: colors.text }}
        >
          {colors.label}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-500">Capacidade</span>
          <span className="text-xs font-semibold" style={{ color: colors.text }}>
            {member.capacityPercent}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${clampedPercent}%`,
              backgroundColor: colors.text,
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        {member.tasks.map((task) => {
          const days = daysUntil(task.dueDate);
          const priority = priorityLabels[task.priority];
          const isUrgent = days !== null && days <= 3;

          return (
            <div
              key={task.id}
              className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <a
                    href={`${JIRA_BASE}/${task.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-violet-600 hover:text-violet-800 hover:underline"
                  >
                    {task.key}
                  </a>
                </div>
                <p className="text-sm text-gray-800 mt-0.5">{task.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-500">
                    {statusLabels[task.status]}
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className={`text-xs ${priority.color}`}>
                    {priority.label}
                  </span>
                  {task.estimatedDays > 0 && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-gray-500">
                        {task.estimatedDays}d
                      </span>
                    </>
                  )}
                </div>
              </div>
              {days !== null && (
                <span
                  className={`shrink-0 text-xs font-medium rounded-md px-2 py-1 ${
                    isUrgent
                      ? "bg-red-50 text-red-600"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {days <= 0 ? "Atrasado!" : `${days}d`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
