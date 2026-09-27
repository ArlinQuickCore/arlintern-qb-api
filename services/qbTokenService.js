import axios from "axios";
import fs from "fs";
import path from "path";
import qs from "qs";
import qbStorageService from "./qbStorageService.js";

const TOKEN_STORAGE_PATH = path.resolve(process.cwd(), "data", "qb_tokens.json");

const defaultTokens = {
  access_token: null,
  refresh_token: null,
  realmId: null
};

const getClientId = () => process.env.CLIENT_ID || process.env.QB_CLIENT_ID;
const getClientSecret = () => process.env.CLIENT_SECRET || process.env.QB_CLIENT_SECRET;
const getRedirectUri = () => process.env.REDIRECT_URI || process.env.QB_REDIRECT_URI;
const getEnvironmentToken = (name, fallback) => process.env[name] || fallback;

const ensureTokenStorage = () => {
  const tokenDir = path.dirname(TOKEN_STORAGE_PATH);

  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir, { recursive: true });
  }

  if (!fs.existsSync(TOKEN_STORAGE_PATH)) {
    fs.writeFileSync(TOKEN_STORAGE_PATH, JSON.stringify(defaultTokens, null, 2));
  }
};

const loadTokensFromFile = () => {
  try {
    ensureTokenStorage();
    const raw = fs.readFileSync(TOKEN_STORAGE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    return { ...defaultTokens, ...parsed };
  } catch (error) {
    console.warn("Unable to read stored QB tokens:", error.message);
    return { ...defaultTokens };
  }
};

let storedTokens = loadTokensFromFile();

const qbTokenService = {
  // Vercel KV is the source of truth in serverless deployments so refreshed
  // tokens survive across Lambda instances; local dev keeps using the JSON file.
  async loadTokens() {
    if (qbStorageService.isConfigured()) {
      const kvTokens = await qbStorageService.getTokens();

      if (kvTokens) {
        storedTokens = { ...defaultTokens, ...kvTokens };
        return storedTokens;
      }

      // One-time migration path for existing env-var based deployments.
      const seeded = {
        access_token: getEnvironmentToken("QB_ACCESS_TOKEN", null),
        refresh_token: getEnvironmentToken("QB_REFRESH_TOKEN", null),
        realmId: getEnvironmentToken("QB_REALM_ID", null)
      };

      storedTokens = { ...defaultTokens, ...seeded };

      if (storedTokens.access_token || storedTokens.refresh_token) {
        await qbStorageService.saveTokens(storedTokens);
      }

      return storedTokens;
    }

    storedTokens = loadTokensFromFile();
    return storedTokens;
  },

  async saveTokens(nextTokens) {
    storedTokens = {
      ...defaultTokens,
      ...nextTokens
    };

    if (qbStorageService.isConfigured()) {
      await qbStorageService.saveTokens(storedTokens);
    } else {
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

  // De-dupes concurrent refresh calls within this process; combined with the
  // distributed lock below, this stops Power BI's parallel requests from each
  // racing to use the same single-use, rotating QuickBooks refresh token.
  _refreshPromise: null,

  async refreshAccessToken() {
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = this._doRefreshAccessToken();

    try {
      return await this._refreshPromise;
    } finally {
      this._refreshPromise = null;
    }
  },

  async _waitForConcurrentRefresh(staleRefreshToken) {
    const attempts = 10;
    const delayMs = 500;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const latestTokens = await this.getTokens();

      if (latestTokens.refresh_token && latestTokens.refresh_token !== staleRefreshToken) {
        return latestTokens;
      }

      if (!latestTokens.access_token && !latestTokens.refresh_token) {
        throw new Error("QuickBooks refresh token is invalid. Re-authorize the app.");
      }
    }

    throw new Error("Timed out waiting for an in-progress QuickBooks token refresh.");
  },

  async _doRefreshAccessToken() {
    const currentTokens = await this.getTokens();

    if (!currentTokens.refresh_token) {
      throw new Error("No refresh token available. Re-authorize the app.");
    }

    const lockToken = await qbStorageService.acquireRefreshLock();

    if (!lockToken) {
      return this._waitForConcurrentRefresh(currentTokens.refresh_token);
    }

    try {
      // Another request may have refreshed while we were waiting for the lock.
      const latestTokens = await this.getTokens();

      if (latestTokens.refresh_token !== currentTokens.refresh_token) {
        return latestTokens;
      }

      const url = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

      const authHeader = Buffer.from(
        `${getClientId()}:${getClientSecret()}`
      ).toString("base64");

      const payload = qs.stringify({
        grant_type: "refresh_token",
        refresh_token: latestTokens.refresh_token
      });

      console.log("QB refresh request", {
        redirect_uri: getRedirectUri(),
        grant_type: "refresh_token",
        hasRefreshToken: Boolean(latestTokens.refresh_token)
      });

      try {
        const response = await axios.post(url, payload, {
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/x-www-form-urlencoded"
          }
        });

        const refreshedTokens = {
          ...latestTokens,
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token || latestTokens.refresh_token
        };

        return await this.saveTokens(refreshedTokens);
      } catch (error) {
        const errorData = error.response?.data || {};
        const isInvalidRefreshToken =
          errorData.error === "invalid_grant" ||
          /incorrect or invalid refresh token/i.test(errorData.error_description || "") ||
          /invalid refresh token/i.test(error.message || "");

        if (isInvalidRefreshToken) {
          // Another request may have already rotated this token successfully.
          const recheckedTokens = await this.getTokens();
          if (recheckedTokens.refresh_token && recheckedTokens.refresh_token !== latestTokens.refresh_token) {
            return recheckedTokens;
          }

          await this.saveTokens({
            access_token: null,
            refresh_token: null,
            realmId: null
          });

          throw new Error("QuickBooks refresh token is invalid. Re-authorize the app.");
        }

        throw error;
      }
    } finally {
      await qbStorageService.releaseRefreshLock(lockToken);
    }
  },

  async clearTokens() {
    return this.saveTokens({
      access_token: null,
      refresh_token: null,
      realmId: null
    });
  },

  async getTokens() {
    return this.loadTokens();
  }
};

export default qbTokenService;

