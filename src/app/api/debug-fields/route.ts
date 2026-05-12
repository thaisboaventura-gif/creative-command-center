import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const email = process.env.JIRA_EMAIL?.trim();
  const token = process.env.JIRA_API_TOKEN?.trim();
  const base = process.env.JIRA_BASE_URL?.trim();

  if (!email || !token || !base) {
    return NextResponse.json({ error: "Env vars ausentes" }, { status: 500 });
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  // Fetch BDSL-31660 with all fields
  const res = await fetch(`${base}/rest/api/3/issue/BDSL-31660`, { headers });
  const issue = await res.json();

  // Filter only fields that contain "rafaela" somewhere in their value
  const fields = issue.fields || {};
  const relevant: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const str = JSON.stringify(value).toLowerCase();
    if (str.includes("rafaela") || str.includes("ceragioli")) {
      relevant[key] = value;
    }
  }

  return NextResponse.json({ issueKey: issue.key, relevantFields: relevant });
}
