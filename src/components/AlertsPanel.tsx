"use client";

interface Alert {
  type: "capacity" | "deadline" | "briefing";
  message: string;
  severity: "critical" | "warning" | "info";
}

const severityStyles = {
  critical: {
    border: "border-l-red-600",
    bg: "bg-red-50",
    icon: "🔴",
  },
  warning: {
    border: "border-l-yellow-500",
    bg: "bg-yellow-50",
    icon: "🟡",
  },
  info: {
    border: "border-l-blue-500",
    bg: "bg-blue-50",
    icon: "🔵",
  },
};

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <div className="space-y-2">
      {alerts.map((alert, i) => {
        const style = severityStyles[alert.severity];
        return (
          <div
            key={i}
            className={`flex items-start gap-3 border-l-3 rounded-r-lg px-4 py-3 ${style.border} ${style.bg}`}
          >
            <span className="mt-0.5 text-sm">{style.icon}</span>
            <p className="text-sm text-gray-700">{alert.message}</p>
          </div>
        );
      })}
    </div>
  );
}
