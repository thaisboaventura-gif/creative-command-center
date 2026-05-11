"use client";

import type { TeamMember } from "@/lib/types";

const barColors = [
  "bg-violet-400",
  "bg-blue-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-pink-400",
  "bg-cyan-400",
];

function getWeekDays(): { date: Date; label: string; isToday: boolean }[] {
  const today = new Date();
  const days: { date: Date; label: string; isToday: boolean }[] = [];
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  for (let i = 0; i < 14; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    days.push({
      date: d,
      label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      isToday: d.toDateString() === today.toDateString(),
    });
  }
  return days;
}

export function TimelineView({ team }: { team: TeamMember[] }) {
  const days = getWeekDays();
  const firstDay = days[0]?.date;
  const lastDay = days[days.length - 1]?.date;
  if (!firstDay || !lastDay) return null;

  const totalDays = days.length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="grid gap-0" style={{ gridTemplateColumns: `140px repeat(${totalDays}, 1fr)` }}>
          <div />
          {days.map((day) => (
            <div
              key={day.label}
              className={`text-center text-xs py-2 border-b border-gray-100 ${
                day.isToday
                  ? "text-violet-600 font-semibold"
                  : "text-gray-400"
              }`}
            >
              {day.label}
              {day.isToday && (
                <div className="w-1.5 h-1.5 rounded-full bg-violet-500 mx-auto mt-1" />
              )}
            </div>
          ))}

          {team.map((member, memberIdx) =>
            member.tasks.map((task, taskIdx) => {
              const start = task.createdAt ? new Date(task.createdAt) : firstDay;
              const end = task.dueDate ? new Date(task.dueDate) : lastDay;

              const startIdx = Math.max(
                0,
                days.findIndex((d) => d.date >= start)
              );
              const endIdx = Math.min(
                totalDays - 1,
                days.findIndex((d) => d.date >= end)
              );
              const effectiveEnd = endIdx === -1 ? totalDays - 1 : endIdx;

              const colorClass = barColors[(memberIdx + taskIdx) % barColors.length];

              return (
                <div key={task.id} className="contents">
                  <div className="flex items-center gap-2 py-2 border-b border-gray-50 pr-3">
                    {taskIdx === 0 && (
                      <span className="text-xs font-medium text-gray-700 truncate">
                        {member.name.split(" ")[0]}
                      </span>
                    )}
                  </div>
                  {days.map((_, dayIdx) => {
                    const isInRange = dayIdx >= startIdx && dayIdx <= effectiveEnd;
                    const isStart = dayIdx === startIdx;
                    const isEnd = dayIdx === effectiveEnd;

                    return (
                      <div
                        key={dayIdx}
                        className="flex items-center py-2 border-b border-gray-50"
                      >
                        {isInRange && (
                          <div
                            className={`h-6 w-full ${colorClass} flex items-center ${
                              isStart ? "rounded-l-md ml-1" : ""
                            } ${isEnd ? "rounded-r-md mr-1" : ""}`}
                            title={task.title}
                          >
                            {isStart && (
                              <span className="text-[10px] text-white font-medium px-2 truncate">
                                {task.title.slice(0, 25)}...
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
