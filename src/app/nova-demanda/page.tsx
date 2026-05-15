"use client";

import { useEffect, useRef, useState } from "react";

const TIPOS = [
  "Anúncio/Performance",
  "Sinalização/Evento",
  "Motion/Vídeo",
  "Copy",
  "Produto/Demo",
  "Desdobramento/Adaptação",
];

type Step =
  | "title"
  | "tipo"
  | "description"
  | "deadline"
  | "name"
  | "validating"
  | "followup"
  | "ready"
  | "creating"
  | "done";

interface Msg {
  role: "agent" | "user";
  text: string;
}

interface Brief {
  titulo: string;
  tipos: string[];
  descricao: string;
  prazo: string;
  solicitante: string;
}

const AGENT_INTRO =
  "Olá! 👋 Vou te ajudar a abrir uma demanda.\n\nQual é o título do job?";

export default function NovaDemanda() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "agent", text: AGENT_INTRO },
  ]);
  const [step, setStep] = useState<Step>("title");
  const [input, setInput] = useState("");
  const [tipos, setTipos] = useState<string[]>([]);
  const [brief, setBrief] = useState<Partial<Brief>>({});
  const [loading, setLoading] = useState(false);
  const [doneResult, setDoneResult] = useState<{ key: string; link: string | null } | null>(null);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, step]);

  // Auto-focus input when step changes
  useEffect(() => {
    if (step === "description") {
      setTimeout(() => textareaRef.current?.focus(), 150);
    } else if (["title", "name", "followup", "deadline"].includes(step)) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [step]);

  function push(role: Msg["role"], text: string) {
    setMsgs((prev) => [...prev, { role, text }]);
  }

  function agentSay(text: string, delay = 400) {
    setTimeout(() => push("agent", text), delay);
  }

  function removeThinking() {
    setMsgs((prev) => prev.filter((m) => !/Analisando|Verificando/.test(m.text)));
  }

  /* ── Advance the conversation ── */

  async function advance(value: string) {
    if (loading) return;

    if (step === "title") {
      const titulo = value.trim();
      if (!titulo) return;
      push("user", titulo);
      setInput("");
      setBrief((p) => ({ ...p, titulo }));
      agentSay("Que tipo de peça é? Pode selecionar mais de um 👇");
      setStep("tipo");

    } else if (step === "tipo") {
      if (tipos.length === 0) return;
      push("user", tipos.join(", "));
      setBrief((p) => ({ ...p, tipos }));
      agentSay(
        "Descreva o briefing — contexto, especificações técnicas (formatos, dimensões), " +
        "referências e público-alvo:"
      );
      setStep("description");

    } else if (step === "description") {
      const descricao = value.trim();
      if (!descricao) return;
      push("user", descricao);
      setInput("");
      setBrief((p) => ({ ...p, descricao }));
      agentSay("Qual é o prazo desejado?");
      setStep("deadline");

    } else if (step === "deadline") {
      const prazo = value.trim();
      if (!prazo) return;
      push("user", prazo);
      setInput("");
      setBrief((p) => ({ ...p, prazo }));
      agentSay("E seu nome?");
      setStep("name");

    } else if (step === "name") {
      const solicitante = value.trim();
      if (!solicitante) return;
      push("user", solicitante);
      setInput("");
      const full = { ...brief, solicitante } as Brief;
      setBrief(full);
      setLoading(true);
      setStep("validating");
      agentSay("Analisando o briefing... ⏳");
      await runValidate(full);

    } else if (step === "followup") {
      const answer = value.trim();
      if (!answer) return;
      push("user", answer);
      setInput("");
      const updated: Brief = {
        ...(brief as Brief),
        descricao: `${brief.descricao}\n\n${answer}`,
      };
      setBrief(updated);
      setLoading(true);
      setStep("validating");
      agentSay("Verificando... ⏳");
      await runValidate(updated);
    }
  }

  async function runValidate(data: Brief) {
    try {
      const res = await fetch("/api/nova-demanda/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      setLoading(false);
      removeThinking();

      if (json.ok) {
        agentSay("Tudo certo! 🎉 Posso criar a demanda agora?", 0);
        setStep("ready");
      } else {
        agentSay(json.question, 0);
        setStep("followup");
      }
    } catch {
      setLoading(false);
      removeThinking();
      agentSay("Não consegui validar. Pode criar mesmo assim ou ajustar algo.", 0);
      setStep("ready");
    }
  }

  async function createTask() {
    if (loading) return;
    setLoading(true);
    setStep("creating");
    push("agent", "Criando a demanda no Jira... ⚙️");
    try {
      const res = await fetch("/api/nova-demanda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      });
      const data = await res.json();
      setLoading(false);
      setMsgs((prev) => prev.filter((m) => !m.text.includes("Criando")));

      if (data.error) {
        push("agent", `Erro ao criar: ${data.error}`);
        setStep("ready");
      } else {
        push("agent", `✅ Demanda criada! ${data.issueKey}`);
        setDoneResult({ key: data.issueKey, link: data.jiraLink });
        setStep("done");
      }
    } catch {
      setLoading(false);
      setMsgs((prev) => prev.filter((m) => !m.text.includes("Criando")));
      push("agent", "Erro de conexão. Tente de novo.");
      setStep("ready");
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && step !== "description") {
      e.preventDefault();
      advance(input);
    }
  }

  /* ── Input area by step ── */

  function renderInput() {
    // Tipo selection
    if (step === "tipo") {
      return (
        <div style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {TIPOS.map((t) => {
              const sel = tipos.includes(t);
              return (
                <button key={t} type="button"
                  onClick={() => setTipos((p) => sel ? p.filter((x) => x !== t) : [...p, t])}
                  style={{
                    padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: "pointer",
                    border: sel ? "2px solid #7c3aed" : "1px solid #e5e7eb",
                    background: sel ? "#ede9fe" : "white", color: sel ? "#7c3aed" : "#374151",
                    transition: "all 0.1s",
                  }}>
                  {sel && "✓ "}{t}
                </button>
              );
            })}
          </div>
          <button onClick={() => advance("")} disabled={tipos.length === 0}
            style={{
              width: "100%", padding: "10px", borderRadius: 8, border: "none",
              background: tipos.length > 0 ? "#7c3aed" : "#e5e7eb",
              color: tipos.length > 0 ? "white" : "#9ca3af",
              fontSize: 13, fontWeight: 600,
              cursor: tipos.length > 0 ? "pointer" : "not-allowed",
            }}>
            Confirmar{tipos.length > 0 ? ` (${tipos.length} selecionado${tipos.length > 1 ? "s" : ""})` : ""}
          </button>
        </div>
      );
    }

    // Ready to create
    if (step === "ready") {
      return (
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          <button onClick={createTask}
            style={{
              width: "100%", padding: "11px", borderRadius: 8, border: "none",
              background: "#7c3aed", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
            Criar demanda ✓
          </button>
          <button onClick={() => {
            agentSay("O que gostaria de ajustar?", 0);
            setStep("followup");
          }}
            style={{
              width: "100%", padding: "8px", borderRadius: 8,
              border: "1px solid #e5e7eb", background: "white",
              color: "#6b7280", fontSize: 12, cursor: "pointer",
            }}>
            Quero ajustar algo
          </button>
        </div>
      );
    }

    // Done
    if (step === "done") {
      return (
        <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
          {doneResult?.link && (
            <a href={doneResult.link} target="_blank" rel="noopener noreferrer"
              style={{
                flex: 1, textAlign: "center", padding: "10px", borderRadius: 8,
                background: "#7c3aed", color: "white", textDecoration: "none", fontSize: 13, fontWeight: 600,
              }}>
              Ver no Jira
            </a>
          )}
          <a href="/"
            style={{
              flex: 1, textAlign: "center", padding: "10px", borderRadius: 8,
              border: "1px solid #e5e7eb", background: "white",
              color: "#374151", textDecoration: "none", fontSize: 13, fontWeight: 600,
            }}>
            Voltar ao painel
          </a>
        </div>
      );
    }

    // Thinking / creating
    if (step === "validating" || step === "creating") {
      return (
        <div style={{ padding: "14px 16px", color: "#9ca3af", fontSize: 12, textAlign: "center" }}>
          ●●●
        </div>
      );
    }

    // Description (textarea)
    if (step === "description") {
      return (
        <div style={{ padding: "12px 16px", display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); advance(input); }
            }}
            placeholder="Descreva o briefing..."
            rows={3}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb",
              fontSize: 13, resize: "none", outline: "none", fontFamily: "inherit", lineHeight: 1.5,
            }}
          />
          <button onClick={() => advance(input)} disabled={!input.trim() || loading}
            style={{
              padding: "8px 14px", borderRadius: 8, border: "none",
              background: input.trim() ? "#7c3aed" : "#e5e7eb",
              color: input.trim() ? "white" : "#9ca3af",
              fontSize: 15, cursor: input.trim() ? "pointer" : "not-allowed",
              height: 38, flexShrink: 0,
            }}>
            →
          </button>
        </div>
      );
    }

    // Deadline (date input)
    if (step === "deadline") {
      return (
        <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
          <input ref={inputRef} type="date" value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 8,
              border: "1px solid #e5e7eb", fontSize: 13, outline: "none",
            }}
          />
          <button onClick={() => advance(input)} disabled={!input.trim()}
            style={{
              padding: "8px 14px", borderRadius: 8, border: "none",
              background: input.trim() ? "#7c3aed" : "#e5e7eb",
              color: input.trim() ? "white" : "#9ca3af",
              fontSize: 15, cursor: input.trim() ? "pointer" : "not-allowed",
            }}>
            →
          </button>
        </div>
      );
    }

    // Default text input (title, name, followup)
    return (
      <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={loading}
          placeholder={
            step === "title" ? "Ex: 6 posts estáticos para campanha Dia das Mães" :
            step === "name"  ? "Seu nome" : ""
          }
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 8,
            border: "1px solid #e5e7eb", fontSize: 13, outline: "none",
          }}
        />
        <button onClick={() => advance(input)} disabled={!input.trim() || loading}
          style={{
            padding: "8px 14px", borderRadius: 8, border: "none",
            background: input.trim() && !loading ? "#7c3aed" : "#e5e7eb",
            color: input.trim() && !loading ? "white" : "#9ca3af",
            fontSize: 15, cursor: input.trim() && !loading ? "pointer" : "not-allowed",
          }}>
          →
        </button>
      </div>
    );
  }

  /* ── Main render ── */

  return (
    <div style={{
      minHeight: "100vh", background: "#f8f9fb",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "24px 16px 0",
    }}>
      <div style={{ width: "100%", maxWidth: 600, display: "flex", flexDirection: "column", height: "calc(100vh - 24px)" }}>

        {/* Header */}
        <div style={{ marginBottom: 12, flexShrink: 0 }}>
          <a href="/" style={{ fontSize: 12, color: "#7c3aed", textDecoration: "none" }}>← Voltar ao painel</a>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: "#111", margin: "6px 0 0" }}>💬 Nova demanda</h1>
        </div>

        {/* Chat messages */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingBottom: 12 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "agent" ? "flex-start" : "flex-end" }}>
              <div style={{
                maxWidth: "82%",
                padding: "10px 14px",
                borderRadius: m.role === "agent" ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                background: m.role === "agent" ? "white" : "#7c3aed",
                color: m.role === "agent" ? "#111" : "white",
                fontSize: 13, lineHeight: 1.55,
                boxShadow: "0 1px 3px rgba(0,0,0,.06)",
                border: m.role === "agent" ? "1px solid #e5e7eb" : "none",
                whiteSpace: "pre-wrap",
              }}>
                {m.text}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: "flex" }}>
              <div style={{
                padding: "10px 16px", borderRadius: "4px 14px 14px 14px",
                background: "white", border: "1px solid #e5e7eb",
                fontSize: 16, color: "#9ca3af", letterSpacing: 2,
              }}>
                ●●●
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input panel */}
        <div style={{ background: "white", borderRadius: "12px 12px 0 0", border: "1px solid #e5e7eb", borderBottom: "none", flexShrink: 0 }}>
          {renderInput()}
        </div>
      </div>
    </div>
  );
}
