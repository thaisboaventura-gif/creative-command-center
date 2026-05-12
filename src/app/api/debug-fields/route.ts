import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const email = process.env.JIRA_EMAIL?.trim();
  const token = process.env.JIRA_API_TOKEN?.trim();
  const base = process.env.JIRA_BASE_URL?.trim();
  const project = process.env.JIRA_PROJECT_KEY?.trim() || "BDSL";

  if (!email || !token || !base) {
    return NextResponse.json({ error: "Env vars ausentes" }, { status: 500 });
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  // Fetch one task that might belong to Rafaela — search broadly
  const jql = `project = ${project} AND text ~ "rafaela" ORDER BY created DESC`;
  const url = `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=1&expand=names`;

  const res = await fetch(url, { headers });
  const data = await res.json();

  // Also return field names map
  const fieldsRes = await fetch(`${base}/rest/api/3/field`, { headers });
  const fields = await fieldsRes.json();
  const customFields = Array.isArray(fields)
    ? fields.filter((f: { id: string; name: string }) => f.id.startsWith("customfield_"))
            .map((f: { id: string; name: string }) => ({ id: f.id, name: f.name }))
    : [];

  return NextResponse.json({ issues: data.issues?.slice(0, 1), customFields });
}
