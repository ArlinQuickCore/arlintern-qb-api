import crypto from "node:crypto";

function powerBiAuth(req, res, next) {
  const expectedKey = process.env.POWERBI_API_KEY;

  if (!expectedKey) {
    return res.status(500).json({
      error: "Power BI API authentication is not configured. Set POWERBI_API_KEY."
    });
  }

  // Accepts Bearer, X-API-Key, or Basic (key as password) since Power BI's
  // credential dialogs can send any of these.
  const authorization = req.get("authorization") || "";
  const [scheme, credential] = authorization.split(" ");
  let suppliedKey = req.get("x-api-key") || "";

  if (scheme?.toLowerCase() === "bearer") {
    suppliedKey = credential || "";
  } else if (scheme?.toLowerCase() === "basic" && credential) {
    const decoded = Buffer.from(credential, "base64").toString("utf8");
    suppliedKey = decoded.slice(decoded.indexOf(":") + 1);
  }

  const expectedBuffer = Buffer.from(expectedKey);
  const suppliedBuffer = Buffer.from(suppliedKey);
  const validKey = expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);

  if (!validKey) {
    return res.status(401).json({ error: "Invalid or missing API key." });
  }

  return next();
}

export default powerBiAuth;