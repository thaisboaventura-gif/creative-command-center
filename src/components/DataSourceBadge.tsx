"use client";

export function DataSourceBadge({ source }: { source: "jira" | "mock" }) {
  const isLive = source === "jira";

  return (
    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1.5 shadow-sm">
      <span className="relative flex h-2.5 w-2.5">
        {isLive && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
            isLive ? "bg-green-500" : "bg-amber-500"
          }`}
        />
      </span>
      <span className="text-xs text-gray-600">
        {isLive ? "Conectado ao Jira" : "Dados de exemplo"}
      </span>
    </div>
  );
}
