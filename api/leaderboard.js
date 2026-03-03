export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    res.status(500).json({ error: "missing_kv_config" });
    return;
  }
  const key = "slots_leaderboard";
  function normalizeList(result) {
    if (Array.isArray(result)) return result;
    if (typeof result === "string") {
      try {
        const parsed = JSON.parse(result);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return [];
  }
  try {
    if (req.method === "GET") {
      const resp = await fetch(`${url}/get/${key}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await resp.json();
      const list = normalizeList(data.result);
      res.status(200).json({ leaderboard: list.slice(0, 25) });
      return;
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const name = String(body?.name || "").trim().slice(0, 18) || "player";
      const score = Number(body?.score || 0);
      const getResp = await fetch(`${url}/get/${key}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const getData = await getResp.json();
      const list = normalizeList(getData.result);
      const existing = list.find((entry) => entry.name === name);
      if (existing) {
        if (score > existing.score) existing.score = score;
      } else {
        list.push({ name, score });
      }
      list.sort((a, b) => b.score - a.score);
      const setResp = await fetch(`${url}/set/${key}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(list.slice(0, 50))
      });
      if (!setResp.ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ leaderboard: list.slice(0, 25) });
      return;
    }
    res.status(405).json({ error: "method_not_allowed" });
  } catch (_) {
    res.status(500).json({ error: "server_error" });
  }
}
