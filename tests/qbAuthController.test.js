import test from "node:test";
import assert from "node:assert/strict";
import qbAuthController from "../controllers/qbAuthController.js";

const makeResponse = () => ({
  statusCode: 200,
  jsonBody: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.jsonBody = body;
    return this;
  },
  send(body) {
    this.body = body;
    return this;
  }
});

test("returns stored QuickBooks tokens", async () => {
  const res = makeResponse();

  await qbAuthController.getStoredTokens({}, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.jsonBody && res.jsonBody.tokens);
  assert.ok("access_token" in res.jsonBody.tokens);
});

test("builds the QuickBooks OAuth login URL with the configured redirect URI", () => {
  process.env.CLIENT_ID = "test-client-id";
  process.env.REDIRECT_URI = "https://example.com/oauth/callback";

  const url = qbAuthController.buildAuthorizationUrl();

  assert.ok(url.startsWith("https://appcenter.intuit.com/connect/oauth2"));
  assert.match(url, /client_id=test-client-id/);
  assert.match(url, /redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback/);
  assert.match(url, /response_type=code/);
});

test("supports QB-prefixed OAuth environment variables", () => {
  delete process.env.CLIENT_ID;
  delete process.env.REDIRECT_URI;
  process.env.QB_CLIENT_ID = "qb-client-id";
  process.env.QB_REDIRECT_URI = "https://example.com/qb-callback";

  const url = qbAuthController.buildAuthorizationUrl();

  assert.match(url, /client_id=qb-client-id/);
  assert.match(url, /redirect_uri=https%3A%2F%2Fexample.com%2Fqb-callback/);
});
