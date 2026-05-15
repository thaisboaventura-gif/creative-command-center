import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GEMINI = "https://gemini.google.com/u/0/gem/db916d4624fc";

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

export async function POST(req: Request) {
  try {
    const { titulo, tipos, descricao, prazo } = await req.json();

    const system = `Você é um agente que valida briefings criativos do time de Brand Creative da Nuvemshop.

Analise o briefing e decida se está completo ou se precisa de mais informações.

REGRA 1 — VOLUME DE PEÇAS
Só questione se o número declarado claramente não bate com as specs.
Ex: diz "6 peças" mas descreve só 4 (2 formatos × 2 tipos) → pergunte.
Se diz "6 estáticos em 4:5 e 9:16" e descreve exatamente isso → não pergunte.

REGRA 2 — MENSAGEM PRINCIPAL
Se o briefing não tem direcionamento claro de mensagem/conceito do criativo:
→ Dê 3 sugestões baseadas no contexto + pergunta qual faz sentido.
Formato da pergunta:
"Qual a mensagem principal? Baseado no contexto, algumas sugestões:
- [sugestão 1]
- [sugestão 2]
- [sugestão 3]

Qual dessas faz mais sentido ou prefere outro caminho?
Ou crie com nosso agente: ${GEMINI}"

REGRA 3 — TEXTOS AUXILIARES
Textos Meta (títulos + textos principais + descrição), textos Google,
CTAs variados, legendas, copies de e-mail/in-app = NÃO bloquear.
Esses são autonomia da área.

REGRA 4 — D2C SUMMIT
"D2C Summit", "D2C", "Summit" = contexto conhecido. Não pedir explicação.

REGRA 5 — PÚBLICOS/PLATAFORMA
Segmentação Google, variações de plataforma, slots de texto = não questionar.

QUANDO ESTÁ OK (retorne ok: true):
- Tem título claro
- Tem tipo(s) definidos
- Tem specs técnicas OU são peças básicas (header email, in-app, banner) com dims padrão
- Tem mensagem/conceito principal OU job não precisa de copy criativo
- Tem prazo

Responda APENAS com JSON:
{ "ok": true }
ou
{ "ok": false, "question": "pergunta direta e específica aqui" }

Máximo 1 pergunta por vez. Seja direto.`;

    const user = `Título: ${titulo}
Tipos: ${(tipos as string[] || []).join(", ")}
Descrição: ${descricao}
Prazo: ${prazo}`;

    const raw = await callClaude(system, user);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ ok: true });
    return NextResponse.json(JSON.parse(match[0]));
  } catch (err) {
    console.error("[validate]", err);
    return NextResponse.json({ ok: true }); // fail-safe: don't block
  }
}
