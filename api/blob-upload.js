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
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(500).json({ error: "missing_blob_token" });
    return;
  }
  return handleUpload({
    req,
    res,
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
      const originHeader = req.headers.origin;
      const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
      const proto = req.headers["x-forwarded-proto"] || "https";
      const baseUrl = originHeader || `${proto}://${host}`;
      const sessionUrl = `${baseUrl}/api/caw-board?action=session`;
      const sessionResp = await fetch(sessionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenValue })
      });
      if (!sessionResp.ok) {
        throw new Error("unauthorized");
      }
      const sessionData = await sessionResp.json();
      if (!sessionData?.user) {
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
