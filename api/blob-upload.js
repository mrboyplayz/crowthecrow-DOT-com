import { handleUpload } from "@vercel/blob/client";

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
      const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
      const proto = req.headers["x-forwarded-proto"] || "https";
      const sessionUrl = `${proto}://${host}/api/caw-board?action=session`;
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
