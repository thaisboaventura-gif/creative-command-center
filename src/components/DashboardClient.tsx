"use client";

import { useEffect, useState } from "react";
import { StatsBar } from "@/components/StatsBar";
import { TeamMemberCard } from "@/components/TeamMemberCard";
import { DemandCard } from "@/components/DemandCard";
import { AlertsPanel } from "@/components/AlertsPanel";
import { TimelineView } from "@/components/TimelineView";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { mockTeam, mockNewDemands, mockAlerts } from "@/lib/mock-data";
import type { TeamMember, Task } from "@/lib/types";

type AlertItem = { type: "capacity" | "deadline" | "briefing"; message: string; severity: "critical" | "warning" | "info" };

export function DashboardClient() {
  const [team, setTeam] = useState<TeamMember[]>(mockTeam);
  const [newDemands, setNewDemands] = useState<Task[]>(mockNewDemands);
  const [alerts, setAlerts] = useState<AlertItem[]>(mockAlerts);
  const [source, setSource] = useState<"jira" | "mock">("mock");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/jira")
      .then((res) => {
        if (!res.ok) throw new Error("API error");
        return res.json();
      })
      .then((data) => {
        if (data.team && data.team.length > 0) {
          setTeam(data.team);
          setAlerts(data.alerts || []);
          setNewDemands(data.newDemands || []);
          setSource("jira");
        }
      })
      .catch(() => {
        // keep mock data
      })
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const formattedDate = now.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen px-4 py-6 sm:px-8 max-w-[1400px] mx-auto">
      <header className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 text-violet-700 text-lg">
                ✦
              </span>
              Creative Command Center
            </h1>
            <p className="text-sm text-gray-500 mt-1">{formattedDate}</p>
          </div>
          <div className="flex items-center gap-3">
            {loading && (
              <span className="text-xs text-gray-400">Conectando ao Jira...</span>
            )}
            <DataSourceBadge source={source} />
          </div>
        </div>
      </header>

      <div className="space-y-8">
        <section>
          <StatsBar team={team} newDemands={newDemands} />
        </section>

        {alerts.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Alertas
            </h2>
            <AlertsPanel alerts={alerts} />
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Visão do time
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {team.map((member) => (
              <TeamMemberCard key={member.name} member={member} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Linha do tempo
          </h2>
          <TimelineView team={team} />
        </section>

        {newDemands.length > 0 && newDemands.some((d) => d.briefingAnalysis) && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Demandas recentes
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {newDemands.filter((d) => d.briefingAnalysis).map((demand) => (
                <DemandCard key={demand.id} task={demand} />
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="mt-12 pb-8 text-center">
        <p className="text-xs text-gray-400">
          Creative Command Center · Brand Creative · Nuvemshop
        </p>
      </footer>
    </div>
  );
}
