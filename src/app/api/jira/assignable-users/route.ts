import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getAuth() {
  const email = process.env.JIRA_EMAIL?.trim() || "";
  const token = process.env.JIRA_API_TOKEN?.trim() || "";
  const base  = (process.env.JIRA_BASE_URL?.trim() || "").replace(/\/$/, "");
  const auth  = Buffer.from(`${email}:${token}`).toString("base64");
  return { base, auth };
}

export async function GET() {
  try {
    const { base, auth } = getAuth();
    const project = process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";

    const res = await fetch(
      `${base}/rest/api/3/user/assignable/search?project=${project}&maxResults=100`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
    );

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Jira ${res.status}: ${err.slice(0, 200)}` }, { status: res.status });
    }

    const data = await res.json() as Array<{ accountId: string; displayName: string; active?: boolean }>;

    const users = data
      .filter(u => u.active !== false)
      .map(u => ({
        accountId: u.accountId,
        displayName: u.displayName,
        firstName: u.displayName.split(/[\s.]/)[0],
      }));

    return NextResponse.json({ users });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
