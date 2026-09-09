import qbTokenService from "../services/qbTokenService.js";

const getClientId = () => process.env.CLIENT_ID || process.env.QB_CLIENT_ID;
const getRedirectUri = () => process.env.REDIRECT_URI || process.env.QB_REDIRECT_URI;

const buildAuthorizationUrl = () => {
  const authUrl = new URL("https://appcenter.intuit.com/connect/oauth2");

  authUrl.searchParams.set("client_id", getClientId());
  authUrl.searchParams.set("redirect_uri", getRedirectUri());
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "scope",
    "com.intuit.quickbooks.accounting openid profile email phone address"
  );
  authUrl.searchParams.set("state", "quickbooks-oauth-node");

  return authUrl.toString();
};

const qbAuthController = {
  buildAuthorizationUrl,

  async login(req, res) {
    if (!getClientId() || !getRedirectUri()) {
      return res.status(500).json({
        error: "QuickBooks OAuth is not configured. Set CLIENT_ID and REDIRECT_URI in the environment."
      });
    }

    return res.redirect(buildAuthorizationUrl());
  },

  async handleCallback(req, res) {
    try {
      const { code, realmId } = req.query;

      if (!code) {
        return res.status(400).send("Missing authorization code");
      }

      const tokenResponse = await qbTokenService.exchangeCodeForTokens(code, realmId);

      return res.json({
        message: "Tokens generated successfully",
        tokens: tokenResponse
      });

    } catch (error) {
      console.error("Callback Error:", error.response?.data || error.message);
      res.status(500).send("Error generating tokens");
    }
  },

  async getStoredTokens(req, res) {
    try {
      const tokens = qbTokenService.getTokens();

      return res.status(200).json({
        message: "Stored tokens retrieved successfully",
        tokens
      });
    } catch (error) {
      console.error("Get Stored Tokens Error:", error.message);
      return res.status(500).send("Error retrieving stored tokens");
    }
  }
};

export default qbAuthController;
