import test from "node:test";
import assert from "node:assert/strict";
import powerBiAuth from "../middleware/powerBiAuth.js";

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

const makeRequest = (authorization) => ({
  get(name) {
    return name.toLowerCase() === "authorization" ? authorization : undefined;
  }
});

test("requires the configured Power BI bearer key", () => {
  process.env.POWERBI_API_KEY = "test-power-bi-key";
  const res = makeResponse();
  let nextCalled = false;

  powerBiAuth(makeRequest("Bearer test-power-bi-key"), res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("rejects an invalid Power BI bearer key", () => {
  process.env.POWERBI_API_KEY = "test-power-bi-key";
  const res = makeResponse();

  powerBiAuth(makeRequest("Bearer wrong-key"), res, () => {});

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Invalid or missing API key.");
});