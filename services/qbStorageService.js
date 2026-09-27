import { Redis } from "@upstash/redis";

const TOKENS_KEY = "qb_tokens";

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
  }
};

export default qbStorageService;


