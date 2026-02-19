const http = require("http");
const { URL } = require("url");

const SERVERS = [
  { name: "CROW'S ZCITY | EU 1 | OPEN", address: "45.152.160.251:25569" },
  { name: "CROW'S ZCITY | EU 2 | OPEN", address: "45.152.160.251:25648" }
];

const STEAM_API_KEY = process.env.STEAM_API_KEY || "";
const PORT = Number(process.env.PORT || 8787);

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function fetchServer(address) {
  if (!STEAM_API_KEY) {
    return { address, success: false, error: "Missing STEAM_API_KEY" };
  }
  const filter = `\\appid\\4000\\addr\\${address}`;
  const response = await fetch(
    `https://api.steampowered.com/IGameServersService/GetServerList/v1/?key=${encodeURIComponent(
      STEAM_API_KEY
    )}&filter=${encodeURIComponent(filter)}`
  );
  const data = await response.json();
  const server = data?.response?.servers?.[0];
  if (!server) {
    return { address, success: false, error: "No server data found" };
  }
  return {
    address,
    name: server.name || address,
    players: server.players ?? null,
    max_players: server.max_players ?? null,
    map: server.map || null,
    success: true
  };
}

const server = http.createServer(async (req, res) => {
  withCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/status") {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const results = await Promise.all(
      SERVERS.map((serverInfo) => fetchServer(serverInfo.address))
    );
    const payload = {
      servers: results.map((result, index) => ({
        ...result,
        name: result.name || SERVERS[index].name
      }))
    };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Server error" }));
  }
});

server.listen(PORT, () => {
  console.log(`Status server running on http://localhost:${PORT}/status`);
});
