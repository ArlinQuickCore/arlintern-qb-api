import axios from "axios";
import fs from "fs";
import path from "path";
import qs from "qs";

const TOKEN_STORAGE_PATH = path.resolve(process.cwd(), "data", "qb_tokens.json");

const defaultTokens = {
  access_token: null,
  refresh_token: null,
  realmId: null
};

const getClientId = () => process.env.CLIENT_ID || process.env.QB_CLIENT_ID;
const getClientSecret = () => process.env.CLIENT_SECRET || process.env.QB_CLIENT_SECRET;
const getRedirectUri = () => process.env.REDIRECT_URI || process.env.QB_REDIRECT_URI;

const ensureTokenStorage = () => {
  const tokenDir = path.dirname(TOKEN_STORAGE_PATH);

  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir, { recursive: true });
  }

  if (!fs.existsSync(TOKEN_STORAGE_PATH)) {
    fs.writeFileSync(TOKEN_STORAGE_PATH, JSON.stringify(defaultTokens, null, 2));
  }
};

let storedTokens = (() => {
  try {
    ensureTokenStorage();
    const raw = fs.readFileSync(TOKEN_STORAGE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    return {
      ...defaultTokens,
      ...parsed
    };
  } catch (error) {
    console.warn("Could not load persisted QB tokens:", error.message);
    return { ...defaultTokens };
  }
})();

const qbTokenService = {
  loadTokens() {
    if (process.env.VERCEL) {
      return storedTokens;
    }

    try {
      ensureTokenStorage();
      const raw = fs.readFileSync(TOKEN_STORAGE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      storedTokens = { ...defaultTokens, ...parsed };
      return storedTokens;
    } catch (error) {
      console.warn("Unable to read stored QB tokens:", error.message);
      storedTokens = { ...defaultTokens };
      return storedTokens;
    }
  },

  saveTokens(nextTokens) {
    storedTokens = {
      ...defaultTokens,
      ...nextTokens
    };

    if (!process.env.VERCEL) {
      ensureTokenStorage();
      fs.writeFileSync(TOKEN_STORAGE_PATH, JSON.stringify(storedTokens, null, 2));
    }

    return storedTokens;
  },

  async exchangeCodeForTokens(code, realmId) {
    const url = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

    const authHeader = Buffer.from(
      `${getClientId()}:${getClientSecret()}`
    ).toString("base64");

    const payload = qs.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri()
    });

    console.log("QB token exchange request", {
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
      hasCode: Boolean(code),
      realmId
    });

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const nextTokens = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      realmId
    };

    return this.saveTokens(nextTokens);
  },

  async refreshAccessToken() {
    const currentTokens = this.getTokens();

    if (!currentTokens.refresh_token) {
      throw new Error("No refresh token available. Re-authorize the app.");
    }

    const url = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

    const authHeader = Buffer.from(
      `${getClientId()}:${getClientSecret()}`
    ).toString("base64");

    const payload = qs.stringify({
      grant_type: "refresh_token",
      refresh_token: currentTokens.refresh_token
    });

    console.log("QB refresh request", {
      redirect_uri: getRedirectUri(),
      grant_type: "refresh_token",
      hasRefreshToken: Boolean(currentTokens.refresh_token)
    });

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      });

      const refreshedTokens = {
        ...currentTokens,
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token || currentTokens.refresh_token
      };

      return this.saveTokens(refreshedTokens);
    } catch (error) {
      const errorData = error.response?.data || {};
      const isInvalidRefreshToken =
        errorData.error === "invalid_grant" ||
        /incorrect or invalid refresh token/i.test(errorData.error_description || "") ||
        /invalid refresh token/i.test(error.message || "");

      if (isInvalidRefreshToken) {
        this.saveTokens({
          access_token: null,
          refresh_token: null,
          realmId: null
        });

        throw new Error("QuickBooks refresh token is invalid. Re-authorize the app.");
      }

      throw error;
    }
  },

  clearTokens() {
    return this.saveTokens({
      access_token: null,
      refresh_token: null,
      realmId: null
    });
  },

  getTokens() {
    return this.loadTokens();
  }
};

export default qbTokenService;
