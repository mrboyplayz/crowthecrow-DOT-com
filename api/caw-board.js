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
  const adminPass2 = process.env.ADMIN_CAW_BOARD_PASSWORD || "";
  const adminUser2 = process.env.ADMIN_CAW_BOARD_USERNAME || "";
  const encoder = new TextEncoder();
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function baseUrlFromReq(req) {
    const proto = String(req.headers["x-forwarded-proto"] || "https");
    const host = String(req.headers.host || "");
    if (!host) return "";
    return `${proto}://${host}`;
  }
  function parseDataUrl(value) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(String(value || ""));
    if (!match) return null;
    const mime = match[1] || "application/octet-stream";
    const isBase64 = !!match[2];
    const data = match[3] || "";
    const buffer = isBase64 ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data), "utf8");
    return { mime, buffer };
  }
  function guessMime(url) {
    const lower = String(url || "").toLowerCase();
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".ogg")) return "video/ogg";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".gif")) return "image/gif";
    return "";
  }
  if (!url || !token) {
    res.status(500).json({ error: "missing_kv_config" });
    return;
  }
  const USERS_KEY = "caw_users_v1";
  const POSTS_KEY = "caw_posts_v1";
  const SESSIONS_KEY = "caw_sessions_v1";
  const MEDIA_KEY_PREFIX = "caw_media_v1:";
  const MEDIA_MAX_CHARS = 900000;
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
  async function kvDel(key) {
    const resp = await fetch(`${url}/del/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
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
  function cleanDescription(s) {
    s = String(s || "").trim().slice(0, 400);
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
  function mediaKey(id) {
    return `${MEDIA_KEY_PREFIX}${id}`;
  }
  function isStoredMedia(urlField) {
    return String(urlField || "").startsWith("kv:");
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
  function normalizeVotes(votes) {
    if (!votes || typeof votes !== "object" || Array.isArray(votes)) return {};
    const next = {};
    for (const [key, value] of Object.entries(votes)) {
      if (value === 1 || value === -1) next[key] = value;
    }
    return next;
  }
  function countVotes(votes) {
    let likes = 0;
    let dislikes = 0;
    for (const value of Object.values(votes || {})) {
      if (value === 1) likes++;
      if (value === -1) dislikes++;
    }
    return { likes, dislikes };
  }
  function normalizePost(post, baseUrl) {
    if (!post || typeof post !== "object") return post;
    const votes = normalizeVotes(post.votes);
    const counts = countVotes(votes);
    const urlField = String(post.url || "");
    const isData = urlField.startsWith("data:") || isStoredMedia(urlField);
    const mediaUrl = isData ? `${baseUrl}/api/caw-board?action=media&id=${encodeURIComponent(post.id)}` : urlField;
    const next = { ...post, url: mediaUrl, likes: counts.likes, dislikes: counts.dislikes };
    delete next.votes;
    return next;
  }
  try {
    if (req.method === "GET" && action === "posts") {
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      const baseUrl = baseUrlFromReq(req);
      const list = Array.isArray(posts) ? posts.slice(0, 200).map(post => normalizePost(post, baseUrl)) : [];
      res.status(200).json({ posts: list });
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
      const baseUrl = baseUrlFromReq(req);
      res.status(200).json({ post: normalizePost(post, baseUrl) });
      return;
    }
    if (req.method === "GET" && action === "embed") {
      const id = String(u.searchParams.get("id") || "");
      if (!id) {
        res.status(400).setHeader("Content-Type", "text/html").end("bad request");
        return;
      }
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      const post = Array.isArray(posts) ? posts.find(p => String(p.id) === id) : null;
      if (!post) {
        res.status(404).setHeader("Content-Type", "text/html").end("not found");
        return;
      }
      const baseUrl = baseUrlFromReq(req);
      const urlField = String(post.url || "");
      const isKv = isStoredMedia(urlField);
      const dataUrl = isKv ? String(await kvGet(mediaKey(post.id), "")) : urlField;
      const isData = urlField.startsWith("data:") || isKv;
      const mediaUrl = isData ? `${baseUrl}/api/caw-board?action=media&id=${encodeURIComponent(post.id)}` : urlField;
      const postUrl = `${baseUrl}/post/?id=${encodeURIComponent(post.id)}`;
      const title = escapeHtml(post.title || "post");
      const desc = escapeHtml(`by ${post.user || "anon"}`);
      const ogType = post.type === "video" ? "video.other" : "article";
      const mime = isData ? parseDataUrl(dataUrl || "")?.mime || "" : guessMime(urlField || "");
      const videoTags = post.type === "video"
        ? `<meta property="og:video" content="${escapeHtml(mediaUrl)}"><meta property="og:video:type" content="${escapeHtml(mime || "video/mp4")}">`
        : "";
      const imageTag = `<meta property="og:image" content="${escapeHtml(mediaUrl)}">`;
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:type" content="${ogType}"><meta property="og:url" content="${escapeHtml(postUrl)}">${imageTag}${videoTags}<meta name="twitter:card" content="summary_large_image"></head><body><a href="${escapeHtml(postUrl)}">View post</a></body></html>`;
      res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    if (req.method === "GET" && action === "media") {
      const id = String(u.searchParams.get("id") || "");
      if (!id) {
        res.status(400).end();
        return;
      }
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      const post = Array.isArray(posts) ? posts.find(p => String(p.id) === id) : null;
      if (!post) {
        res.status(404).end();
        return;
      }
      const urlField = String(post.url || "");
      if (!urlField.startsWith("data:") && !isStoredMedia(urlField)) {
        res.status(302).setHeader("Location", urlField).end();
        return;
      }
      const dataUrl = isStoredMedia(urlField) ? String(await kvGet(mediaKey(post.id), "")) : urlField;
      if (!dataUrl) {
        res.status(404).end();
        return;
      }
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) {
        res.status(400).end();
        return;
      }
      res.status(200);
      res.setHeader("Content-Type", parsed.mime);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.end(parsed.buffer);
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
      if ((adminUser && tscmp(username, adminUser)) || (adminUser2 && tscmp(username, adminUser2))) {
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
      if (
        (adminUser && adminPass && tscmp(username, adminUser) && tscmp(password, adminPass)) ||
        (adminUser2 && adminPass2 && tscmp(username, adminUser2) && tscmp(password, adminPass2))
      ) {
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
      const description = cleanDescription(body?.description);
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
      const isData = urlField.startsWith("data:");
      if (isData) {
        if (urlField.length > MEDIA_MAX_CHARS) {
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
      let finalUrl = urlField;
      if (isData) {
        const mediaOk = await kvSet(mediaKey(nextId), urlField);
        if (!mediaOk) {
          res.status(500).json({ error: "kv_set_failed" });
          return;
        }
        finalUrl = `kv:${nextId}`;
      }
      const post = {
        id: String(nextId),
        user: session.user,
        title,
        description,
        type,
        url: finalUrl,
        ts: now(),
        comments: [],
        votes: {},
        likes: 0,
        dislikes: 0
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
    if (req.method === "POST" && action === "vote") {
      const tokenValue = String(body?.token || "");
      const postId = String(body?.postId || "");
      const value = Number(body?.value || 0);
      if (!tokenValue || !postId || ![1, -1, 0].includes(value)) {
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
      const post = Array.isArray(posts) ? posts.find(p => String(p.id) === postId) : null;
      if (!post) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const votes = normalizeVotes(post.votes);
      if (value === 0) {
        delete votes[session.user];
      } else {
        votes[session.user] = value;
      }
      const counts = countVotes(votes);
      post.votes = votes;
      post.likes = counts.likes;
      post.dislikes = counts.dislikes;
      const ok = await kvSet(POSTS_KEY, posts);
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true, likes: post.likes, dislikes: post.dislikes, vote: value });
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
      if (isStoredMedia(post.url)) {
        await kvDel(mediaKey(post.id));
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
      const post = posts.find(p => p.id === postId);
      if (!post) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (isStoredMedia(post.url)) {
        await kvDel(mediaKey(post.id));
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
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      if (Array.isArray(posts)) {
        for (const post of posts) {
          if (isStoredMedia(post.url)) {
            await kvDel(mediaKey(post.id));
          }
        }
      }
      const ok = await kvSet(POSTS_KEY, []);
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === "POST" && action === "admin_users") {
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
      const users = (await kvGet(USERS_KEY, {})) || {};
      const list = Object.entries(users).map(([user, info]) => ({
        user,
        created: Number(info?.created || 0)
      }));
      list.sort((a, b) => b.created - a.created);
      res.status(200).json({ ok: true, users: list });
      return;
    }
    if (req.method === "POST" && action === "admin_delete_user") {
      const tokenValue = String(body?.token || "");
      const username = cleanUser(body?.username);
      if (!tokenValue || !username) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const sessions = await loadSessions();
      const session = sessions[tokenValue];
      if (!session || !session.admin) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      if (session.user && session.user === username) {
        res.status(400).json({ error: "cannot_delete_self" });
        return;
      }
      const users = (await kvGet(USERS_KEY, {})) || {};
      if (!users[username]) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      delete users[username];
      const nextSessions = {};
      for (const [key, value] of Object.entries(sessions)) {
        if (value && typeof value === "object" && value.user === username) continue;
        nextSessions[key] = value;
      }
      const allPosts = (await kvGet(POSTS_KEY, [])) || [];
      if (Array.isArray(allPosts)) {
        for (const post of allPosts) {
          if (post.user !== username) continue;
          if (isStoredMedia(post.url)) {
            await kvDel(mediaKey(post.id));
          }
        }
      }
      let posts = Array.isArray(allPosts) ? allPosts.filter(p => p.user !== username) : [];
      posts.forEach(p => {
        if (!Array.isArray(p.comments)) return;
        p.comments = p.comments.filter(c => c.user !== username);
        const votes = normalizeVotes(p.votes);
        if (votes[username]) delete votes[username];
        const counts = countVotes(votes);
        p.votes = votes;
        p.likes = counts.likes;
        p.dislikes = counts.dislikes;
      });
      const okUsers = await kvSet(USERS_KEY, users);
      const okSessions = await kvSet(SESSIONS_KEY, nextSessions);
      const okPosts = await kvSet(POSTS_KEY, posts);
      if (!okUsers || !okSessions || !okPosts) {
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
