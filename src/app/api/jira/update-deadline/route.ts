import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { issueKey, newDate } = await req.json();
    if (!issueKey || !newDate) {
      return NextResponse.json(
        { error: "issueKey e newDate são obrigatórios" },
        { status: 400 }
      );
    }

    const email = process.env.JIRA_EMAIL?.trim();
    const token = process.env.JIRA_API_TOKEN?.trim();
    const base  = process.env.JIRA_BASE_URL?.trim()?.replace(/\/$/, "");

    if (!email || !token || !base) {
      return NextResponse.json({ error: "Env vars ausentes" }, { status: 500 });
    }

    const auth = Buffer.from(`${email}:${token}`).toString("base64");

    const res = await fetch(`${base}/rest/api/3/issue/${issueKey}`, {
      method: "PUT",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fields: { duedate: newDate } }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[update-deadline]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
