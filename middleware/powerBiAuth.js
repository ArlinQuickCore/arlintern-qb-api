import crypto from "node:crypto";

function powerBiAuth(req, res, next) {
  const expectedKey = process.env.POWERBI_API_KEY;

  if (!expectedKey) {
    return res.status(500).json({
      error: "Power BI API authentication is not configured. Set POWERBI_API_KEY."
    });
  }

  const authorization = req.get("authorization") || "";
  const [scheme, suppliedKey] = authorization.split(" ");
  const expectedBuffer = Buffer.from(expectedKey);
  const suppliedBuffer = Buffer.from(suppliedKey || "");
  const validKey = expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);

  if (scheme?.toLowerCase() !== "bearer" || !validKey) {
    return res.status(401).json({ error: "Invalid or missing API key." });
  }

  return next();
}

export default powerBiAuth;