import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getAuth() {
  const email = process.env.JIRA_EMAIL?.trim() || "";
  const token = process.env.JIRA_API_TOKEN?.trim() || "";
  const base  = (process.env.JIRA_BASE_URL?.trim() || "").replace(/\/$/, "");
  const auth  = Buffer.from(`${email}:${token}`).toString("base64");
  return { base, auth };
}

export async function POST(req: Request) {
  try {
    const { issueKey, accountId } = await req.json() as { issueKey: string; accountId: string | null };
    if (!issueKey) return NextResponse.json({ error: "issueKey required" }, { status: 400 });

    const { base, auth } = getAuth();
    const url = `${base}/rest/api/3/issue/${issueKey}`;

    const body = {
      fields: {
        assignee: accountId ? { accountId } : null,
      },
    };

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[assignee] Jira error", res.status, err.slice(0, 300));
      return NextResponse.json({ error: `Jira ${res.status}: ${err.slice(0, 200)}` }, { status: res.status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[assignee]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
