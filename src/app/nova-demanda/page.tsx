"use client";

import { useState } from "react";
import type { SubtaskResult } from "@/app/api/nova-demanda/route";

const TIPOS = [
  "Anúncio/Performance",
  "Sinalização/Evento",
  "Motion/Vídeo",
  "Copy",
  "Produto/Demo",
  "Desdobramento/Adaptação",
];

type Status = "idle" | "loading" | "success" | "error";

interface Result {
  issueKey: string;
  jiraLink: string | null;
  subtasks: SubtaskResult[];
  alerts: string[];
}

export default function NovaDemanda() {
  const [titulo, setTitulo] = useState("");
  const [tipos, setTipos] = useState<string[]>([]);
  const [descricao, setDescricao] = useState("");
  const [prazo, setPrazo] = useState("");
  const [solicitante, setSolicitante] = useState("");
  const [quemSolicitou, setQuemSolicitou] = useState("");
  const [apoio, setApoio] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  function toggleTipo(t: string) {
    setTipos((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }

  const canSubmit =
    titulo && tipos.length > 0 && descricao && prazo && solicitante && status !== "loading";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus("loading");
    setErrorMsg("");
    setResult(null);

    try {
      const res = await fetch("/api/nova-demanda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, tipos, descricao, prazo, solicitante, quemSolicitou: quemSolicitou || undefined, apoio: apoio || undefined }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setStatus("error");
        setErrorMsg(data.error || "Erro desconhecido");
        return;
      }

      setResult(data);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Falha de conexão");
    }
  }

  if (status === "success" && result) {
    return (
      <Shell>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div style={{ background: "white", borderRadius: 12, padding: 32, border: "1px solid #e5e7eb" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#dcfce7", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 12 }}>✓</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111", margin: "0 0 4px" }}>Demanda criada</h2>
              <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>{result.issueKey}</p>
            </div>

            {/* Subtasks table */}
            <div style={{ background: "#f9fafb", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                Subtasks criadas
              </div>
              {result.subtasks.map((st, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < result.subtasks.length - 1 ? "1px solid #e5e7eb" : "none", fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, color: "#111" }}>{st.label}</span>
                    {st.key && (
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>{st.key}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#374151" }}>
                    <span>{st.assignee}</span>
                    <span style={{ color: "#9ca3af" }}>{st.estimatedHours}h</span>
                  </div>
                </div>
              ))}
            </div>

            {result.alerts.length > 0 && (
              <div style={{ background: "#fffbeb", borderRadius: 8, padding: 12, marginBottom: 16, border: "1px solid #fde68a" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#92400e", marginBottom: 6 }}>Alertas</div>
                {result.alerts.map((a, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#78350f", marginBottom: 2 }}>{a}</div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {result.jiraLink && (
                <a href={result.jiraLink} target="_blank" rel="noopener noreferrer"
                  style={{ flex: 1, display: "block", textAlign: "center", padding: "10px 16px", borderRadius: 8, background: "#7c3aed", color: "white", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
                  Ver no Jira
                </a>
              )}
              <a href="/"
                style={{ flex: result.jiraLink ? 1 : undefined, display: "block", textAlign: "center", padding: "10px 16px", borderRadius: 8, background: "white", color: "#374151", textDecoration: "none", fontSize: 13, fontWeight: 600, border: "1px solid #e5e7eb" }}>
                Voltar ao painel
              </a>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <a href="/" style={{ fontSize: 12, color: "#7c3aed", textDecoration: "none" }}>← Voltar ao painel</a>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111", margin: "0 0 4px" }}>Nova demanda</h1>
        <p style={{ fontSize: 13, color: "#9ca3af", margin: "0 0 24px" }}>
          Preencha o briefing — a IA distribui automaticamente para a pessoa certa do time.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ background: "white", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb", display: "flex", flexDirection: "column", gap: 16 }}>

            <Field label="Título do job" required>
              <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex: 6 posts estáticos para campanha Dia das Mães"
                style={inputStyle} />
            </Field>

            <Field label="Tipo" required hint="Pode selecionar mais de um">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TIPOS.map((t) => {
                  const selected = tipos.includes(t);
                  return (
                    <button key={t} type="button" onClick={() => toggleTipo(t)}
                      style={{
                        padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: "pointer",
                        border: selected ? "2px solid #7c3aed" : "1px solid #e5e7eb",
                        background: selected ? "#ede9fe" : "white",
                        color: selected ? "#7c3aed" : "#374151",
                        transition: "all 0.1s",
                      }}>
                      {selected && <span style={{ marginRight: 4 }}>✓</span>}
                      {t}
                    </button>
                  );
                })}
              </div>
              {tipos.length > 1 && (
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "#7c3aed" }}>
                  {tipos.length} tipos selecionados — será criada 1 subtask por tipo
                </p>
              )}
            </Field>

            <Field label="Descrição" required>
              <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)}
                placeholder="Descreva o que precisa, contexto, referências, público-alvo..."
                rows={4} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Prazo desejado" required>
                <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)}
                  style={inputStyle} />
              </Field>
              <Field label="Solicitante" required>
                <input type="text" value={solicitante} onChange={(e) => setSolicitante(e.target.value)}
                  placeholder="Seu nome" style={inputStyle} />
              </Field>
            </div>

            <Field label="Quem solicitou?" hint="Opcional — nome de quem pediu a demanda">
              <input type="text" value={quemSolicitou} onChange={(e) => setQuemSolicitou(e.target.value)}
                placeholder="Nome da pessoa que pediu essa demanda"
                style={inputStyle} />
            </Field>

            <Field label="Material de apoio" hint="Opcional — link do drive, Figma, doc, etc.">
              <input type="text" value={apoio} onChange={(e) => setApoio(e.target.value)}
                placeholder="https://..." style={inputStyle} />
            </Field>
          </div>

          {errorMsg && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#dc2626" }}>
              {errorMsg}
            </div>
          )}

          <button type="submit" disabled={!canSubmit}
            style={{
              width: "100%", marginTop: 16, padding: "12px 24px", borderRadius: 10, border: "none",
              fontSize: 14, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed",
              background: canSubmit ? "#7c3aed" : "#e5e7eb",
              color: canSubmit ? "white" : "#9ca3af",
              transition: "all 0.15s",
            }}>
            {status === "loading"
              ? "Criando task e subtasks..."
              : tipos.length > 1
                ? `Criar demanda com ${tipos.length} subtasks`
                : "Criar demanda"}
          </button>
        </form>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f8f9fb", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 16px" }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
        {label}{required && <span style={{ color: "#dc2626" }}> *</span>}
        {hint && <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  fontSize: 13,
  color: "#111",
  outline: "none",
  background: "#fafafa",
  boxSizing: "border-box",
};
