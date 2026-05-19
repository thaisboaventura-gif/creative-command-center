"use client";

import { useState } from "react";

/* ─── Config ─── */

const AREAS = ["Growth", "Performance", "D2C", "Next", "PMM", "RH", "Eventos", "Social", "CTAs", "Outros"];

const TIPOS_CRIATIVO = [
  "Estático META",
  "Estático WhatsApp",
  "Header e-mail",
  "Banner físico",
  "Banner site/LP",
  "Vídeo",
  "Motion",
  "Carrossel",
  "Banner web",
  "PPT/Apresentação",
  "Outros",
];

const FORMATOS = ["4:5", "9:16", "1:1", "16:9", "1.91:1", "4:3", "2:3", "Outros"];

const isVideoTipo = (t: string) => t === "Vídeo" || t === "Motion";
const isPPTTipo   = (t: string) => t === "PPT/Apresentação";

/* ─── Types ─── */

type PageState =
  | "idle"
  | "validating"
  | "needs_clarification"
  | "deadline_issue"
  | "creating"
  | "done"
  | "done_unassigned";

interface CriativoCard {
  tipo: string;
  formatos: string[];
  formatoOutros: string;
  dimensoes: string;
  tipoOutrosDesc: string;
  duracao: string;
  direcao: string;
  docLink: string;
}

interface DemandaForm {
  nomeTask: string;
  area: string;
  areaOutros: string;
  contexto: string;
  objetivo: string;
  criativos: CriativoCard[];
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

function emptyCriativo(): CriativoCard {
  return {
    tipo: "", formatos: [], formatoOutros: "", dimensoes: "",
    tipoOutrosDesc: "", duracao: "", direcao: "", docLink: "",
  };
}

function emptyForm(): DemandaForm {
  return {
    nomeTask: "", area: "", areaOutros: "",
    contexto: "", objetivo: "",
    criativos: [emptyCriativo()],
    prazo: "", solicitanteNome: "", solicitanteEmail: "",
  };
}

function autoResize(el: HTMLTextAreaElement, maxH = 260) {
  el.style.height = "auto";
  const sh = el.scrollHeight;
  el.style.height = Math.min(sh, maxH) + "px";
  el.style.overflowY = sh > maxH ? "auto" : "hidden";
}

/* ─── UI Atoms ─── */

function FieldCounter({ n, max }: { n: number; max: number }) {
  const over = n >= max;
  const warn = n / max >= 0.8 && !over;
  return (
    <span style={{ fontSize: 10, marginLeft: 4, color: over ? "#dc2626" : warn ? "#d97706" : "#9ca3af" }}>
      {n}/{max}
    </span>
  );
}

function OverflowBanner() {
  return (
    <div style={{
      fontSize: 11, color: "#dc2626", background: "#fef2f2",
      border: "1px solid #fecaca", borderRadius: 5, padding: "3px 8px", marginTop: 4,
    }}>
      ⚠️ Você atingiu o limite de caracteres
    </div>
  );
}

function FieldError({ msg }: { msg: string }) {
  return (
    <p style={{ margin: "4px 0 0", fontSize: 11, color: "#dc2626", fontWeight: 500 }}>
      {msg}
    </p>
  );
}

/* ─── Main ─── */

export default function NovaDemanda() {
  const [form, setForm]           = useState<DemandaForm>(emptyForm());
  const [pageState, setPageState] = useState<PageState>("idle");

  // Clarification
  const [questions, setQuestions]     = useState<string[]>([]);
  const [clarAnswer, setClarAnswer]   = useState("");

  // Deadline issue
  const [deadlineIssue, setDeadlineIssue] = useState<DeadlineIssue | null>(null);
  const [newPrazo, setNewPrazo]           = useState("");

  // Results
  const [doneResult, setDoneResult]             = useState<DoneResult | null>(null);
  const [doneUnassignedKey, setDoneUnassignedKey] = useState<{ key: string; link: string | null } | null>(null);

  // Attachments
  const [anexos, setAnexos] = useState<File[]>([]);

  // Paste warning
  const [pasteBanner, setPasteBanner] = useState(false);

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  const busy = pageState === "validating" || pageState === "creating";

  /* ─── Form updaters ─── */

  function clearError(key: string) {
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  }

  function setField<K extends keyof DemandaForm>(k: K, v: DemandaForm[K]) {
    setForm(p => ({ ...p, [k]: v }));
    clearError(k as string);
  }

  function setCriativo<K extends keyof CriativoCard>(i: number, k: K, v: CriativoCard[K]) {
    setForm(p => {
      const criativos = [...p.criativos];
      criativos[i] = { ...criativos[i], [k]: v };
      return { ...p, criativos };
    });
    if (k === "tipo") clearError(`criativo_${i}_tipo`);
  }

  function toggleFormato(i: number, fmt: string) {
    setForm(p => {
      const criativos = [...p.criativos];
      const c = criativos[i];
      const formatos = c.formatos.includes(fmt)
        ? c.formatos.filter(f => f !== fmt)
        : [...c.formatos, fmt];
      criativos[i] = { ...c, formatos };
      return { ...p, criativos };
    });
  }

  function setNCriativos(n: number) {
    const clamped = Math.max(1, Math.min(15, n));
    setForm(p => {
      const cur = p.criativos;
      if (clamped > cur.length) {
        return { ...p, criativos: [...cur, ...Array(clamped - cur.length).fill(null).map(() => emptyCriativo())] };
      } else {
        return { ...p, criativos: cur.slice(0, clamped) };
      }
    });
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>, maxLen: number, currentLen: number) {
    const text = e.clipboardData.getData("text");
    if (currentLen + text.length > maxLen) setPasteBanner(true);
  }

  /* ─── Client-side validation ─── */
  function validateForm(): boolean {
    const errs: Record<string, string> = {};

    if (!form.nomeTask.trim())        errs["nomeTask"]        = "Campo obrigatório";
    if (!form.area)                   errs["area"]            = "Selecione uma área";
    if (form.area === "Outros" && !form.areaOutros.trim()) errs["areaOutros"] = "Campo obrigatório";
    if (!form.contexto.trim())        errs["contexto"]        = "Campo obrigatório";
    if (!form.objetivo.trim())        errs["objetivo"]        = "Campo obrigatório";
    if (!form.prazo)                  errs["prazo"]           = "Campo obrigatório";
    if (!form.solicitanteNome.trim()) errs["solicitanteNome"] = "Campo obrigatório";
    if (!form.solicitanteEmail.trim()) {
      errs["solicitanteEmail"] = "Campo obrigatório";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.solicitanteEmail)) {
      errs["solicitanteEmail"] = "Email inválido";
    }
    form.criativos.forEach((c, i) => {
      if (!c.tipo) errs[`criativo_${i}_tipo`] = "Selecione um tipo";
    });

    setErrors(errs);

    if (Object.keys(errs).length > 0) {
      // Scroll to first error
      const firstKey = Object.keys(errs)[0];
      const el = document.getElementById(`field-${firstKey}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  /* ─── Validate ─── */
  async function doValidate(extraNote?: string): Promise<void> {
    if (!extraNote && !validateForm()) return;   // block if client-side errors
    setPageState("validating");
    try {
      const body = buildPayload("validate", extraNote);
      const res  = await fetch("/api/nova-demanda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
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
        await doCreate();
      }
    } catch {
      await doCreate();
    }
  }

  /* ─── Create (normal) ─── */
  async function doCreate(extraNote?: string): Promise<void> {
    setPageState("creating");
    try {
      const payload = buildPayload("create", extraNote);
      const fd = new FormData();
      for (const [k, v] of Object.entries(payload)) {
        if (typeof v === "object") {
          fd.append(k, JSON.stringify(v));
        } else {
          fd.append(k, String(v ?? ""));
        }
      }
      anexos.forEach(f => fd.append("files", f));
      const res  = await fetch("/api/nova-demanda", { method: "POST", body: fd });
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
        if (typeof v === "object") {
          fd.append(k, JSON.stringify(v));
        } else {
          fd.append(k, String(v ?? ""));
        }
      }
      anexos.forEach(f => fd.append("files", f));
      const res  = await fetch("/api/nova-demanda", { method: "POST", body: fd });
      const data = await res.json();
      setDoneUnassignedKey({ key: data.issueKey, link: data.jiraLink });
      setPageState("done_unassigned");
    } catch { setPageState("idle"); }
  }

  function buildPayload(mode: string, extraNote?: string) {
    const prazoToUse = mode === "create" && newPrazo ? newPrazo : form.prazo;
    const enrichedObjetivo = extraNote
      ? `${form.objetivo}\n\n[Complemento]: ${extraNote}`
      : form.objetivo;
    return { ...form, prazo: prazoToUse, objetivo: enrichedObjetivo, mode };
  }

  /* ─── canSubmit ─── */
  const areaFilled      = form.area && (form.area !== "Outros" || form.areaOutros.trim());
  const criativosFilled = form.criativos.length > 0 && form.criativos.every(c => c.tipo !== "");
  const canSubmit = !!(
    form.nomeTask.trim() && areaFilled &&
    form.contexto.trim() && form.objetivo.trim() && criativosFilled &&
    form.prazo && form.solicitanteNome.trim() && form.solicitanteEmail.trim()
  );

  const staticCount = form.criativos.filter(c => c.tipo && !isVideoTipo(c.tipo) && !isPPTTipo(c.tipo)).length;
  const videoCount  = form.criativos.filter(c => isVideoTipo(c.tipo)).length;

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
              <button
                onClick={() => { setForm(emptyForm()); setPageState("idle"); setDoneResult(null); setAnexos([]); }}
                style={btnGhost}
              >
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

        {/* Paste banner */}
        {pasteBanner && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8,
            padding: "10px 14px", marginBottom: 16,
            display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          }}>
            <p style={{ margin: 0, fontSize: 13, color: "#dc2626", lineHeight: 1.5 }}>
              ⚠️ O texto colado excede o limite do campo. Por favor, resuma ou distribua o conteúdo nos campos específicos.
            </p>
            <button
              onClick={() => setPasteBanner(false)}
              style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 20, padding: 0, marginLeft: 12, lineHeight: 1 }}
            >×</button>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* 1 — Nome da task */}
          <div id="field-nomeTask">
            <label style={lbl}>
              Nome da task *
              <FieldCounter n={form.nomeTask.length} max={40} />
            </label>
            <input
              style={{ ...inp, ...(errors["nomeTask"] ? errBorder : {}) }}
              type="text" maxLength={40} disabled={busy}
              value={form.nomeTask} onChange={e => setField("nomeTask", e.target.value)}
              placeholder="Ex: SMB ADS — Campanha Maio"
            />
            {errors["nomeTask"] && <FieldError msg={errors["nomeTask"]} />}
            {form.nomeTask.length >= 40 && <OverflowBanner />}
          </div>

          {/* 2 — Área */}
          <div id="field-area">
            <label style={lbl}>Área relacionada *</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {AREAS.map(a => {
                const sel = form.area === a;
                return (
                  <button key={a} type="button" disabled={busy}
                    onClick={() => setField("area", a)}
                    style={{
                      padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: sel ? 700 : 400,
                      border: sel ? "2px solid #7c3aed" : errors["area"] ? "1px solid #dc2626" : "1px solid #d1d5db",
                      background: sel ? "#ede9fe" : "white",
                      color: sel ? "#7c3aed" : "#6b7280",
                      cursor: busy ? "default" : "pointer", transition: "all .1s",
                    }}>
                    {a}
                  </button>
                );
              })}
            </div>
            {errors["area"] && <FieldError msg={errors["area"]} />}
            {form.area === "Outros" && (
              <input
                id="field-areaOutros"
                style={{ ...inp, marginTop: 8, ...(errors["areaOutros"] ? errBorder : {}) }}
                type="text" disabled={busy}
                value={form.areaOutros} onChange={e => setField("areaOutros", e.target.value)}
                placeholder="Qual área?"
              />
            )}
            {errors["areaOutros"] && <FieldError msg={errors["areaOutros"]} />}
          </div>

          {/* 3 — Contexto */}
          <div id="field-contexto">
            <label style={lbl}>
              Contexto *
              <FieldCounter n={form.contexto.length} max={500} />
              <span style={{ fontWeight: 400, color: "#9ca3af", fontSize: 11, marginLeft: 6 }}>O que motivou esse pedido?</span>
            </label>
            <textarea
              style={{ ...inp, resize: "none", overflowY: "hidden", lineHeight: 1.5, minHeight: 40, ...(errors["contexto"] ? errBorder : {}) }}
              maxLength={500} disabled={busy}
              value={form.contexto}
              onChange={e => { setField("contexto", e.target.value); autoResize(e.target); }}
              onPaste={e => handlePaste(e, 500, form.contexto.length)}
              placeholder="Ex: Lançamento de nova funcionalidade de pagamentos para lojistas SMB"
            />
            {errors["contexto"] && <FieldError msg={errors["contexto"]} />}
            {form.contexto.length >= 500 && <OverflowBanner />}
          </div>

          {/* 4 — Objetivo */}
          <div id="field-objetivo">
            <label style={lbl}>
              Objetivo *
              <FieldCounter n={form.objetivo.length} max={700} />
              <span style={{ fontWeight: 400, color: "#9ca3af", fontSize: 11, marginLeft: 6 }}>O que essa campanha precisa gerar?</span>
            </label>
            <textarea
              style={{ ...inp, resize: "none", overflowY: "hidden", lineHeight: 1.5, minHeight: 80, ...(errors["objetivo"] ? errBorder : {}) }}
              maxLength={700} disabled={busy}
              value={form.objetivo}
              onChange={e => { setField("objetivo", e.target.value); autoResize(e.target); }}
              onPaste={e => handlePaste(e, 700, form.objetivo.length)}
              placeholder="Ex: Gerar conversões de trial para plano pago entre lojistas que visitaram a LP de planos nos últimos 30 dias. Público-alvo: lojistas SMB Brasil, segmento moda."
            />
            {errors["objetivo"] && <FieldError msg={errors["objetivo"]} />}
            {form.objetivo.length >= 700 && <OverflowBanner />}
          </div>

          {/* 5 — Criativos */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <label style={{ ...lbl, marginBottom: 0 }}>Criativos *</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>Quantidade:</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    type="button" disabled={busy || form.criativos.length <= 1}
                    onClick={() => setNCriativos(form.criativos.length - 1)}
                    style={{
                      width: 28, height: 28, borderRadius: 6, border: "1px solid #d1d5db",
                      background: "white", cursor: form.criativos.length <= 1 || busy ? "default" : "pointer",
                      fontSize: 16, fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: form.criativos.length <= 1 ? 0.3 : 1,
                    }}
                  >−</button>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111", minWidth: 24, textAlign: "center" }}>
                    {form.criativos.length}
                  </span>
                  <button
                    type="button" disabled={busy || form.criativos.length >= 15}
                    onClick={() => setNCriativos(form.criativos.length + 1)}
                    style={{
                      width: 28, height: 28, borderRadius: 6, border: "1px solid #d1d5db",
                      background: "white", cursor: form.criativos.length >= 15 || busy ? "default" : "pointer",
                      fontSize: 16, fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: form.criativos.length >= 15 ? 0.3 : 1,
                    }}
                  >+</button>
                </div>
              </div>
            </div>

            {form.criativos.map((c, i) => (
              <div key={i} style={{
                border: "1px solid #e5e7eb", borderRadius: 10,
                padding: 16, marginBottom: 12, background: "white",
              }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Criativo {i + 1}
                </p>

                {/* Tipo */}
                <div id={`field-criativo_${i}_tipo`} style={{ marginBottom: 12 }}>
                  <label style={{ ...lbl, fontSize: 11 }}>Tipo *</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                    {TIPOS_CRIATIVO.map(t => {
                      const sel = c.tipo === t;
                      const hasErr = !!errors[`criativo_${i}_tipo`];
                      return (
                        <button key={t} type="button" disabled={busy}
                          onClick={() => setCriativo(i, "tipo", sel ? "" : t)}
                          style={{
                            padding: "4px 11px", borderRadius: 20, fontSize: 11, fontWeight: sel ? 700 : 400,
                            border: sel ? "2px solid #7c3aed" : hasErr ? "1px solid #dc2626" : "1px solid #d1d5db",
                            background: sel ? "#ede9fe" : "#fafafa",
                            color: sel ? "#7c3aed" : "#6b7280",
                            cursor: busy ? "default" : "pointer", transition: "all .1s",
                          }}>
                          {t}
                        </button>
                      );
                    })}
                  </div>
                  {errors[`criativo_${i}_tipo`] && <FieldError msg={errors[`criativo_${i}_tipo`]} />}
                </div>

                {/* PPT special handling */}
                {isPPTTipo(c.tipo) && (
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 7, padding: "10px 12px", marginBottom: 12 }}>
                    <p style={{ margin: 0, fontSize: 12, color: "#166534", lineHeight: 1.5 }}>
                      <strong>OBS:</strong> Nós revisamos o visual das apresentações já com conteúdo fechado. Certifique-se de que o documento está completo antes de enviar.
                    </p>
                  </div>
                )}

                {/* Link para documento (PPT only) */}
                {isPPTTipo(c.tipo) && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ ...lbl, fontSize: 11 }}>Link para documento</label>
                    <input
                      style={{ ...inp, fontSize: 12 }} type="url" disabled={busy}
                      value={c.docLink} onChange={e => setCriativo(i, "docLink", e.target.value)}
                      placeholder="https://docs.google.com/presentation/..."
                    />
                  </div>
                )}

                {/* Banner físico — dimensões */}
                {c.tipo === "Banner físico" && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ ...lbl, fontSize: 11 }}>Dimensões (cm ou px)</label>
                    <input
                      style={{ ...inp, fontSize: 12 }} type="text" disabled={busy}
                      value={c.dimensoes} onChange={e => setCriativo(i, "dimensoes", e.target.value)}
                      placeholder="Ex: 90×120cm, 297×420mm"
                    />
                  </div>
                )}

                {/* Outros tipo — descrição */}
                {c.tipo === "Outros" && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ ...lbl, fontSize: 11 }}>Descrição do formato</label>
                    <input
                      style={{ ...inp, fontSize: 12 }} type="text" disabled={busy}
                      value={c.tipoOutrosDesc} onChange={e => setCriativo(i, "tipoOutrosDesc", e.target.value)}
                      placeholder="Ex: Assinatura de e-mail, mockup 3D..."
                    />
                  </div>
                )}

                {/* Formatos (not for PPT) */}
                {!isPPTTipo(c.tipo) && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ ...lbl, fontSize: 11 }}>Em quais formatos este criativo deve ser desdobrado?</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                      {FORMATOS.map(fmt => {
                        const sel = c.formatos.includes(fmt);
                        return (
                          <button key={fmt} type="button" disabled={busy}
                            onClick={() => toggleFormato(i, fmt)}
                            style={{
                              padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: sel ? 700 : 400,
                              border: sel ? "2px solid #7c3aed" : "1px solid #d1d5db",
                              background: sel ? "#ede9fe" : "#fafafa",
                              color: sel ? "#7c3aed" : "#6b7280",
                              cursor: busy ? "default" : "pointer", transition: "all .1s",
                              fontFamily: "monospace",
                            }}>
                            {fmt}
                          </button>
                        );
                      })}
                    </div>
                    {/* Outros formato */}
                    {c.formatos.includes("Outros") && (
                      <input
                        style={{ ...inp, marginTop: 8, fontSize: 12 }} type="text" disabled={busy}
                        value={c.formatoOutros} onChange={e => setCriativo(i, "formatoOutros", e.target.value)}
                        placeholder="Descreva o formato (ex: 600×200px)"
                      />
                    )}
                  </div>
                )}

                {/* Duração (vídeo/motion) */}
                {isVideoTipo(c.tipo) && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ ...lbl, fontSize: 11 }}>Duração</label>
                    <input
                      style={{ ...inp, fontSize: 12 }} type="text" disabled={busy}
                      value={c.duracao} onChange={e => setCriativo(i, "duracao", e.target.value)}
                      placeholder="Ex: 15s, 30s"
                    />
                  </div>
                )}

                {/* Direcionamento (not for PPT) */}
                {!isPPTTipo(c.tipo) && (
                  <div>
                    <label style={{ ...lbl, fontSize: 11 }}>
                      Direcionamento de mensagem / o que a peça precisa comunicar:
                      <FieldCounter n={c.direcao.length} max={500} />
                    </label>
                    <textarea
                      style={{ ...inp, resize: "none", overflowY: "hidden", lineHeight: 1.5, minHeight: 60, fontSize: 12 }}
                      maxLength={500} disabled={busy}
                      value={c.direcao}
                      onChange={e => { setCriativo(i, "direcao", e.target.value); autoResize(e.target); }}
                      onPaste={e => handlePaste(e, 500, c.direcao.length)}
                      placeholder="Ex: Destaque o benefício principal com linguagem direta. Tom descontraído mas profissional. Referência visual: campanha X."
                    />
                    {c.direcao.length >= 500 && <OverflowBanner />}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 6 — Anexos */}
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
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "#f3f4f6", borderRadius: 6 }}>
                    <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>
                      {f.name}
                    </span>
                    <span style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap" }}>
                      {f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(0)} KB` : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                    <button
                      type="button" disabled={busy}
                      onClick={() => setAnexos(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}
                      title="Remover"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 7 — Prazo */}
          <div id="field-prazo">
            <label style={lbl}>Prazo desejado *</label>
            <input
              style={{ ...inp, cursor: "pointer", ...(errors["prazo"] ? errBorder : {}) }}
              type="date" disabled={busy}
              value={form.prazo}
              onChange={e => setField("prazo", e.target.value)}
              onClick={e => {
                try { (e.target as HTMLInputElement).showPicker(); } catch { /* sem suporte */ }
              }}
            />
            {errors["prazo"] && <FieldError msg={errors["prazo"]} />}
          </div>

          {/* 8 — Solicitante */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div id="field-solicitanteNome">
              <label style={lbl}>Nome completo *</label>
              <input
                style={{ ...inp, ...(errors["solicitanteNome"] ? errBorder : {}) }}
                type="text" disabled={busy}
                value={form.solicitanteNome} onChange={e => setField("solicitanteNome", e.target.value)}
                placeholder="Seu nome" />
              {errors["solicitanteNome"] && <FieldError msg={errors["solicitanteNome"]} />}
            </div>
            <div id="field-solicitanteEmail">
              <label style={lbl}>Email *</label>
              <input
                style={{ ...inp, ...(errors["solicitanteEmail"] ? errBorder : {}) }}
                type="email" disabled={busy}
                value={form.solicitanteEmail} onChange={e => setField("solicitanteEmail", e.target.value)}
                placeholder="seu@email.com" />
              {errors["solicitanteEmail"] && <FieldError msg={errors["solicitanteEmail"]} />}
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
                Com {staticCount} peça{staticCount !== 1 ? "s" : ""} estática{staticCount !== 1 ? "s" : ""}
                {videoCount > 0 ? ` + ${videoCount} vídeo${videoCount !== 1 ? "s" : ""}` : ""},
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
                    setField("prazo", newPrazo);
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
              disabled={busy}
              onClick={() => doValidate()}
              style={{ ...btnPrimary, opacity: busy ? .45 : 1, cursor: busy ? "wait" : "pointer" }}>
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
const wrap: React.CSSProperties  = { width: "100%", maxWidth: 600, margin: "0 auto" };
const card: React.CSSProperties  = {
  background: "white", borderRadius: 12, border: "1px solid #e5e7eb",
  padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,.06)",
};
const lbl: React.CSSProperties   = {
  display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5,
};
const inp: React.CSSProperties   = {
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

const errBorder: React.CSSProperties = { border: "1.5px solid #dc2626" };
