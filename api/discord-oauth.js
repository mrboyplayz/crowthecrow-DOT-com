export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URL;
  if (!kvUrl || !kvToken) {
    res.status(500).json({ error: "missing_kv_config" });
    return;
  }
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).json({ error: "missing_discord_config" });
    return;
  }
  const USERS_KEY = "caw_users_v1";
  const SESSIONS_KEY = "caw_sessions_v1";
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const action = u.searchParams.get("action") || "";
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
  async function kvSet(key, value) {
    const resp = await fetch(`${kvUrl}/set/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kvToken}` },
      body: JSON.stringify(value)
    });
    return resp.ok;
  }
  function now() {
    return Date.now();
  }
  function makeId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  function normalizeSessions(sessions) {
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) return {};
    const next = {};
    for (const [key, value] of Object.entries(sessions)) {
      if (value && typeof value === "object" && typeof value.user === "string") {
        const discordState = typeof value.discordState === "string" ? value.discordState : "";
        next[key] = { user: value.user, admin: !!value.admin, discordState };
      } else if (typeof value === "string") {
        next[key] = { user: value, admin: false, discordState: "" };
      }
    }
    return next;
  }
  async function loadSessions() {
    const sessions = (await kvGet(SESSIONS_KEY, {})) || {};
    return normalizeSessions(sessions);
  }
  async function loadUsers() {
    const users = (await kvGet(USERS_KEY, {})) || {};
    return users && typeof users === "object" && !Array.isArray(users) ? users : {};
  }
  if (action === "start") {
    const tokenValue = String(u.searchParams.get("token") || "");
    if (!tokenValue) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const sessions = await loadSessions();
    const session = sessions[tokenValue];
    if (!session || !session.user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const state = makeId();
    sessions[tokenValue] = { user: session.user, admin: !!session.admin, discordState: state };
    const ok = await kvSet(SESSIONS_KEY, sessions);
    if (!ok) {
      res.status(500).json({ error: "kv_set_failed" });
      return;
    }
    const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "identify");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("prompt", "consent");
    res.status(302).setHeader("Location", authorizeUrl.toString());
    res.end();
    return;
  }
  if (action === "callback") {
    const code = String(u.searchParams.get("code") || "");
    const state = String(u.searchParams.get("state") || "");
    if (!code || !state) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const sessions = await loadSessions();
    let sessionToken = "";
    let session = null;
    for (const [key, value] of Object.entries(sessions)) {
      if (value && value.discordState === state) {
        sessionToken = key;
        session = value;
        break;
      }
    }
    if (!session || !session.user) {
      res.status(400).json({ error: "invalid_state" });
      return;
    }
    const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      })
    });
    if (!tokenResp.ok) {
      res.status(502).json({ error: "token_exchange_failed" });
      return;
    }
    const tokenData = await tokenResp.json();
    const accessToken = String(tokenData?.access_token || "");
    if (!accessToken) {
      res.status(502).json({ error: "token_missing" });
      return;
    }
    const userResp = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!userResp.ok) {
      res.status(502).json({ error: "discord_profile_failed" });
      return;
    }
    const profile = await userResp.json();
    const discordId = String(profile?.id || "");
    if (!discordId) {
      res.status(502).json({ error: "discord_profile_invalid" });
      return;
    }
    const users = await loadUsers();
    const userInfo = users[session.user];
    if (!userInfo) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    users[session.user] = {
      ...userInfo,
      discordId,
      discordUsername: String(profile?.username || ""),
      discordDiscriminator: String(profile?.discriminator || ""),
      discordGlobalName: String(profile?.global_name || ""),
      verifiedAt: now()
    };
    const okUsers = await kvSet(USERS_KEY, users);
    if (!okUsers) {
      res.status(500).json({ error: "kv_set_failed" });
      return;
    }
    sessions[sessionToken] = { user: session.user, admin: !!session.admin, discordState: "" };
    await kvSet(SESSIONS_KEY, sessions);
    res.status(302).setHeader("Location", "/caw-board/?verified=1");
    res.end();
    return;
  }
  res.status(400).json({ error: "unknown_action" });
}
