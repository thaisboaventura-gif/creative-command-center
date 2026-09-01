import { NextRequest, NextResponse } from "next/server";
import { estimateHours } from "@/lib/estimate";

export const dynamic = "force-dynamic";

function getAuth() {
  const email = process.env.JIRA_EMAIL?.trim() || "";
  const token = process.env.JIRA_API_TOKEN?.trim() || "";
  const base  = (process.env.JIRA_BASE_URL?.trim() || "").replace(/\/$/, "");
  const auth  = Buffer.from(`${email}:${token}`).toString("base64");
  return { base, auth };
}

export async function GET(req: NextRequest) {
  const issueKey = req.nextUrl.searchParams.get("key")?.trim().toUpperCase();
  if (!issueKey) {
    return NextResponse.json({ error: "Parâmetro 'key' obrigatório (ex: ?key=BDSL-123)" }, { status: 400 });
  }

  const { base, auth } = getAuth();

  let res: Response;
  try {
    res = await fetch(
      `${base}/rest/api/3/issue/${issueKey}?fields=summary,status,assignee,duedate,timeoriginalestimate`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } }
    );
  } catch {
    return NextResponse.json({ error: "Não foi possível conectar ao Jira" }, { status: 502 });
  }

  if (res.status === 404) {
    return NextResponse.json({ error: `Task ${issueKey} não encontrada no Jira` }, { status: 404 });
  }
  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Jira ${res.status}: ${err.slice(0, 200)}` }, { status: res.status });
  }

  const issue = await res.json();
  const f = issue.fields;
  const est = estimateHours(f.summary ?? "", f.timeoriginalestimate ?? null);

  return NextResponse.json({
    id: issue.id,
    key: issue.key,
    title: f.summary ?? "",
    status: f.status?.name ?? "To Do",
    assignee: f.assignee?.displayName ?? "",
    dueDate: f.duedate ?? null,
    estimatedHours: est.hours,
    estimatedDetail: est.detail,
    estimatedFromJira: !!f.timeoriginalestimate,
  });
}
