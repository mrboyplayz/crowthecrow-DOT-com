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
  const adminPass = process.env.CAW_ADMIN_PASSWORD || "";
  const adminUser = process.env.CAW_ADMIN_USERNAME || "";
  const encoder = new TextEncoder();
  if (!url || !token) {
    res.status(500).json({ error: "missing_kv_config" });
    return;
  }
  const USERS_KEY = "caw_users_v1";
  const POSTS_KEY = "caw_posts_v1";
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
    const resp = await fetch(`${url}/get/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    return parseJSON(data.result, fallback);
  }
  async function kvSet(key, value) {
    const resp = await fetch(`${url}/set/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(value)
    });
    return resp.ok;
  }
  function tscmp(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }
  function cleanTitle(s) {
    s = String(s || "").slice(0, 140);
    return s.replace(/[<>&]/g, "");
  }
  function titleFromUrl(urlField) {
    if (!urlField || urlField.startsWith("data:")) return "";
    try {
      const parsed = new URL(urlField);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const last = parts.length ? parts[parts.length - 1] : parsed.hostname;
      return decodeURIComponent(last || "").slice(0, 140);
    } catch {
      return "";
    }
  }
  function cleanUser(s) {
    return String(s || "").trim().slice(0, 24).replace(/[^\w.-]/g, "");
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
  function b64(bytes) {
    return Buffer.from(bytes).toString("base64");
  }
  function randomSalt() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto && globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return b64(bytes);
  }
  async function hashPass(pass, salt) {
    const data = encoder.encode(String(salt) + String(pass));
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
      return b64(new Uint8Array(buf));
    }
    return b64(data);
  }
  async function readBody() {
    try {
      if (typeof req.body === "string") return JSON.parse(req.body);
      if (req.body && typeof req.body === "object") return req.body;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
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
  try {
    if (req.method === "GET" && action === "posts") {
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      res.status(200).json({ posts: Array.isArray(posts) ? posts.slice(0, 200) : [] });
      return;
    }
    if (req.method === "GET" && action === "post") {
      const id = String(u.searchParams.get("id") || "");
      if (!id) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      const post = Array.isArray(posts) ? posts.find(p => String(p.id) === id) : null;
      if (!post) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(200).json({ post });
      return;
    }
    if (req.method === "GET" && action === "user_salt") {
      const username = cleanUser(u.searchParams.get("username") || "");
      if (!username) {
        res.status(400).json({ error: "bad_username" });
        return;
      }
      const users = (await kvGet(USERS_KEY, {})) || {};
      const user = users[username];
      if (!user) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(200).json({ salt: user.salt || "" });
      return;
    }
    const body = await readBody();
    if (req.method === "POST" && action === "signup") {
      const username = cleanUser(body?.username);
      const password = String(body?.password || "");
      if (!username || password.length < 6) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      if (adminUser && tscmp(username, adminUser)) {
        res.status(403).json({ error: "reserved_username" });
        return;
      }
      const users = (await kvGet(USERS_KEY, {})) || {};
      if (users[username]) {
        res.status(409).json({ error: "exists" });
        return;
      }
      const salt = randomSalt();
      const hash = await hashPass(password, salt);
      users[username] = { salt, hash, created: now() };
      const ok = await kvSet(USERS_KEY, users);
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      const sessions = await loadSessions();
      const sessionToken = makeId();
      sessions[sessionToken] = { user: username, admin: false };
      await kvSet(SESSIONS_KEY, sessions);
      res.status(200).json({ ok: true, token: sessionToken, user: username, admin: false });
      return;
    }
    if (req.method === "POST" && action === "login") {
      const username = cleanUser(body?.username);
      const password = String(body?.password || "");
      if (!username || !password) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      if (adminUser && adminPass && tscmp(username, adminUser) && tscmp(password, adminPass)) {
        const sessions = await loadSessions();
        const sessionToken = makeId();
        sessions[sessionToken] = { user: username, admin: true };
        await kvSet(SESSIONS_KEY, sessions);
        res.status(200).json({ ok: true, token: sessionToken, user: username, admin: true });
        return;
      }
      const users = (await kvGet(USERS_KEY, {})) || {};
      const user = users[username];
      if (!user || !user.hash) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const hash = await hashPass(password, user.salt || "");
      const ok = tscmp(hash, String(user.hash));
      if (!ok) {
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      const sessions = await loadSessions();
      const sessionToken = makeId();
      sessions[sessionToken] = { user: username, admin: false };
      await kvSet(SESSIONS_KEY, sessions);
      res.status(200).json({ ok: true, token: sessionToken, user: username, admin: false });
      return;
    }
    if (req.method === "POST" && action === "session") {
      const tokenValue = String(body?.token || "");
      if (!tokenValue) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const sessions = await loadSessions();
      const session = sessions[tokenValue];
      if (!session || !session.user) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(200).json({ ok: true, user: session.user, admin: !!session.admin });
      return;
    }
    if (req.method === "POST" && action === "create_post") {
      const tokenValue = String(body?.token || "");
      let title = cleanTitle(body?.title);
      const type = String(body?.type || "image") === "video" ? "video" : "image";
      const urlField = String(body?.url || "").trim();
      if (!tokenValue || !urlField) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      if (!title) {
        title = cleanTitle(titleFromUrl(urlField) || "post");
      }
      const sessions = await loadSessions();
      const session = sessions[tokenValue];
      if (!session || !session.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      if (urlField.startsWith("data:")) {
        if (urlField.length > 40 * 1024 * 1024) {
          res.status(413).json({ error: "payload_too_large" });
          return;
        }
      } else if (urlField.length > 1024) {
        res.status(400).json({ error: "url_too_long" });
        return;
      }
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      const numericIds = Array.isArray(posts) ? posts.map(p => parseInt(p.id, 10)).filter(n => Number.isFinite(n)) : [];
      const nextId = numericIds.length ? Math.max(...numericIds) + 1 : 1;
      const post = {
        id: String(nextId),
        user: session.user,
        title,
        type,
        url: urlField,
        ts: now(),
        comments: []
      };
      posts.unshift(post);
      const ok = await kvSet(POSTS_KEY, posts.slice(0, 300));
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true, post });
      return;
    }
    if (req.method === "POST" && action === "comment") {
      const tokenValue = String(body?.token || "");
      const postId = String(body?.postId || "");
      const text = String(body?.text || "").trim().slice(0, 400);
      if (!tokenValue || !postId || !text) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const sessions = await loadSessions();
      const session = sessions[tokenValue];
      if (!session || !session.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      const post = posts.find(p => p.id === postId);
      if (!post) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const comment = { id: makeId(), user: session.user, text, ts: now() };
      post.comments = Array.isArray(post.comments) ? post.comments : [];
      post.comments.push(comment);
      const ok = await kvSet(POSTS_KEY, posts);
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === "POST" && action === "delete_post") {
      const tokenValue = String(body?.token || "");
      const postId = String(body?.postId || "");
      if (!tokenValue || !postId) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const sessions = await loadSessions();
      const session = sessions[tokenValue];
      if (!session || !session.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      let posts = (await kvGet(POSTS_KEY, [])) || [];
      const post = posts.find(p => p.id === postId);
      if (!post) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (!session.admin && post.user !== session.user) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      posts = posts.filter(p => p.id !== postId);
      const ok = await kvSet(POSTS_KEY, posts);
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === "POST" && action === "admin_delete_post") {
      const tokenValue = String(body?.token || "");
      if (!tokenValue) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const sessions = await loadSessions();
      const session = sessions[tokenValue];
      if (!session || !session.admin) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const postId = String(body?.postId || "");
      if (!postId) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      let posts = (await kvGet(POSTS_KEY, [])) || [];
      posts = posts.filter(p => p.id !== postId);
      const ok = await kvSet(POSTS_KEY, posts);
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === "POST" && action === "admin_wipe_posts") {
      const tokenValue = String(body?.token || "");
      if (!tokenValue) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const sessions = await loadSessions();
      const session = sessions[tokenValue];
      if (!session || !session.admin) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const ok = await kvSet(POSTS_KEY, []);
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === "POST" && action === "admin_delete_comment") {
      const tokenValue = String(body?.token || "");
      if (!tokenValue) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const sessions = await loadSessions();
      const session = sessions[tokenValue];
      if (!session || !session.admin) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const postId = String(body?.postId || "");
      const commentId = String(body?.commentId || "");
      if (!postId || !commentId) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      const post = posts.find(p => p.id === postId);
      if (!post) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      post.comments = Array.isArray(post.comments) ? post.comments.filter(c => c.id !== commentId) : [];
      const ok = await kvSet(POSTS_KEY, posts);
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: "unknown_action" });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
}
