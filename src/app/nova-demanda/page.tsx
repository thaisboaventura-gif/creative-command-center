"use client";

import { useState } from "react";

/* ─── Config ─── */

const AREAS = ["Growth", "Performance", "D2C", "Next", "PMM", "RH", "Eventos", "Social", "CTAs", "Outros"];

const TIPOS = [
  "Anúncio/Performance",
  "Sinalização/Evento",
  "Motion/Vídeo",
  "Copy",
  "Desdobramento/Adaptação",
  "Revisão de apresentação",
  "Banner/Header/WhatsApp image",
];

/* ─── Types ─── */

type PageState =
  | "idle"
  | "validating"
  | "needs_clarification"
  | "deadline_issue"
  | "creating"
  | "done"
  | "done_unassigned";

interface FormData {
  nomeTask: string;
  area: string;
  areaOutros: string;
  tipos: string[];
  estaticos: number;
  videos: number;
  dimensoesEstaticos: string;
  dimensoesVideos: string;
  duracaoVideos: string;
  sobreOQue: string;
  pedidoResumido: string;
  mensagem: string;
  prazo: string;
  solicitanteNome: string;
  solicitanteEmail: string;
}

interface SubtaskResult {
  label: string;
  assignee: string;
  deadline: string;
  hours: number;
  key: string | null;
}

interface DeadlineIssue {
  min_date: string;
  min_days: number;
  hours_needed: number;
  capacity_available: number;
}

interface DoneResult {
  issueKey: string;
  jiraLink: string | null;
  subtasks: SubtaskResult[];
}

/* ─── Helpers ─── */

function formatBR(s: string) {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function Counter({ value, max }: { value: string; max: number }) {
  const n = value.length;
  const over = n > max;
  return (
    <span style={{ fontSize: 10, color: over ? "#dc2626" : "#9ca3af", marginLeft: 4 }}>
      {n}/{max}
    </span>
  );
}

function NumSelect({ value, max, onChange, disabled }: { value: number; max: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      disabled={disabled}
      style={{ ...inp, padding: "7px 10px", cursor: disabled ? "default" : "pointer" }}
    >
      {Array.from({ length: max + 1 }, (_, i) => (
        <option key={i} value={i}>{i === 0 ? "0 (nenhum)" : i}</option>
      ))}
    </select>
  );
}

/* ─── Main ─── */

const emptyForm = (): FormData => ({
  nomeTask: "", area: "", areaOutros: "", tipos: [],
  estaticos: 0, videos: 0,
  dimensoesEstaticos: "", dimensoesVideos: "", duracaoVideos: "",
  sobreOQue: "", pedidoResumido: "", mensagem: "",
  prazo: "", solicitanteNome: "", solicitanteEmail: "",
});

export default function NovaDemanda() {
  const [form, setForm] = useState<FormData>(emptyForm());
  const [pageState, setPageState] = useState<PageState>("idle");

  // Clarification
  const [questions, setQuestions] = useState<string[]>([]);
  const [clarAnswer, setClarAnswer] = useState("");

  // Deadline issue
  const [deadlineIssue, setDeadlineIssue] = useState<DeadlineIssue | null>(null);
  const [newPrazo, setNewPrazo] = useState("");

  // Results
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const [doneUnassignedKey, setDoneUnassignedKey] = useState<{ key: string; link: string | null } | null>(null);

  // Attachments
  const [anexos, setAnexos] = useState<File[]>([]);

  const busy = pageState === "validating" || pageState === "creating";

  function set<K extends keyof FormData>(k: K, v: FormData[K]) {
    setForm(p => ({ ...p, [k]: v }));
  }

  function toggleTipo(t: string) {
    setForm(p => ({
      ...p,
      tipos: p.tipos.includes(t) ? p.tipos.filter(x => x !== t) : [...p.tipos, t],
    }));
  }

  /* ─── Validate ─── */
  async function doValidate(extraNote?: string): Promise<void> {
    setPageState("validating");
    try {
      const body = buildPayload("validate", extraNote);
      const res = await fetch("/api/nova-demanda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();

      if (data.status === "needs_clarification") {
        setQuestions(data.questions ?? []);
        setClarAnswer("");
        setPageState("needs_clarification");
      } else if (data.status === "deadline_issue") {
        setDeadlineIssue(data);
        setNewPrazo(data.min_date ?? "");
        setPageState("deadline_issue");
      } else {
        // ok — proceed to create
        await doCreate();
      }
    } catch {
      await doCreate(); // fail-safe
    }
  }

  /* ─── Create (normal) ─── */
  async function doCreate(extraNote?: string): Promise<void> {
    setPageState("creating");
    try {
      const payload = buildPayload("create", extraNote);
      const fd = new FormData();
      for (const [k, v] of Object.entries(payload)) {
        fd.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v ?? ""));
      }
      anexos.forEach(f => fd.append("files", f));
      const res = await fetch("/api/nova-demanda", { method: "POST", body: fd });
      const data = await res.json();
      if (data.status === "created") {
        setDoneResult({ issueKey: data.issueKey, jiraLink: data.jiraLink, subtasks: data.subtasks ?? [] });
        setPageState("done");
      } else {
        setPageState("idle");
      }
    } catch { setPageState("idle"); }
  }

  /* ─── Create unassigned ─── */
  async function doCreateUnassigned(): Promise<void> {
    setPageState("creating");
    try {
      const payload = buildPayload("force_create");
      const fd = new FormData();
      for (const [k, v] of Object.entries(payload)) {
        fd.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v ?? ""));
      }
      anexos.forEach(f => fd.append("files", f));
      const res = await fetch("/api/nova-demanda", { method: "POST", body: fd });
      const data = await res.json();
      setDoneUnassignedKey({ key: data.issueKey, link: data.jiraLink });
      setPageState("done_unassigned");
    } catch { setPageState("idle"); }
  }

  function buildPayload(mode: string, extraNote?: string) {
    const prazoToUse = mode === "create" && newPrazo ? newPrazo : form.prazo;
    const enrichedPedido = extraNote
      ? `${form.pedidoResumido}\n\n[Complemento]: ${extraNote}`
      : form.pedidoResumido;
    return { ...form, prazo: prazoToUse, pedidoResumido: enrichedPedido, mode };
  }

  /* ─── canSubmit ─── */
  const areaFilled = form.area && (form.area !== "Outros" || form.areaOutros.trim());
  const canSubmit = !!(
    form.nomeTask.trim() && areaFilled && form.tipos.length > 0 &&
    form.sobreOQue.trim() && form.pedidoResumido.trim() && form.mensagem.trim() &&
    form.prazo && form.solicitanteNome.trim() && form.solicitanteEmail.trim()
  );

  /* ─── Done screens ─── */

  if (pageState === "done_unassigned" && doneUnassignedKey) {
    return (
      <div style={pg}>
        <div style={wrap}>
          <div style={{ ...card, borderLeft: "4px solid #f59e0b" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px" }}>Negociar prazo com Thais Boaventura</h2>
            <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6, margin: "0 0 16px" }}>
              Essa demanda precisa de mais tempo do que o prazo informado permite.<br />
              A task foi criada mas precisa de análise antes de ser distribuída.<br />
              Thais vai entrar em contato em breve.
            </p>
            <div style={{ background: "#fef3c7", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "inline-block" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#92400e" }}>
                {doneUnassignedKey.key}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {doneUnassignedKey.link && (
                <a href={doneUnassignedKey.link} target="_blank" rel="noopener noreferrer" style={btnPrimary}>Ver no Jira ↗</a>
              )}
              <a href="/" style={btnGhost}>Voltar ao painel</a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (pageState === "done" && doneResult) {
    return (
      <div style={pg}>
        <div style={wrap}>
          <div style={card}>
            <div style={{ textAlign: "center", paddingBottom: 16 }}>
              <div style={{ fontSize: 36 }}>✅</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 10px" }}>Demanda criada!</h2>
              {doneResult.issueKey ? (
                <a
                  href={doneResult.jiraLink ?? "#"}
                  target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-block", background: "#ede9fe", color: "#7c3aed", fontWeight: 700, fontSize: 15, padding: "6px 18px", borderRadius: 6, textDecoration: "none" }}
                >
                  {doneResult.issueKey} ↗
                </a>
              ) : (
                <span style={{ fontSize: 13, color: "#9ca3af" }}>Task criada — número não disponível</span>
              )}
            </div>

            {doneResult.subtasks.length > 0 && (
              <div style={{ marginTop: 16, borderTop: "1px solid #f3f4f6", paddingTop: 12 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, margin: "0 0 10px" }}>Subtasks</p>
                {doneResult.subtasks.map((st, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f9fafb" }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{form.nomeTask} | {st.label}</span>
                      <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 8 }}>→ {st.assignee}</span>
                      <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 6 }}>({st.hours}h)</span>
                    </div>
                    <span style={{ fontSize: 12, color: "#7c3aed", fontWeight: 600 }}>{formatBR(st.deadline)}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              {doneResult.jiraLink && (
                <a href={doneResult.jiraLink} target="_blank" rel="noopener noreferrer" style={btnPrimary}>Abrir no Jira ↗</a>
              )}
              <button onClick={() => { setForm(emptyForm()); setPageState("idle"); setDoneResult(null); setAnexos([]); }} style={btnGhost}>
                Nova demanda
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Form ─── */

  return (
    <div style={pg}>
      <div style={wrap}>
        <a href="/" style={{ fontSize: 12, color: "#7c3aed", textDecoration: "none" }}>← Painel</a>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#111", margin: "6px 0 20px" }}>Nova demanda</h1>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* 1 — Nome da task */}
          <div>
            <label style={lbl}>
              Nome da task *
              <Counter value={form.nomeTask} max={40} />
            </label>
            <input style={inp} type="text" maxLength={40} disabled={busy}
              value={form.nomeTask} onChange={e => set("nomeTask", e.target.value)}
              placeholder="Ex: SMB ADS" />
          </div>

          {/* 2 — Área */}
          <div>
            <label style={lbl}>Área relacionada *</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {AREAS.map(a => {
                const sel = form.area === a;
                return (
                  <button key={a} type="button" disabled={busy}
                    onClick={() => set("area", a)}
                    style={{
                      padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: sel ? 700 : 400,
                      border: sel ? "2px solid #7c3aed" : "1px solid #d1d5db",
                      background: sel ? "#ede9fe" : "white",
                      color: sel ? "#7c3aed" : "#6b7280",
                      cursor: busy ? "default" : "pointer", transition: "all .1s",
                    }}>
                    {a}
                  </button>
                );
              })}
            </div>
            {form.area === "Outros" && (
              <input style={{ ...inp, marginTop: 8 }} type="text" disabled={busy}
                value={form.areaOutros} onChange={e => set("areaOutros", e.target.value)}
                placeholder="Qual área?" />
            )}
          </div>

          {/* 3 — Tipo */}
          <div>
            <label style={lbl}>Tipo de peça * (pode selecionar mais de um)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {TIPOS.map(t => {
                const sel = form.tipos.includes(t);
                return (
                  <button key={t} type="button" disabled={busy}
                    onClick={() => toggleTipo(t)}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: sel ? 600 : 400,
                      border: sel ? "2px solid #7c3aed" : "1px solid #d1d5db",
                      background: sel ? "#ede9fe" : "white",
                      color: sel ? "#7c3aed" : "#6b7280",
                      cursor: busy ? "default" : "pointer", transition: "all .1s",
                    }}>
                    {sel ? "✓ " : ""}{t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4 — Número de peças */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={lbl}>Estáticos</label>
              <NumSelect value={form.estaticos} max={50} disabled={busy} onChange={v => set("estaticos", v)} />
            </div>
            <div>
              <label style={lbl}>Vídeos</label>
              <NumSelect value={form.videos} max={20} disabled={busy} onChange={v => set("videos", v)} />
            </div>
          </div>

          {/* 5 — Dimensões (condicionais) */}
          {form.estaticos > 0 && (
            <div>
              <label style={lbl}>Dimensões dos estáticos</label>
              <textarea style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} rows={2} disabled={busy}
                value={form.dimensoesEstaticos} onChange={e => set("dimensoesEstaticos", e.target.value)}
                placeholder="Ex: 1080×1080, 1080×1920" />
            </div>
          )}
          {form.videos > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={lbl}>Dimensões dos vídeos</label>
                <textarea style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} rows={2} disabled={busy}
                  value={form.dimensoesVideos} onChange={e => set("dimensoesVideos", e.target.value)}
                  placeholder="Ex: 9:16, 1:1, 4:5" />
              </div>
              <div>
                <label style={lbl}>Duração dos vídeos</label>
                <input style={inp} type="text" disabled={busy}
                  value={form.duracaoVideos} onChange={e => set("duracaoVideos", e.target.value)}
                  placeholder="Ex: 15s, 30s" />
              </div>
            </div>
          )}

          {/* 6 — Descritivo */}
          <div>
            <label style={lbl}>
              Sobre o que? *
              <Counter value={form.sobreOQue} max={500} />
            </label>
            <textarea style={{ ...inp, resize: "vertical", minHeight: 100, lineHeight: 1.5 }}
              rows={4} maxLength={500} disabled={busy}
              value={form.sobreOQue} onChange={e => set("sobreOQue", e.target.value)}
              placeholder="Ex: Campanha SMB ADS para lojistas que visitaram a LP de planos" />
          </div>
          <div>
            <label style={lbl}>
              Pedido resumido *
              <Counter value={form.pedidoResumido} max={1000} />
            </label>
            <textarea style={{ ...inp, resize: "vertical", minHeight: 100, lineHeight: 1.5 }}
              rows={4} maxLength={1000} disabled={busy}
              value={form.pedidoResumido} onChange={e => set("pedidoResumido", e.target.value)}
              placeholder="Ex: 6 estáticos Meta Ads + 2 vídeos 9:16 para SMB ADS" />
          </div>
          <div>
            <label style={lbl}>
              Qual mensagem quer passar? *
              <Counter value={form.mensagem} max={1000} />
            </label>
            <textarea style={{ ...inp, resize: "vertical", minHeight: 100, lineHeight: 1.5 }}
              rows={4} maxLength={1000} disabled={busy}
              value={form.mensagem} onChange={e => set("mensagem", e.target.value)}
              placeholder="Ex: Abra sua loja com planos a partir de R$0 — SMB ADS" />
          </div>

          {/* 7 — Anexos */}
          <div>
            <label style={lbl}>
              Anexos <span style={{ fontWeight: 400, color: "#9ca3af" }}>(opcional)</span>
            </label>
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 8px" }}>
              Referências, mockups, briefing detalhado, etc.
            </p>
            <label style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", border: "1px dashed #d1d5db", borderRadius: 8,
              background: busy ? "#f9fafb" : "#fafafa", cursor: busy ? "default" : "pointer",
              fontSize: 12, color: "#6b7280", userSelect: "none",
            }}>
              <span>📎</span>
              <span>Selecionar arquivos</span>
              <input
                type="file" multiple
                accept="image/*,.pdf,.doc,.docx,.ppt,.pptx"
                disabled={busy}
                style={{ display: "none" }}
                onChange={e => {
                  const files = Array.from(e.target.files ?? []);
                  setAnexos(prev => [...prev, ...files]);
                  e.target.value = "";
                }}
              />
            </label>
            {anexos.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {anexos.map((f, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "5px 10px", background: "#f3f4f6", borderRadius: 6,
                  }}>
                    <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>
                      {f.name}
                    </span>
                    <span style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap" }}>
                      {f.size < 1024 * 1024
                        ? `${(f.size / 1024).toFixed(0)} KB`
                        : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                    <button
                      type="button" disabled={busy}
                      onClick={() => setAnexos(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}
                      title="Remover"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 8 — Prazo */}
          <div>
            <label style={lbl}>Prazo desejado *</label>
            <input
              style={{ ...inp, cursor: "pointer" }}
              type="date" disabled={busy}
              value={form.prazo}
              onChange={e => set("prazo", e.target.value)}
              onClick={e => {
                try { (e.target as HTMLInputElement).showPicker(); } catch { /* navegador sem suporte */ }
              }}
            />
          </div>

          {/* 8 — Solicitante */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={lbl}>Nome completo *</label>
              <input style={inp} type="text" disabled={busy}
                value={form.solicitanteNome} onChange={e => set("solicitanteNome", e.target.value)}
                placeholder="Seu nome" />
            </div>
            <div>
              <label style={lbl}>Email *</label>
              <input style={inp} type="email" disabled={busy}
                value={form.solicitanteEmail} onChange={e => set("solicitanteEmail", e.target.value)}
                placeholder="seu@email.com" />
            </div>
          </div>

          {/* ─── Needs Clarification card ─── */}
          {pageState === "needs_clarification" && questions.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: 16 }}>
              <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                🤔 Faltam algumas informações:
              </p>
              <ol style={{ margin: "0 0 12px", padding: "0 0 0 18px", fontSize: 13, color: "#78350f", lineHeight: 1.7 }}>
                {questions.map((q, i) => <li key={i}>{q}</li>)}
              </ol>
              <textarea
                value={clarAnswer}
                onChange={e => setClarAnswer(e.target.value)}
                autoFocus rows={3}
                placeholder="Sua resposta..."
                style={{ ...inp, resize: "vertical", background: "white", borderColor: "#fcd34d", lineHeight: 1.5 }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button disabled={!clarAnswer.trim() || busy} onClick={() => doValidate(clarAnswer)}
                  style={{ ...btnPrimary, width: "auto", padding: "9px 18px", background: "#d97706", opacity: !clarAnswer.trim() || busy ? .5 : 1 }}>
                  {busy ? "Verificando..." : "Confirmar e criar →"}
                </button>
                <button onClick={() => doCreate(clarAnswer)} disabled={busy}
                  style={{ ...btnGhost, width: "auto", padding: "9px 14px", fontSize: 12 }}>
                  Criar assim mesmo
                </button>
              </div>
            </div>
          )}

          {/* ─── Deadline Issue card ─── */}
          {pageState === "deadline_issue" && deadlineIssue && (
            <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: 16 }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "#9a3412" }}>
                ⚠️ O prazo solicitado não é viável
              </p>
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "#7c2d12", lineHeight: 1.6 }}>
                Com {form.estaticos} estático{form.estaticos !== 1 ? "s" : ""} + {form.videos} vídeo{form.videos !== 1 ? "s" : ""},
                precisamos de mínimo <strong>{deadlineIssue.min_days} dias úteis</strong>.<br />
                <strong>Prazo mínimo viável: {formatBR(deadlineIssue.min_date)}</strong>
              </p>
              <div>
                <label style={{ ...lbl, color: "#9a3412" }}>📅 Mudar prazo</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...inp, flex: 1 }} type="date" value={newPrazo}
                    min={deadlineIssue.min_date}
                    onChange={e => setNewPrazo(e.target.value)} />
                  <button disabled={!newPrazo || busy} onClick={async () => {
                    set("prazo", newPrazo);
                    await doCreate();
                  }}
                    style={{ ...btnPrimary, width: "auto", padding: "8px 16px", opacity: !newPrazo || busy ? .5 : 1 }}>
                    {busy ? "Criando..." : "Criar com novo prazo →"}
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 12, borderTop: "1px solid #fed7aa", paddingTop: 12 }}>
                <button disabled={busy} onClick={doCreateUnassigned}
                  style={{ ...btnGhost, width: "auto", padding: "8px 14px", fontSize: 12, color: "#9a3412", borderColor: "#fed7aa" }}>
                  🚫 Impossível mudar prazo — criar mesmo assim
                </button>
              </div>
            </div>
          )}

          {/* ─── Submit ─── */}
          {pageState !== "needs_clarification" && pageState !== "deadline_issue" && (
            <button
              disabled={!canSubmit || busy}
              onClick={() => doValidate()}
              style={{ ...btnPrimary, opacity: !canSubmit || busy ? .45 : 1, cursor: busy ? "wait" : "pointer" }}>
              {pageState === "validating" ? "Analisando briefing..." :
               pageState === "creating"   ? "Criando no Jira..." :
               "Criar demanda →"}
            </button>
          )}

        </div>
      </div>
    </div>
  );
}

/* ─── Tokens ─── */

const pg: React.CSSProperties = {
  minHeight: "100vh", background: "#f8f9fb",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  padding: "28px 16px 64px",
};
const wrap: React.CSSProperties = { width: "100%", maxWidth: 580, margin: "0 auto" };
const card: React.CSSProperties = {
  background: "white", borderRadius: 12, border: "1px solid #e5e7eb",
  padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,.06)",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 11px", borderRadius: 7,
  border: "1px solid #d1d5db", fontSize: 13, outline: "none",
  fontFamily: "inherit", boxSizing: "border-box", color: "#111", background: "white",
};
const btnPrimary: React.CSSProperties = {
  display: "block", width: "100%", padding: "11px 16px", borderRadius: 8,
  border: "none", background: "#7c3aed", color: "white",
  fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "center", textDecoration: "none",
};
const btnGhost: React.CSSProperties = {
  display: "block", width: "100%", padding: "10px 16px", borderRadius: 8,
  border: "1px solid #d1d5db", background: "white", color: "#374151",
  fontSize: 13, fontWeight: 500, cursor: "pointer", textAlign: "center", textDecoration: "none",
};
