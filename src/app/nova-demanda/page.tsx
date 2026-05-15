"use client";

import { useState } from "react";

const TIPOS = [
  "Anúncio/Performance",
  "Sinalização/Evento",
  "Motion/Vídeo",
  "Copy",
  "Produto/Demo",
  "Desdobramento/Adaptação",
];

type PageState = "idle" | "validating" | "questioning" | "creating" | "done" | "error";

interface SubtaskResult {
  label: string;
  assignee: string;
  key: string | null;
  deadline: string;
}

interface DoneResult {
  issueKey: string;
  jiraLink: string | null;
  subtasks: SubtaskResult[];
}

function formatBR(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export default function NovaDemanda() {
  const [titulo, setTitulo] = useState("");
  const [tipos, setTipos] = useState<string[]>([]);
  const [descricao, setDescricao] = useState("");
  const [prazo, setPrazo] = useState("");
  const [solicitante, setSolicitante] = useState("");

  const [pageState, setPageState] = useState<PageState>("idle");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<DoneResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const loading = pageState === "validating" || pageState === "creating";
  const formDisabled = loading || pageState === "questioning" || pageState === "done";

  /* ─── Validate briefing with Claude ─── */
  async function validate(desc: string): Promise<{ ok: boolean; question?: string }> {
    const res = await fetch("/api/nova-demanda/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo, tipos, descricao: desc, prazo }),
    });
    return res.json();
  }

  /* ─── Create Jira task ─── */
  async function createTask(desc: string) {
    setPageState("creating");
    try {
      const res = await fetch("/api/nova-demanda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, tipos, descricao: desc, prazo, solicitante }),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(data.error);
        setPageState("error");
      } else {
        setResult({
          issueKey: data.issueKey,
          jiraLink: data.jiraLink,
          subtasks: data.subtasks ?? [],
        });
        setPageState("done");
      }
    } catch {
      setErrorMsg("Erro de conexão. Tente novamente.");
      setPageState("error");
    }
  }

  /* ─── Submit form ─── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || tipos.length === 0 || !descricao.trim() || !prazo || !solicitante.trim()) return;

    setPageState("validating");
    try {
      const check = await validate(descricao);
      if (check.ok) {
        await createTask(descricao);
      } else {
        setQuestion(check.question ?? "Pode detalhar melhor o briefing?");
        setAnswer("");
        setPageState("questioning");
      }
    } catch {
      // fail-safe: create even if validate errors
      await createTask(descricao);
    }
  }

  /* ─── Submit answer to agent question ─── */
  async function handleAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;

    const enriched = `${descricao}\n\n[Complemento]: ${answer.trim()}`;
    setPageState("validating");
    try {
      const check = await validate(enriched);
      if (check.ok) {
        await createTask(enriched);
      } else {
        setQuestion(check.question ?? "Pode detalhar mais?");
        setAnswer("");
        setPageState("questioning");
      }
    } catch {
      await createTask(enriched);
    }
  }

  function reset() {
    setTitulo(""); setTipos([]); setDescricao(""); setPrazo(""); setSolicitante("");
    setQuestion(""); setAnswer(""); setResult(null); setErrorMsg("");
    setPageState("idle");
  }

  /* ─── Render ─── */

  // Done state
  if (pageState === "done" && result) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <a href="/" style={styles.back}>← Voltar ao painel</a>

          <div style={{ ...styles.card, marginTop: 16 }}>
            {/* Success header */}
            <div style={{ textAlign: "center", padding: "24px 0 16px" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111" }}>Demanda criada!</div>
              <div style={{
                display: "inline-block", marginTop: 8,
                background: "#ede9fe", color: "#7c3aed",
                fontWeight: 700, fontSize: 16,
                padding: "6px 18px", borderRadius: 8,
              }}>
                {result.issueKey}
              </div>
            </div>

            {/* Subtasks */}
            {result.subtasks.length > 0 && (
              <div style={{ margin: "16px 0", borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                  Subtasks abertas
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {result.subtasks.map((st, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 12px", borderRadius: 8, background: "#f9fafb",
                      border: "1px solid #f0f0f0",
                    }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13, color: "#111" }}>
                          {titulo} | {st.label}
                        </span>
                        <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 8 }}>
                          → {st.assignee}
                        </span>
                        {st.key && (
                          <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 6 }}>
                            {st.key}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "#7c3aed", fontWeight: 600, whiteSpace: "nowrap" }}>
                        até {formatBR(st.deadline)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              {result.jiraLink && (
                <a href={result.jiraLink} target="_blank" rel="noopener noreferrer" style={styles.btnPrimary}>
                  Ver no Jira ↗
                </a>
              )}
              <button onClick={reset} style={styles.btnSecondary}>
                Nova demanda
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <a href="/" style={styles.back}>← Voltar ao painel</a>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111", margin: "6px 0 16px" }}>
          📋 Nova demanda
        </h1>

        {/* Main form */}
        <form onSubmit={handleSubmit}>
          <div style={styles.card}>

            {/* Título */}
            <div style={styles.field}>
              <label style={styles.label}>Título do job *</label>
              <input
                type="text"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                disabled={formDisabled}
                placeholder="Ex: SMB ADS | Campanha Dia das Mães"
                style={styles.input}
                required
              />
            </div>

            {/* Tipos */}
            <div style={styles.field}>
              <label style={styles.label}>Tipo de peça *</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TIPOS.map((t) => {
                  const sel = tipos.includes(t);
                  return (
                    <button key={t} type="button"
                      disabled={formDisabled}
                      onClick={() => setTipos((p) => sel ? p.filter((x) => x !== t) : [...p, t])}
                      style={{
                        padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 500,
                        cursor: formDisabled ? "default" : "pointer",
                        border: sel ? "2px solid #7c3aed" : "1px solid #e5e7eb",
                        background: sel ? "#ede9fe" : "white",
                        color: sel ? "#7c3aed" : "#374151",
                        transition: "all 0.1s",
                        opacity: formDisabled ? 0.6 : 1,
                      }}>
                      {sel && "✓ "}{t}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Briefing */}
            <div style={styles.field}>
              <label style={styles.label}>Briefing *</label>
              <textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                disabled={formDisabled}
                placeholder="Contexto, especificações técnicas (formatos, dimensões), referências, mensagem principal e público-alvo..."
                rows={5}
                style={{ ...styles.input, resize: "vertical", lineHeight: 1.5 }}
                required
              />
            </div>

            {/* Prazo + Solicitante side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={styles.field}>
                <label style={styles.label}>Prazo de entrega *</label>
                <input
                  type="date"
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value)}
                  disabled={formDisabled}
                  style={styles.input}
                  required
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Solicitante *</label>
                <input
                  type="text"
                  value={solicitante}
                  onChange={(e) => setSolicitante(e.target.value)}
                  disabled={formDisabled}
                  placeholder="Seu nome"
                  style={styles.input}
                  required
                />
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !titulo.trim() || tipos.length === 0 || !descricao.trim() || !prazo || !solicitante.trim()}
              style={{
                ...styles.btnPrimary,
                marginTop: 8,
                opacity: (loading || !titulo.trim() || tipos.length === 0 || !descricao.trim() || !prazo || !solicitante.trim()) ? 0.5 : 1,
                cursor: loading ? "wait" : "pointer",
              }}>
              {pageState === "validating" ? "Analisando briefing..." :
               pageState === "creating"   ? "Criando no Jira..." :
               "Enviar demanda →"}
            </button>
          </div>
        </form>

        {/* Agent question */}
        {pageState === "questioning" && (
          <form onSubmit={handleAnswer}>
            <div style={{
              ...styles.card, marginTop: 12,
              borderLeft: "4px solid #f59e0b",
              background: "#fffbeb",
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>🤔</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
                    O agente precisa de mais uma informação
                  </div>
                  <div style={{ fontSize: 13, color: "#78350f", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {question}
                  </div>
                </div>
              </div>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Sua resposta..."
                rows={3}
                autoFocus
                style={{
                  ...styles.input,
                  resize: "vertical", lineHeight: 1.5,
                  background: "white",
                  borderColor: "#f59e0b",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="submit" disabled={!answer.trim() || loading}
                  style={{
                    ...styles.btnPrimary,
                    background: "#d97706",
                    opacity: !answer.trim() || loading ? 0.5 : 1,
                  }}>
                  {loading ? "Verificando..." : "Confirmar e criar →"}
                </button>
                <button type="button" onClick={() => createTask(descricao)}
                  style={{ ...styles.btnSecondary, fontSize: 12 }}>
                  Criar assim mesmo
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Error */}
        {pageState === "error" && (
          <div style={{
            ...styles.card, marginTop: 12,
            borderLeft: "4px solid #ef4444", background: "#fef2f2",
          }}>
            <div style={{ fontSize: 13, color: "#b91c1c" }}>❌ {errorMsg}</div>
            <button onClick={() => setPageState("idle")} style={{ ...styles.btnSecondary, marginTop: 10, fontSize: 12 }}>
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Shared styles ─── */
const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8f9fb",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    padding: "24px 16px 48px",
  } as React.CSSProperties,

  container: {
    width: "100%",
    maxWidth: 620,
    margin: "0 auto",
  } as React.CSSProperties,

  back: {
    fontSize: 12,
    color: "#7c3aed",
    textDecoration: "none",
  } as React.CSSProperties,

  card: {
    background: "white",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    padding: "20px",
    boxShadow: "0 1px 4px rgba(0,0,0,.06)",
  } as React.CSSProperties,

  field: {
    marginBottom: 14,
  } as React.CSSProperties,

  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#374151",
    marginBottom: 5,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  } as React.CSSProperties,

  input: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box" as const,
    color: "#111",
  } as React.CSSProperties,

  btnPrimary: {
    display: "block",
    width: "100%",
    padding: "11px 16px",
    borderRadius: 8,
    border: "none",
    background: "#7c3aed",
    color: "white",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "center" as const,
    textDecoration: "none",
  } as React.CSSProperties,

  btnSecondary: {
    display: "block",
    width: "100%",
    padding: "10px 16px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    background: "white",
    color: "#374151",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "center" as const,
    textDecoration: "none",
  } as React.CSSProperties,
};
