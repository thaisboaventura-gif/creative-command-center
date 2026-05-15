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
  deadline: string;
  key: string | null;
}

interface DoneResult {
  issueKey: string;
  jiraLink: string | null;
  subtasks: SubtaskResult[];
}

function formatBR(dateStr: string) {
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

  const busy = pageState === "validating" || pageState === "creating";
  const locked = busy || pageState === "questioning";
  const canSubmit = titulo.trim() && tipos.length > 0 && descricao.trim() && prazo && solicitante.trim();

  async function validate(desc: string) {
    const res = await fetch("/api/nova-demanda/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo, tipos, descricao: desc, prazo }),
    });
    return res.json() as Promise<{ ok: boolean; question?: string }>;
  }

  async function createTask(desc: string) {
    setPageState("creating");
    try {
      const res = await fetch("/api/nova-demanda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, tipos, descricao: desc, prazo, solicitante }),
      });
      const data = await res.json();
      if (data.error) { setErrorMsg(data.error); setPageState("error"); }
      else { setResult({ issueKey: data.issueKey, jiraLink: data.jiraLink, subtasks: data.subtasks ?? [] }); setPageState("done"); }
    } catch { setErrorMsg("Erro de conexão."); setPageState("error"); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setPageState("validating");
    try {
      const check = await validate(descricao);
      if (check.ok) await createTask(descricao);
      else { setQuestion(check.question ?? "Pode detalhar melhor o briefing?"); setAnswer(""); setPageState("questioning"); }
    } catch { await createTask(descricao); }
  }

  async function handleAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || busy) return;
    const enriched = `${descricao}\n\n${answer.trim()}`;
    setPageState("validating");
    try {
      const check = await validate(enriched);
      if (check.ok) await createTask(enriched);
      else { setQuestion(check.question ?? "Mais algum detalhe?"); setAnswer(""); setPageState("questioning"); }
    } catch { await createTask(enriched); }
  }

  function reset() {
    setTitulo(""); setTipos([]); setDescricao(""); setPrazo(""); setSolicitante("");
    setQuestion(""); setAnswer(""); setResult(null); setErrorMsg("");
    setPageState("idle");
  }

  /* ── Done ── */
  if (pageState === "done" && result) {
    return (
      <div style={pg}>
        <div style={wrap}>
          <a href="/" style={backLink}>← Painel</a>
          <div style={{ marginTop: 32, textAlign: "center" }}>
            <div style={{ fontSize: 36 }}>✅</div>
            <h2 style={{ margin: "8px 0 4px", fontSize: 20, fontWeight: 700 }}>Demanda criada!</h2>
            <span style={{ display: "inline-block", background: "#ede9fe", color: "#7c3aed", fontWeight: 700, fontSize: 15, padding: "4px 16px", borderRadius: 6 }}>
              {result.issueKey}
            </span>
          </div>

          {result.subtasks.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Subtasks</p>
              {result.subtasks.map((st, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{titulo} | {st.label}</span>
                    <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 8 }}>→ {st.assignee}</span>
                    {st.key && <span style={{ fontSize: 11, color: "#d1d5db", marginLeft: 6 }}>{st.key}</span>}
                  </div>
                  <span style={{ fontSize: 12, color: "#7c3aed", fontWeight: 600 }}>{formatBR(st.deadline)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            {result.jiraLink && (
              <a href={result.jiraLink} target="_blank" rel="noopener noreferrer" style={btnPrimary}>Ver no Jira ↗</a>
            )}
            <button onClick={reset} style={btnGhost}>Nova demanda</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Form ── */
  return (
    <div style={pg}>
      <div style={wrap}>
        <a href="/" style={backLink}>← Painel</a>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#111", margin: "6px 0 24px" }}>Nova demanda</h1>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Título */}
          <div>
            <label style={lbl}>Título</label>
            <input style={inp} type="text" value={titulo} disabled={locked}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Ex: SMB ADS | Campanha Dia das Mães" />
          </div>

          {/* Tipo */}
          <div>
            <label style={lbl}>Tipo de peça</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {TIPOS.map(t => {
                const sel = tipos.includes(t);
                return (
                  <button key={t} type="button" disabled={locked}
                    onClick={() => setTipos(p => sel ? p.filter(x => x !== t) : [...p, t])}
                    style={{
                      padding: "5px 11px", borderRadius: 20, fontSize: 12,
                      fontWeight: sel ? 600 : 400,
                      border: sel ? "1.5px solid #7c3aed" : "1px solid #d1d5db",
                      background: sel ? "#ede9fe" : "white",
                      color: sel ? "#7c3aed" : "#6b7280",
                      cursor: locked ? "default" : "pointer",
                      transition: "all .1s",
                    }}>
                    {sel ? "✓ " : ""}{t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Briefing */}
          <div>
            <label style={lbl}>Briefing</label>
            <textarea style={{ ...inp, resize: "vertical", lineHeight: 1.55, minHeight: 100 }}
              value={descricao} disabled={locked}
              onChange={e => setDescricao(e.target.value)}
              placeholder="Contexto, formatos/dimensões, mensagem principal, referências, público-alvo..."
              rows={4} />
          </div>

          {/* Prazo + Solicitante */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={lbl}>Prazo</label>
              <input style={inp} type="date" value={prazo} disabled={locked} onChange={e => setPrazo(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Solicitante</label>
              <input style={inp} type="text" value={solicitante} disabled={locked}
                onChange={e => setSolicitante(e.target.value)} placeholder="Seu nome" />
            </div>
          </div>

          {/* Agent question — inline, above submit */}
          {pageState === "questioning" && (
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "14px 16px" }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "#92400e", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                🤔 {question}
              </p>
              <textarea style={{ ...inp, background: "white", minHeight: 64, resize: "vertical" }}
                value={answer} autoFocus rows={3}
                onChange={e => setAnswer(e.target.value)}
                placeholder="Sua resposta..." />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" onClick={handleAnswer} disabled={!answer.trim() || busy}
                  style={{ ...btnPrimary, background: "#d97706", opacity: !answer.trim() || busy ? .5 : 1, width: "auto", padding: "8px 18px", fontSize: 12 }}>
                  {busy ? "Verificando..." : "Confirmar →"}
                </button>
                <button type="button" onClick={() => createTask(descricao)}
                  style={{ ...btnGhost, width: "auto", padding: "8px 14px", fontSize: 12 }}>
                  Criar assim mesmo
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {pageState === "error" && (
            <p style={{ fontSize: 13, color: "#b91c1c", margin: 0 }}>❌ {errorMsg}</p>
          )}

          {/* Submit */}
          {pageState !== "questioning" && (
            <button type="submit" disabled={!canSubmit || busy}
              style={{ ...btnPrimary, opacity: !canSubmit || busy ? .45 : 1, cursor: busy ? "wait" : "pointer" }}>
              {pageState === "validating" ? "Analisando..." :
               pageState === "creating"   ? "Criando no Jira..." :
               "Criar demanda →"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

/* ── Tokens ── */
const pg: React.CSSProperties = {
  minHeight: "100vh", background: "#f8f9fb",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  padding: "28px 16px 64px",
};
const wrap: React.CSSProperties = { width: "100%", maxWidth: 560, margin: "0 auto" };
const backLink: React.CSSProperties = { fontSize: 12, color: "#7c3aed", textDecoration: "none" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 };
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 11px", borderRadius: 7,
  border: "1px solid #d1d5db", fontSize: 13, outline: "none",
  fontFamily: "inherit", boxSizing: "border-box", color: "#111",
  background: "white",
};
const btnPrimary: React.CSSProperties = {
  display: "block", width: "100%", padding: "11px 16px", borderRadius: 8,
  border: "none", background: "#7c3aed", color: "white",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
  textAlign: "center", textDecoration: "none",
};
const btnGhost: React.CSSProperties = {
  display: "block", width: "100%", padding: "10px 16px", borderRadius: 8,
  border: "1px solid #d1d5db", background: "white", color: "#374151",
  fontSize: 13, fontWeight: 500, cursor: "pointer",
  textAlign: "center", textDecoration: "none",
};
