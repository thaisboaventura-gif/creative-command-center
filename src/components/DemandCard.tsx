"use client";

import type { Task } from "@/lib/types";

const JIRA_BASE = "https://tiendanube.atlassian.net/browse";

const complexityColors = {
  baixa: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
  média: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  alta: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
};

export function DemandCard({ task }: { task: Task }) {
  const analysis = task.briefingAnalysis;
  if (!analysis) return null;

  const cc = complexityColors[analysis.complexity];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a
              href={`${JIRA_BASE}/${task.key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-violet-600 hover:text-violet-800 hover:underline"
            >
              {task.key}
            </a>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cc.bg} ${cc.text}`}>
              {analysis.complexity.toUpperCase()}
            </span>
          </div>
          <h3 className="font-semibold text-gray-900">{task.title}</h3>
        </div>
        {task.dueDate && (
          <span className="shrink-0 text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-md">
            Prazo: {new Date(task.dueDate).toLocaleDateString("pt-BR")}
          </span>
        )}
      </div>

      <div className="rounded-lg bg-violet-50 border border-violet-100 p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">✨</span>
          <span className="text-xs font-semibold text-violet-700 uppercase tracking-wider">
            Análise da IA
          </span>
        </div>
        <p className="text-sm text-gray-700 mb-3">{analysis.summary}</p>
        <div className="text-xs text-gray-500">
          Esforço: {analysis.estimatedEffort}
        </div>
      </div>

      {analysis.missingInfo.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">
            Falta no briefing
          </h4>
          <ul className="space-y-1">
            {analysis.missingInfo.map((info, i) => (
              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                <span className="text-red-400 mt-1">•</span>
                {info}
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.suggestedQuestions.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-2">
            Perguntas sugeridas
          </h4>
          <ol className="space-y-1">
            {analysis.suggestedQuestions.map((q, i) => (
              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                <span className="text-blue-500 mt-0.5 text-xs font-semibold">{i + 1}.</span>
                {q}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
        <h4 className="text-xs text-gray-400">Entregas:</h4>
        <div className="flex flex-wrap gap-1.5">
          {analysis.deliverables.map((d, i) => (
            <span
              key={i}
              className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md"
            >
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
