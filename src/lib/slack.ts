export async function sendSlackAlert(message: string): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) {
    console.warn("SLACK_WEBHOOK_URL not set — skipping alert");
    return false;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    return res.ok;
  } catch (err) {
    console.error("Slack alert failed:", err);
    return false;
  }
}
