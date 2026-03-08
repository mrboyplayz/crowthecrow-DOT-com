export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const pull = process.env.BUNNY_STORAGE_PULL || "";
  const storageEndpoint = process.env.BUNNY_STORAGE_ENDPOINT || "storage.bunnycdn.com";
  const storageZone = process.env.BUNNY_STORAGE_ZONE || "";
  const accessKey = process.env.BUNNY_STORAGE_KEY || "";
  if (!storageZone || !accessKey || !pull) {
    res.status(500).json({ error: "missing_bunny_config" });
    return;
  }
  const tokenValue = String(req.query?.token || "");
  if (!tokenValue) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || "https";
  const sessionUrl = `${proto}://${host}/api/caw-board?action=session`;
  try {
    const sessionResp = await fetch(sessionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenValue })
    });
    if (!sessionResp.ok) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const sessionData = await sessionResp.json();
    if (!sessionData?.user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  } catch {
    res.status(500).json({ error: "session_check_failed" });
    return;
  }
  const filename = String(req.query?.filename || "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const ext = filename.includes(".") ? filename.split(".").pop() : "";
  const base = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const safeName = ext ? `${base}.${ext}` : base;
  const uploadUrl = `https://${storageEndpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${storageZone}/${safeName}`;
  try {
    const upstream = await fetch(uploadUrl, {
      method: "PUT",
      headers: { AccessKey: accessKey, "Content-Type": req.headers["content-type"] || "application/octet-stream" },
      body: req,
      duplex: "half"
    });
    if (!upstream.ok) {
      res.status(502).json({ error: "bunny_upload_failed" });
      return;
    }
  } catch {
    res.status(502).json({ error: "bunny_upload_failed" });
    return;
  }
  res.status(200).json({ path: safeName, url: `https://${pull.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${safeName}` });
}
