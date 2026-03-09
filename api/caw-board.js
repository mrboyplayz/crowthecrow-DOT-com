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
  const BANNED_USERS_KEY = "caw_banned_users_v1";
  const BANNED_IPS_KEY = "caw_banned_ips_v1";
  const MEDIA_KEY_PREFIX = "caw_media_v1:";
  const CAPTCHA_KEY_PREFIX = "caw_captcha_v1:";
  const CAPTCHA_QUIZ_KEY_PREFIX = "caw_captcha_quiz_v1:";
  const CAPTCHA_PASS_KEY_PREFIX = "caw_captcha_pass_v1:";
  const COMMENT_RATE_KEY_PREFIX = "caw_comment_rate_v1:";
  const MEDIA_MAX_CHARS = 900000;
  const MAX_ACCOUNTS_PER_IP = 3;
  const COMMENT_BURST_COUNT = 4;
  const COMMENT_COOLDOWN_MS = 40 * 1000;
  const CAPTCHA_TTL_MS = 5 * 60 * 1000;
  const CAPTCHA_PASS_TTL_MS = 10 * 60 * 1000;
  const CAPTCHA_QUIZ_COUNT = 5;
  const CAPTCHA_QUESTIONS = [
    { prompt: "Who is this SMLWIKI Character?", image: "/smlwiki/jerryshop/jerry.png", answers: ["jerry"] },
    {
      prompt: "When was Crow's ZCity first made?",
      image: "/pluv/crowpluv.png",
      answers: ["october 1st", "october 1st 2025", "2025/10/1"],
      choices: ["October 1st 2025", "January 5th 2024", "March 10th 2026", "June 1st 2023"]
    },
    {
      prompt: "When was Saudi Arabia first created?",
      image: "/caw-content/saudi.png",
      answers: ["September 23, 1932", "1932", "sep 23 1932"],
      choices: ["September 23, 1932", "September 23, 1923", "January 1, 1900", "December 10, 1945"]
    },
    {
      prompt: "What was the first episode that jeffy was in?",
      image: "/caw-content/SMLLogo.webp",
      answers: ["Mario The Babysitter", "Mario The Babysitter!"],
      choices: ["Mario The Babysitter", "The Big Arch!", "Koopa's New Job", "Charleyyy and Friends"]
    },
    {
      prompt: "Who was the first person to nuke Crow's ZCity?",
      image: "/caw-content/pluvia.mp4",
      answers: ["John Crust", "d1o_da"],
      choices: ["John Crust", "kazoo", "grandpa", "kliv"]
    },
    {
      prompt: "who is a pervert",
      image: "/caw-content/pluvia.mp4",
      answers: ["jon"],
      choices: ["Freakpool", "jon"]
    },
    { prompt: "Who is this SMLWIKI Character?", image: "/smlwiki/marvin.jpg", answers: ["marvin", "mario"] },
    { prompt: "Who is this SMLWIKI Character?", image: "/smlwiki/brokenguy.webp", answers: ["brooklyn guy", "brooklynguy", "brooklyn t guy"] },
    { prompt: "Who is this SMLWIKI Character?", image: "/smlwiki/juniorr.jpg", answers: ["junior", "bowser junior", "god"] },
    { prompt: "Who is this SMLWIKI Character?", image: "/smlwiki/jos.webp", answers: ["joseph"] },
    { prompt: "Who is this SMLWIKI Character?", image: "/smlwiki/cody.jpg", answers: ["cody"] },
    { prompt: "Who is this SMLWIKI Character?", image: "/smlwiki/chefpay.webp", answers: ["chef pee pee", "chefpeepee", "chef peepee", "chef penis"] },
    { prompt: "Who is this ??? Character?", image: "/caw-content/FASHION.jpg", answers: ["fashion new year"] },
  ];
  const CAW_BOARD_CLOSED = false;
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const action = u.searchParams.get("action") || "";
  const closedAllowActions = new Set(["embed", "captcha", "quiz_start", "quiz_answer", "login", "session", "admin_wipe_non_admin", "admin_wipe_users_without_posts", "admin_ip_ban_user"]);
  if (CAW_BOARD_CLOSED) {
    if (req.method === "GET" && action === "embed") {
      res.status(503).setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><meta property=\"og:title\" content=\"Caw-board closed\"><meta property=\"og:description\" content=\"Caw-board is currently closed.\"><meta name=\"twitter:card\" content=\"summary\"></head><body>Caw-board is currently closed.</body></html>");
      return;
    }
    if (!closedAllowActions.has(action)) {
      res.status(503).json({ error: "caw_board_closed" });
      return;
    }
  }
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
  function adminNamesSet() {
    const names = [cleanUser(adminUser), cleanUser(adminUser2)].filter(Boolean);
    return new Set(names);
  }
  function normalizeModerationText(value) {
    return String(value || "").toLowerCase();
  }
  function containsHardR(text) {
    return /\bn[\W_]*i[\W_]*g[\W_]*g[\W_]*e[\W_]*r\b/i.test(text);
  }
  function containsDiscordInvite(text) {
    return /(https?:\/\/)?(www\.)?(discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/)[a-z0-9-]+/i.test(text);
  }
  function containsBannableContent(text) {
    const value = normalizeModerationText(text);
    if (!value) return false;
    return containsHardR(value) || containsDiscordInvite(value);
  }
  async function loadStringSet(key) {
    const raw = await kvGet(key, []);
    const list = Array.isArray(raw) ? raw : [];
    return new Set(list.map(v => String(v || "").trim()).filter(Boolean));
  }
  async function saveStringSet(key, setObj) {
    return kvSet(key, Array.from(setObj));
  }
  async function isIpBanned(ip) {
    const value = String(ip || "").trim();
    if (!value) return false;
    const bannedIps = await loadStringSet(BANNED_IPS_KEY);
    return bannedIps.has(value);
  }
  async function isUserBanned(username) {
    const value = cleanUser(username);
    if (!value) return false;
    const bannedUsers = await loadStringSet(BANNED_USERS_KEY);
    return bannedUsers.has(value);
  }
  async function enforceBan(req, username) {
    const ip = clientIpFromReq(req);
    if (await isIpBanned(ip)) return { blocked: true, code: 403, error: "ip_banned" };
    if (await isUserBanned(username)) return { blocked: true, code: 403, error: "account_banned" };
    return { blocked: false };
  }
  async function applyAutomaticBan(req, username, options = {}) {
    const targetUser = cleanUser(username);
    if (!targetUser) return false;
    const useRequestIp = options.useRequestIp !== false;
    const users = (await kvGet(USERS_KEY, {})) || {};
    const userRecord = users[targetUser];
    const requestIp = clientIpFromReq(req);
    const fallbackIp = String(userRecord?.signupIp || "").trim();
    const ipsToBan = new Set();
    if (fallbackIp) ipsToBan.add(fallbackIp);
    if (useRequestIp && requestIp) ipsToBan.add(requestIp);
    const bannedUsers = await loadStringSet(BANNED_USERS_KEY);
    bannedUsers.add(targetUser);
    const bannedIps = await loadStringSet(BANNED_IPS_KEY);
    for (const value of ipsToBan) bannedIps.add(value);
    delete users[targetUser];
    const sessions = await loadSessions();
    const nextSessions = {};
    for (const [key, value] of Object.entries(sessions)) {
      if (value && typeof value === "object" && String(value.user || "") === targetUser) continue;
      nextSessions[key] = value;
    }
    const allPosts = (await kvGet(POSTS_KEY, [])) || [];
    const nextPosts = [];
    if (Array.isArray(allPosts)) {
      for (const post of allPosts) {
        if (String(post?.user || "") === targetUser) {
          if (isStoredMedia(post?.url)) await kvDel(mediaKey(post.id));
          continue;
        }
        post.comments = Array.isArray(post.comments) ? post.comments.filter(c => String(c?.user || "") !== targetUser) : [];
        const votes = normalizeVotes(post.votes);
        if (votes[targetUser]) delete votes[targetUser];
        const counts = countVotes(votes);
        post.votes = votes;
        post.likes = counts.likes;
        post.dislikes = counts.dislikes;
        nextPosts.push(post);
      }
    }
    const okUsers = await kvSet(USERS_KEY, users);
    const okSessions = await kvSet(SESSIONS_KEY, nextSessions);
    const okPosts = await kvSet(POSTS_KEY, nextPosts);
    const okBannedUsers = await saveStringSet(BANNED_USERS_KEY, bannedUsers);
    const okBannedIps = await saveStringSet(BANNED_IPS_KEY, bannedIps);
    return !!(okUsers && okSessions && okPosts && okBannedUsers && okBannedIps);
  }
  function clientIpFromReq(req) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map(v => v.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[0];
    const real = String(req.headers["x-real-ip"] || "").trim();
    if (real) return real;
    const socketIp = String(req.socket?.remoteAddress || "").trim();
    return socketIp || "";
  }
  function now() {
    return Date.now();
  }
  function mediaKey(id) {
    return `${MEDIA_KEY_PREFIX}${id}`;
  }
  function captchaKey(id) {
    return `${CAPTCHA_KEY_PREFIX}${id}`;
  }
  function captchaQuizKey(id) {
    return `${CAPTCHA_QUIZ_KEY_PREFIX}${id}`;
  }
  function captchaPassKey(id) {
    return `${CAPTCHA_PASS_KEY_PREFIX}${id}`;
  }
  function commentRateKey(user) {
    return `${COMMENT_RATE_KEY_PREFIX}${cleanUser(user)}`;
  }
  function isStoredMedia(urlField) {
    return String(urlField || "").startsWith("kv:");
  }
  function cleanCaptchaAnswer(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  }
  function normalizeQuizAnswer(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }
  function buildQuizQuestionPayload(quiz, index) {
    const item = quiz.questions[index];
    return {
      quizId: quiz.id,
      index: index + 1,
      total: quiz.questions.length,
      prompt: String(item?.prompt || "Who is this character?"),
      image: String(item?.image || ""),
      choices: Array.isArray(item?.choices) ? item.choices.map(v => String(v || "")).filter(Boolean) : []
    };
  }
  function shuffleArray(list) {
    const next = Array.isArray(list) ? [...list] : [];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
    }
    return next;
  }
  function pickQuizQuestions() {
    const pool = CAPTCHA_QUESTIONS.map(item => ({
      prompt: String(item?.prompt || ""),
      image: String(item?.image || ""),
      answers: Array.isArray(item?.answers) ? item.answers.map(normalizeQuizAnswer).filter(Boolean) : [],
      choices: shuffleArray(
        Array.isArray(item?.choices)
          ? item.choices.map(v => String(v || "").trim()).filter(Boolean)
          : []
      )
    })).filter(item => item.prompt && item.answers.length);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, Math.min(CAPTCHA_QUIZ_COUNT, pool.length));
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
  function mediaTypeFromMime(mime, fallbackType) {
    const value = String(mime || "").toLowerCase();
    if (value.startsWith("video/")) return "video";
    if (value.startsWith("image/")) return "image";
    return String(fallbackType || "image") === "video" ? "video" : "image";
  }
  async function normalizePost(post, baseUrl) {
    if (!post || typeof post !== "object") return post;
    const votes = normalizeVotes(post.votes);
    const counts = countVotes(votes);
    const urlField = String(post.url || "");
    const isData = urlField.startsWith("data:") || isStoredMedia(urlField);
    const mediaUrl = isData ? `${baseUrl}/api/caw-board?action=media&id=${encodeURIComponent(post.id)}` : urlField;
    let mime = String(post.mime || "");
    if (!mime && isStoredMedia(urlField)) {
      const raw = String(await kvGet(mediaKey(post.id), ""));
      mime = parseDataUrl(raw)?.mime || "";
    }
    if (!mime) mime = guessMime(urlField);
    const type = mediaTypeFromMime(mime, post.type);
    const next = { ...post, type, mime, url: mediaUrl, likes: counts.likes, dislikes: counts.dislikes };
    delete next.votes;
    return next;
  }
  try {
    if (req.method === "GET" && action === "captcha") {
      const a = 1 + Math.floor(Math.random() * 9);
      const b = 1 + Math.floor(Math.random() * 9);
      const captchaId = makeId();
      const answer = cleanCaptchaAnswer(String(a + b));
      const ok = await kvSet(captchaKey(captchaId), { answer, ts: now() });
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true, captchaId, prompt: `${a} + ${b} = ?` });
      return;
    }
    if (req.method === "GET" && action === "quiz_start") {
      const questions = pickQuizQuestions();
      if (!questions.length) {
        res.status(500).json({ error: "captcha_unavailable" });
        return;
      }
      const quiz = { id: makeId(), created: now(), index: 0, questions };
      const ok = await kvSet(captchaQuizKey(quiz.id), quiz);
      if (!ok) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true, ...buildQuizQuestionPayload(quiz, 0) });
      return;
    }
    if (req.method === "POST" && action === "quiz_answer") {
      const quizBody = await readBody();
      const quizId = String(quizBody?.quizId || "");
      const answer = normalizeQuizAnswer(quizBody?.answer || "");
      if (!quizId || !answer) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const key = captchaQuizKey(quizId);
      const quiz = await kvGet(key, null);
      if (!quiz || typeof quiz !== "object" || !Array.isArray(quiz.questions)) {
        res.status(400).json({ error: "captcha_expired" });
        return;
      }
      const age = now() - Number(quiz.created || 0);
      if (!Number.isFinite(age) || age > CAPTCHA_TTL_MS) {
        await kvDel(key);
        res.status(400).json({ error: "captcha_expired" });
        return;
      }
      const idx = Number(quiz.index || 0);
      const current = quiz.questions[idx];
      const answerSet = Array.isArray(current?.answers) ? new Set(current.answers.map(normalizeQuizAnswer)) : new Set();
      if (!answerSet.has(answer)) {
        res.status(400).json({ error: "captcha_wrong_answer", ...buildQuizQuestionPayload(quiz, idx) });
        return;
      }
      const nextIdx = idx + 1;
      if (nextIdx >= quiz.questions.length) {
        await kvDel(key);
        const passToken = makeId();
        const okPass = await kvSet(captchaPassKey(passToken), { ts: now() });
        if (!okPass) {
          res.status(500).json({ error: "kv_set_failed" });
          return;
        }
        res.status(200).json({ ok: true, done: true, passToken });
        return;
      }
      quiz.index = nextIdx;
      const okQuiz = await kvSet(key, quiz);
      if (!okQuiz) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true, done: false, ...buildQuizQuestionPayload(quiz, nextIdx) });
      return;
    }
    if (req.method === "GET" && action === "posts") {
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      const baseUrl = baseUrlFromReq(req);
      const list = Array.isArray(posts) ? await Promise.all(posts.slice(0, 200).map(post => normalizePost(post, baseUrl))) : [];
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
      res.status(200).json({ post: await normalizePost(post, baseUrl) });
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
      const postUrl = `${baseUrl}/post/${encodeURIComponent(post.id)}`;
      const rawTitle = String(post.title || "post");
      const rawUser = String(post.user || "anon");
      const rawDescription = String(post.description || "").trim();
      const combinedDescription = [`by ${rawUser}`, rawDescription].filter(Boolean).join(" • ").slice(0, 280);
      const title = escapeHtml(rawTitle);
      const desc = escapeHtml(combinedDescription || `by ${rawUser}`);
      const mime = isData ? parseDataUrl(dataUrl || "")?.mime || "" : guessMime(urlField || "");
      const embedType = mediaTypeFromMime(mime, post.type);
      const ogType = embedType === "video" ? "video.other" : "article";
      const escapedMediaUrl = escapeHtml(mediaUrl);
      const escapedPostUrl = escapeHtml(postUrl);
      const imageTag = `<meta property="og:image" content="${escapedMediaUrl}"><meta name="twitter:image" content="${escapedMediaUrl}">`;
      const twitterCard = embedType === "video" ? "player" : "summary_large_image";
      const videoTags = embedType === "video"
        ? `<meta property="og:video" content="${escapedMediaUrl}"><meta property="og:video:secure_url" content="${escapedMediaUrl}"><meta property="og:video:type" content="${escapeHtml(mime || "video/mp4")}"><meta name="twitter:player" content="${escapedMediaUrl}">`
        : "";
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${desc}"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:type" content="${ogType}"><meta property="og:url" content="${escapedPostUrl}"><meta property="og:site_name" content="Caw-board"><meta property="article:author" content="${escapeHtml(rawUser)}">${imageTag}${videoTags}<meta name="twitter:card" content="${twitterCard}"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${desc}"></head><body><a href="${escapedPostUrl}">View post</a></body></html>`;
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
      const banned = await enforceBan(req, username);
      if (banned.blocked) {
        res.status(banned.code).json({ error: banned.error });
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
    async function verifyCaptcha() {
      const passToken = String(body?.captchaPassToken || "");
      if (!passToken) return { ok: false, error: "captcha_required", code: 400 };
      const key = captchaPassKey(passToken);
      const pass = await kvGet(key, null);
      await kvDel(key);
      if (!pass || typeof pass !== "object") return { ok: false, error: "captcha_invalid", code: 400 };
      const age = now() - Number(pass.ts || 0);
      if (!Number.isFinite(age) || age > CAPTCHA_PASS_TTL_MS) return { ok: false, error: "captcha_expired", code: 400 };
      return { ok: true };
    }
    if (req.method === "GET" && action === "recaptcha_config") {
      res.status(200).json({
        ok: true,
        enabled: false,
        siteKey: ""
      });
      return;
    }
    if (req.method === "POST" && action === "signup") {
      const bannedByIp = await enforceBan(req, "");
      if (bannedByIp.blocked) {
        res.status(bannedByIp.code).json({ error: bannedByIp.error });
        return;
      }
      const captcha = await verifyCaptcha();
      if (!captcha.ok) {
        res.status(captcha.code).json({ error: captcha.error });
        return;
      }
      const username = cleanUser(body?.username);
      const password = String(body?.password || "");
      if (!username || password.length < 6) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const bannedByUser = await enforceBan(req, username);
      if (bannedByUser.blocked) {
        res.status(bannedByUser.code).json({ error: bannedByUser.error });
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
      const signupIp = clientIpFromReq(req);
      if (signupIp) {
        const usedCount = Object.values(users).reduce((acc, user) => acc + (user?.signupIp === signupIp ? 1 : 0), 0);
        if (usedCount >= MAX_ACCOUNTS_PER_IP) {
          res.status(429).json({ error: "ip_limit_reached" });
          return;
        }
      }
      const salt = randomSalt();
      const hash = await hashPass(password, salt);
      users[username] = { salt, hash, created: now(), signupIp };
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
      const bannedByIp = await enforceBan(req, "");
      if (bannedByIp.blocked) {
        res.status(bannedByIp.code).json({ error: bannedByIp.error });
        return;
      }
      const captcha = await verifyCaptcha();
      if (!captcha.ok) {
        res.status(captcha.code).json({ error: captcha.error });
        return;
      }
      const username = cleanUser(body?.username);
      const password = String(body?.password || "");
      if (!username || !password) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const bannedByUser = await enforceBan(req, username);
      if (bannedByUser.blocked) {
        res.status(bannedByUser.code).json({ error: bannedByUser.error });
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
      const banned = await enforceBan(req, session.user);
      if (banned.blocked) {
        delete sessions[tokenValue];
        await kvSet(SESSIONS_KEY, sessions);
        res.status(banned.code).json({ error: banned.error });
        return;
      }
      res.status(200).json({ ok: true, user: session.user, admin: !!session.admin });
      return;
    }
    if (req.method === "POST" && action === "create_post") {
      const captcha = await verifyCaptcha();
      if (!captcha.ok) {
        res.status(captcha.code).json({ error: captcha.error });
        return;
      }
      const tokenValue = String(body?.token || "");
      let title = cleanTitle(body?.title);
      const description = cleanDescription(body?.description);
      const requestedType = String(body?.type || "image") === "video" ? "video" : "image";
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
      const banned = await enforceBan(req, session.user);
      if (banned.blocked) {
        delete sessions[tokenValue];
        await kvSet(SESSIONS_KEY, sessions);
        res.status(banned.code).json({ error: banned.error });
        return;
      }
      const rawTitle = String(body?.title || "");
      if (containsBannableContent(rawTitle)) {
        const okBan = await applyAutomaticBan(req, session.user);
        if (!okBan) {
          res.status(500).json({ error: "kv_set_failed" });
          return;
        }
        res.status(403).json({ error: "account_banned" });
        return;
      }
      const isData = urlField.startsWith("data:");
      let mime = "";
      if (isData) {
        mime = parseDataUrl(urlField)?.mime || "";
      } else {
        mime = guessMime(urlField);
      }
      const type = mediaTypeFromMime(mime, requestedType);
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
        mime,
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
      const banned = await enforceBan(req, session.user);
      if (banned.blocked) {
        delete sessions[tokenValue];
        await kvSet(SESSIONS_KEY, sessions);
        res.status(banned.code).json({ error: banned.error });
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
      const banned = await enforceBan(req, session.user);
      if (banned.blocked) {
        delete sessions[tokenValue];
        await kvSet(SESSIONS_KEY, sessions);
        res.status(banned.code).json({ error: banned.error });
        return;
      }
      if (containsBannableContent(text)) {
        const okBan = await applyAutomaticBan(req, session.user);
        if (!okBan) {
          res.status(500).json({ error: "kv_set_failed" });
          return;
        }
        res.status(403).json({ error: "account_banned" });
        return;
      }
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      const post = posts.find(p => p.id === postId);
      if (!post) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const rateKey = commentRateKey(session.user);
      const rateState = (await kvGet(rateKey, { hits: [], cooldownUntil: 0 })) || { hits: [], cooldownUntil: 0 };
      const nowTs = now();
      const cooldownUntil = Number(rateState.cooldownUntil || 0);
      if (cooldownUntil > nowTs) {
        const retryAfterMs = cooldownUntil - nowTs;
        res.status(429);
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
        res.json({ error: "comment_cooldown", retryAfterMs });
        return;
      }
      const recentHits = Array.isArray(rateState.hits)
        ? rateState.hits.map(v => Number(v || 0)).filter(v => Number.isFinite(v) && nowTs - v <= COMMENT_COOLDOWN_MS)
        : [];
      recentHits.push(nowTs);
      let nextCooldownUntil = 0;
      let nextHits = recentHits;
      if (recentHits.length >= COMMENT_BURST_COUNT) {
        nextCooldownUntil = nowTs + COMMENT_COOLDOWN_MS;
        nextHits = [];
      }
      const comment = { id: makeId(), user: session.user, text, ts: now() };
      post.comments = Array.isArray(post.comments) ? post.comments : [];
      post.comments.push(comment);
      const ok = await kvSet(POSTS_KEY, posts);
      const okRate = await kvSet(rateKey, { hits: nextHits, cooldownUntil: nextCooldownUntil });
      if (!ok || !okRate) {
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
    if (req.method === "POST" && action === "admin_wipe_non_admin") {
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
      const adminNames = adminNamesSet();
      const users = (await kvGet(USERS_KEY, {})) || {};
      const keptUsers = {};
      for (const [name, info] of Object.entries(users)) {
        if (adminNames.has(name)) keptUsers[name] = info;
      }
      const keptSessions = {};
      for (const [key, value] of Object.entries(sessions)) {
        if (!value || typeof value !== "object" || !value.user) continue;
        if (value.admin || adminNames.has(value.user)) keptSessions[key] = value;
      }
      const allPosts = (await kvGet(POSTS_KEY, [])) || [];
      const nextPosts = [];
      let deletedPosts = 0;
      if (Array.isArray(allPosts)) {
        for (const post of allPosts) {
          const owner = String(post?.user || "");
          if (!adminNames.has(owner)) {
            deletedPosts++;
            if (isStoredMedia(post.url)) await kvDel(mediaKey(post.id));
            continue;
          }
          post.comments = Array.isArray(post.comments) ? post.comments.filter(c => adminNames.has(String(c?.user || ""))) : [];
          const votes = normalizeVotes(post.votes);
          for (const name of Object.keys(votes)) {
            if (!adminNames.has(name)) delete votes[name];
          }
          const counts = countVotes(votes);
          post.votes = votes;
          post.likes = counts.likes;
          post.dislikes = counts.dislikes;
          nextPosts.push(post);
        }
      }
      const okUsers = await kvSet(USERS_KEY, keptUsers);
      const okSessions = await kvSet(SESSIONS_KEY, keptSessions);
      const okPosts = await kvSet(POSTS_KEY, nextPosts);
      if (!okUsers || !okSessions || !okPosts) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true, keptUsers: Object.keys(keptUsers).length, keptPosts: nextPosts.length, deletedPosts });
      return;
    }
    if (req.method === "POST" && action === "admin_wipe_users_without_posts") {
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
      const posts = (await kvGet(POSTS_KEY, [])) || [];
      const usersWithPosts = new Set(
        Array.isArray(posts) ? posts.map(p => String(p?.user || "").trim()).filter(Boolean) : []
      );
      const removedUsers = [];
      const nextUsers = {};
      for (const [username, info] of Object.entries(users)) {
        if (usersWithPosts.has(username)) {
          nextUsers[username] = info;
        } else {
          removedUsers.push(username);
        }
      }
      if (!removedUsers.length) {
        res.status(200).json({ ok: true, removedUsers: 0, keptUsers: Object.keys(nextUsers).length });
        return;
      }
      const removedSet = new Set(removedUsers);
      const nextSessions = {};
      for (const [key, value] of Object.entries(sessions)) {
        const sessionUser = String(value?.user || "");
        if (sessionUser && removedSet.has(sessionUser)) continue;
        nextSessions[key] = value;
      }
      if (Array.isArray(posts)) {
        posts.forEach(post => {
          if (!post || typeof post !== "object") return;
          if (Array.isArray(post.comments)) {
            post.comments = post.comments.filter(c => !removedSet.has(String(c?.user || "")));
          }
          const votes = normalizeVotes(post.votes);
          for (const name of Object.keys(votes)) {
            if (removedSet.has(name)) delete votes[name];
          }
          const counts = countVotes(votes);
          post.votes = votes;
          post.likes = counts.likes;
          post.dislikes = counts.dislikes;
        });
      }
      const okUsers = await kvSet(USERS_KEY, nextUsers);
      const okSessions = await kvSet(SESSIONS_KEY, nextSessions);
      const okPosts = await kvSet(POSTS_KEY, posts);
      if (!okUsers || !okSessions || !okPosts) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true, removedUsers: removedUsers.length, keptUsers: Object.keys(nextUsers).length });
      return;
    }
    if (req.method === "POST" && action === "admin_ip_ban_user") {
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
        res.status(400).json({ error: "cannot_ban_self" });
        return;
      }
      const users = (await kvGet(USERS_KEY, {})) || {};
      if (!users[username]) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const okBan = await applyAutomaticBan(req, username, { useRequestIp: false });
      if (!okBan) {
        res.status(500).json({ error: "kv_set_failed" });
        return;
      }
      res.status(200).json({ ok: true, bannedUser: username });
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
