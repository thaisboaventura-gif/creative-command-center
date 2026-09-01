import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Fixed creative team — accountIds from CONTEXT.md
const TEAM_ACCOUNT_IDS = new Set([
  "712020:4648823a-0cdc-4178-b186-597098121542", // Eduardo Oliveira
  "61aa13d5c75da800721a2623",                     // Eduardo Gasparetto
  "61b39fc4d2e64c0071f160d5",                     // Larissa Delarue
  "712020:e22b3767-90e9-47d2-92cd-ef84adafaac6", // Francisco Fernandes
  "712020:2ee0f456-77e7-4f2a-8502-ff712b3ba6da", // João Camargo
  "6425a53f67102fc717c2902d",                     // Beatriz Pusso
  "712020:e2200010-bf69-4f6e-87a4-a792c42d8837", // Rafaela Ceragioli (Monstra)
]);

// Members without a confirmed Jira accountId yet — matched by display name fragment
// Gabriel Cassino: sem Jira ainda (CONTEXT.md)
const TEAM_NAME_FRAGMENTS = ["gabriel", "cassino", "diego"];

function isTeamMember(u: { accountId: string; displayName: string }): boolean {
  if (TEAM_ACCOUNT_IDS.has(u.accountId)) return true;
  const lower = u.displayName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return TEAM_NAME_FRAGMENTS.some(f => lower.includes(f));
}

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
      .filter(u => u.active !== false && isTeamMember(u))
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
