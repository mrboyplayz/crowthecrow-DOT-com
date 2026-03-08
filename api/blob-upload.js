import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  const origin = req.headers.origin || "*";
  const reqHeaders = req.headers["access-control-request-headers"];
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", reqHeaders || "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(500).json({ error: "missing_blob_token" });
    return;
  }
  if (!kvUrl || !kvToken) {
    res.status(500).json({ error: "missing_kv_config" });
    return;
  }
  const SESSIONS_KEY = "caw_sessions_v1";
  function parseJSON(result, fallback) {
    if (result == null) return fallback;
    if (typeof result === "string") {
      try {
        return JSON.parse(result);
      } catch {
        return fallback;
      }
    }
    return result ?? fallback;
  }
  async function kvGet(key, fallback) {
    const resp = await fetch(`${kvUrl}/get/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const data = await resp.json();
    return parseJSON(data.result, fallback);
  }
  function normalizeSessions(sessions) {
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) return {};
    const next = {};
    for (const [key, value] of Object.entries(sessions)) {
      if (value && typeof value === "object" && typeof value.user === "string") {
        next[key] = { user: value.user, admin: !!value.admin };
      } else if (typeof value === "string") {
        next[key] = { user: value, admin: false };
      }
    }
    return next;
  }
  async function loadSessions() {
    const sessions = (await kvGet(SESSIONS_KEY, {})) || {};
    return normalizeSessions(sessions);
  }
  return handleUpload({
    req,
    res,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      let payload = {};
      try {
        payload = JSON.parse(clientPayload || "{}");
      } catch {
        payload = {};
      }
      const tokenValue = String(payload?.token || "");
      if (!tokenValue) {
        throw new Error("unauthorized");
      }
      const sessions = await loadSessions();
      const session = sessions[tokenValue];
      if (!session || !session.user) {
        throw new Error("unauthorized");
      }
      return {
        access: "public",
        addRandomSuffix: true,
        maximumSizeInBytes: 2147483648
      };
    },
    onUploadCompleted: async () => {}
  });
}
