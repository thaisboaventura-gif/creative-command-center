import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface SubtaskInput { key: string; assignee: string; }
interface JiraComment  { author: { displayName: string }; }

export async function POST(req: Request) {
  try {
    const subtasks: SubtaskInput[] = await req.json();
    if (!Array.isArray(subtasks) || subtasks.length === 0)
      return NextResponse.json({ keysWithComment: [] });

    const email = process.env.JIRA_EMAIL?.trim() || "";
    const token = process.env.JIRA_API_TOKEN?.trim() || "";
    const base  = (process.env.JIRA_BASE_URL?.trim() || "").replace(/\/$/, "");
    const auth  = Buffer.from(`${email}:${token}`).toString("base64");
    const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

    const results = await Promise.all(
      subtasks.map(async ({ key, assignee }) => {
        try {
          const res = await fetch(
            `${base}/rest/api/3/issue/${key}/comment?maxResults=50&orderBy=-created`,
            { headers }
          );
          if (!res.ok) return null;
          const data = await res.json();
          const hasComment = (data.comments as JiraComment[] ?? []).some(
            (c) => c.author?.displayName === assignee
          );
          return hasComment ? key : null;
        } catch { return null; }
      })
    );

    return NextResponse.json({ keysWithComment: results.filter(Boolean) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, keysWithComment: [] }, { status: 500 });
  }
}
