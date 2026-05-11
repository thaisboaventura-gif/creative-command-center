"use client";

import type { TeamMember, Task } from "@/lib/types";

interface StatsBarProps {
  team: TeamMember[];
  newDemands: Task[];
}

export function StatsBar({ team, newDemands }: StatsBarProps) {
  const totalTasks = team.reduce((sum, m) => sum + m.tasks.length, 0);
  const avgCapacity = Math.round(
    team.reduce((sum, m) => sum + m.capacityPercent, 0) / team.length
  );
  const overloaded = team.filter((m) => m.capacityPercent >= 100).length;

  const stats = [
    { label: "Pessoas", value: team.length, color: "text-violet-600" },
    { label: "Tarefas ativas", value: totalTasks, color: "text-blue-600" },
    {
      label: "Capacidade média",
      value: `${avgCapacity}%`,
      color: avgCapacity > 80 ? "text-red-600" : "text-green-600",
    },
    {
      label: "Sobrecarregados",
      value: overloaded,
      color: overloaded > 0 ? "text-red-600" : "text-green-600",
    },
    { label: "Demandas novas", value: newDemands.length, color: "text-amber-600" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm"
        >
          <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}
