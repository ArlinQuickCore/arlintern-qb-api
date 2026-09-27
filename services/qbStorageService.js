import crypto from "crypto";
import { Redis } from "@upstash/redis";

const TOKENS_KEY = "qb_tokens";
const REFRESH_LOCK_KEY = "qb_tokens_refresh_lock";

// Support both the legacy Vercel KV env var names and the newer Upstash
// Marketplace integration names so this works with whichever the project has.
const getRestUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const getRestToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const isConfigured = () => Boolean(getRestUrl() && getRestToken());

let redisClient = null;
const getClient = () => {
  if (!redisClient) {
    redisClient = new Redis({ url: getRestUrl(), token: getRestToken() });
  }

  return redisClient;
};

const qbStorageService = {
  isConfigured,

  async getTokens() {
    if (!isConfigured()) {
      return null;
    }

    return (await getClient().get(TOKENS_KEY)) || null;
  },

  async saveTokens(tokens) {
    if (!isConfigured()) {
      return tokens;
    }

    await getClient().set(TOKENS_KEY, tokens);
    return tokens;
  },

  // Prevents concurrent Power BI requests from racing to refresh with the
  // same (single-use, rotating) QuickBooks refresh token.
  async acquireRefreshLock(ttlMs = 15000) {
    if (!isConfigured()) {
      return "no-lock";
    }

    const lockToken = crypto.randomUUID();
    const acquired = await getClient().set(REFRESH_LOCK_KEY, lockToken, { nx: true, px: ttlMs });
    return acquired ? lockToken : null;
  },

  async releaseRefreshLock(lockToken) {
    if (!isConfigured() || !lockToken || lockToken === "no-lock") {
      return;
    }

    const current = await getClient().get(REFRESH_LOCK_KEY);
    if (current === lockToken) {
      await getClient().del(REFRESH_LOCK_KEY);
    }
  }
};

export default qbStorageService;


