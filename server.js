const http = require("http");

const EMAIL = process.env.JIRA_EMAIL || "thais.boaventura@nuvemshop.com";
const TOKEN = process.env.JIRA_API_TOKEN || "";
const BASE = "https://tiendanube.atlassian.net";
const PROJECT = "BDSL";
const PORT = 8888;

async function fetchJira(jql, max = 100) {
  const auth = Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");
  const url = `${BASE}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${max}&fields=summary,status,priority,assignee,created,duedate,timeoriginalestimate`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Jira ${res.status}`);
  return res.json();
}

function estimateDays(summary, timeOrig) {
  if (timeOrig) return Math.ceil(timeOrig / 28800);
  const s = summary.toLowerCase();
  if (s.includes("vídeo") || s.includes("video")) return 4;
  if (s.includes("campanha")) return 3;
  if (s.includes("landing")) return 3;
  if (s.includes("banner")) return 1;
  if (s.includes("post") || s.includes("story")) return 1;
  if (s.includes("email")) return 1;
  return 2;
}

function mapStatus(name) {
  const l = name.toLowerCase();
  if (l.includes("done") || l.includes("conclu")) return "Concluído";
  if (l.includes("review") || l.includes("revis")) return "Em revisão";
  if (l.includes("progress") || l.includes("andamento") || l.includes("doing")) return "Em andamento";
  return "A fazer";
}

function capLabel(pct) {
  if (pct >= 100) return { label: "Sobrecarregado", color: "#dc2626" };
  if (pct >= 80) return { label: "Quase cheio", color: "#ca8a04" };
  if (pct >= 50) return { label: "Moderado", color: "#2563eb" };
  return { label: "Disponível", color: "#16a34a" };
}

function daysLeft(d) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

async function getData() {
  const data = await fetchJira(
    `project = ${PROJECT} AND status != Done AND assignee IS NOT EMPTY ORDER BY assignee, priority DESC`,
    100
  );
  const teamMap = new Map();
  for (const issue of data.issues) {
    if (!issue.fields.assignee) continue;
    const name = issue.fields.assignee.displayName;
    if (!teamMap.has(name)) {
      const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
      teamMap.set(name, { name, initials, tasks: [] });
    }
    teamMap.get(name).tasks.push({
      key: issue.key,
      title: issue.fields.summary,
      status: mapStatus(issue.fields.status.name),
      priority: issue.fields.priority?.name || "Medium",
      dueDate: issue.fields.duedate,
      days: estimateDays(issue.fields.summary, issue.fields.timeoriginalestimate),
    });
  }
  const team = Array.from(teamMap.values()).map((m) => {
    const totalDays = m.tasks.reduce((s, t) => s + t.days, 0);
    m.capacityPercent = Math.round((totalDays / 10) * 100);
    return m;
  });
  team.sort((a, b) => b.capacityPercent - a.capacityPercent);
  return team;
}

function renderHTML(team, source) {
  const totalTasks = team.reduce((s, m) => s + m.tasks.length, 0);
  const avgCap = team.length ? Math.round(team.reduce((s, m) => s + m.capacityPercent, 0) / team.length) : 0;
  const overloaded = team.filter((m) => m.capacityPercent >= 100).length;
  const now = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  let alerts = "";
  for (const m of team) {
    if (m.capacityPercent >= 100) {
      alerts += `<div style="border-left:3px solid #dc2626;background:#fef2f2;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:8px;font-size:14px;color:#374151">🔴 ${m.name.split(" ")[0]} está com ${m.capacityPercent}% da capacidade alocada</div>`;
    } else if (m.capacityPercent >= 80) {
      alerts += `<div style="border-left:3px solid #ca8a04;background:#fefce8;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:8px;font-size:14px;color:#374151">🟡 ${m.name.split(" ")[0]} está com ${m.capacityPercent}% — cuidado ao alocar novas demandas</div>`;
    }
    for (const t of m.tasks) {
      const dl = daysLeft(t.dueDate);
      if (dl !== null && dl < 0) {
        alerts += `<div style="border-left:3px solid #dc2626;background:#fef2f2;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:8px;font-size:14px;color:#374151">🔴 ${t.key} está ATRASADO — venceu há ${Math.abs(dl)} dias</div>`;
      } else if (dl !== null && dl <= 3) {
        alerts += `<div style="border-left:3px solid #ca8a04;background:#fefce8;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:8px;font-size:14px;color:#374151">🟡 ${t.key} vence em ${dl} dia${dl !== 1 ? "s" : ""}</div>`;
      }
    }
  }

  let cards = "";
  for (const m of team) {
    const cap = capLabel(m.capacityPercent);
    let taskRows = "";
    for (const t of m.tasks) {
      const dl = daysLeft(t.dueDate);
      const urgent = dl !== null && dl <= 3;
      const dlText = dl === null ? "" : dl <= 0 ? `<span style="color:#dc2626;font-weight:600">Atrasado!</span>` : `<span style="color:${urgent ? "#dc2626" : "#9ca3af"};${urgent ? "font-weight:600" : ""}">${dl}d restantes</span>`;
      taskRows += `<div style="background:#f9fafb;border-radius:8px;padding:10px 12px;margin-bottom:8px">
        <a href="${BASE}/browse/${t.key}" target="_blank" style="font-size:12px;font-family:monospace;color:#7c3aed;text-decoration:none">${t.key}</a>
        <div style="font-size:14px;color:#374151;margin-top:2px">${t.title}</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:4px">${t.status} · ${t.days}d${dlText ? " · " + dlText : ""}</div>
      </div>`;
    }
    cards += `<div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:50%;background:#ede9fe;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#7c3aed">${m.initials}</div>
          <div><div style="font-weight:600;color:#111">${m.name}</div></div>
        </div>
        <span style="font-size:12px;font-weight:500;padding:4px 10px;border-radius:999px;background:${cap.color}15;color:${cap.color}">${cap.label}</span>
      </div>
      <div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
          <span style="color:#9ca3af">Capacidade</span>
          <span style="font-weight:600;color:${cap.color}">${m.capacityPercent}%</span>
        </div>
        <div style="height:8px;border-radius:999px;background:#f3f4f6;overflow:hidden">
          <div style="height:100%;border-radius:999px;width:${Math.min(m.capacityPercent, 100)}%;background:${cap.color}"></div>
        </div>
      </div>
      ${taskRows}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Creative Command Center</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f8f9fb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1f2937; }
  </style>
</head>
<body>
  <div style="max-width:1200px;margin:0 auto;padding:24px 16px">

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;flex-wrap:wrap;gap:16px">
      <div>
        <h1 style="font-size:24px;font-weight:700;color:#111">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;background:#ede9fe;color:#7c3aed;margin-right:12px;font-size:18px">✦</span>
          Creative Command Center
        </h1>
        <p style="color:#6b7280;font-size:14px;margin-top:4px">${now}</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:white;border:1px solid #e5e7eb;border-radius:999px;padding:6px 14px">
        <span style="width:10px;height:10px;border-radius:50%;background:${source === "jira" ? "#16a34a" : "#ca8a04"}"></span>
        <span style="font-size:12px;color:#6b7280">${source === "jira" ? "Conectado ao Jira" : "Dados de exemplo"}</span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:12px;margin-bottom:32px">
      <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#7c3aed">${team.length}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px">Pessoas</div>
      </div>
      <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#2563eb">${totalTasks}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px">Tarefas ativas</div>
      </div>
      <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:${avgCap > 80 ? "#dc2626" : "#16a34a"}">${avgCap}%</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px">Capacidade média</div>
      </div>
      <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:${overloaded > 0 ? "#dc2626" : "#16a34a"}">${overloaded}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px">Sobrecarregados</div>
      </div>
    </div>

    ${alerts ? `<div style="margin-bottom:32px"><h2 style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Alertas</h2>${alerts}</div>` : ""}

    <h2 style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px">Visão do time</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(340px, 1fr));gap:16px;margin-bottom:32px">
      ${cards}
    </div>

    <footer style="text-align:center;padding:32px 0;font-size:12px;color:#d1d5db">
      Creative Command Center · Brand Creative · Nuvemshop
    </footer>
  </div>
</body>
</html>`;
}

function mockData() {
  return [
    { name: "Beatriz Oliveira", initials: "BO", capacityPercent: 110, tasks: [
      { key: "BDSL-32091", title: "Campanha Black Friday — Banners", status: "Em andamento", priority: "High", dueDate: "2026-04-18", days: 3 },
      { key: "BDSL-32088", title: "Posts Instagram — Lojista Premium Q2", status: "Em andamento", priority: "Medium", dueDate: "2026-04-22", days: 2 },
    ]},
    { name: "Lucas Mendes", initials: "LM", capacityPercent: 70, tasks: [
      { key: "BDSL-32085", title: "Vídeo institucional — Nuvemshop Next", status: "Em andamento", priority: "Critical", dueDate: "2026-04-28", days: 5 },
    ]},
    { name: "Marina Costa", initials: "MC", capacityPercent: 40, tasks: [
      { key: "BDSL-32090", title: "Landing page — Evento Lojistas SP", status: "Em andamento", priority: "Medium", dueDate: "2026-04-24", days: 2 },
    ]},
    { name: "Rafael Santos", initials: "RS", capacityPercent: 85, tasks: [
      { key: "BDSL-32087", title: "Textos campanha Dia das Mães", status: "Em andamento", priority: "High", dueDate: "2026-04-20", days: 3 },
    ]},
  ];
}

const server = http.createServer(async (req, res) => {
  if (req.url !== "/" && req.url !== "") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  let team;
  let source;
  try {
    team = await getData();
    source = "jira";
    console.log(`✓ Jira conectado — ${team.length} pessoas encontradas`);
  } catch (err) {
    console.log(`✗ Jira falhou (${err.message}) — usando dados de exemplo`);
    team = mockData();
    source = "mock";
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderHTML(team, source));
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ✦ Creative Command Center");
  console.log(`  → Abra no navegador: http://localhost:${PORT}`);
  console.log("");
});
