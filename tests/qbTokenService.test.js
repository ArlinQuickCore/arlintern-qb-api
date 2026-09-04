import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import axios from "axios";
import { mock } from "node:test";
import qbTokenService from "../services/qbTokenService.js";
import qbApiService from "../services/qbApiService.js";

const tokenDir = path.resolve("data");
const tokenFile = path.join(tokenDir, "qb_tokens.json");

test("exposes QuickBooks billing resource support", () => {
  assert.equal(typeof qbApiService.getBillings, "function");
  assert.equal(typeof qbApiService.createBilling, "function");
});

test("builds a paid billing query with selected columns", async () => {
  const getTokensMock = mock.method(qbTokenService, "getTokens", () => ({
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    realmId: "1234567890"
  }));
  const axiosGetMock = mock.method(axios, "get", async (url) => ({
    data: { url, QueryResponse: { Bill: [] } }
  }));

  try {
    const result = await qbApiService.getBillings({
      paidOnly: true,
      columns: ["Id", "VendorRef", "TotalAmt"]
    });

    assert.match(result.url, /query\?query=select%20Id%2C%20VendorRef%2C%20TotalAmt%20from%20Bill%20where%20Balance%20%3D%20'0'/);
  } finally {
    getTokensMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("persists tokens to disk and loads them back", () => {
  fs.rmSync(tokenDir, { recursive: true, force: true });

  const saved = qbTokenService.saveTokens({
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    realmId: "1234567890"
  });

  assert.deepEqual(saved, {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    realmId: "1234567890"
  });

  const raw = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
  assert.deepEqual(raw, {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    realmId: "1234567890"
  });

  const loaded = qbTokenService.loadTokens();
  assert.deepEqual(loaded, {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    realmId: "1234567890"
  });
});

test("refreshes expired tokens and retries the request once", async () => {
  const getTokensMock = mock.method(qbTokenService, "getTokens", () => ({
    access_token: "expired-token",
    refresh_token: "refresh-token",
    realmId: "1234567890"
  }));

  const refreshMock = mock.method(qbTokenService, "refreshAccessToken", async () => {
    qbTokenService.saveTokens({
      access_token: "fresh-token",
      refresh_token: "new-refresh-token",
      realmId: "1234567890"
    });

    return qbTokenService.getTokens();
  });

  let requestCount = 0;
  const axiosGetMock = mock.method(axios, "get", async () => {
    requestCount += 1;

    if (requestCount === 1) {
      const error = new Error("Unauthorized");
      error.response = {
        status: 401,
        data: { error: "invalid_grant" }
      };
      throw error;
    }

    return {
      data: {
        QueryResponse: {
          Customer: [{ Id: "1", DisplayName: "Acme" }]
        }
      }
    };
  });

  try {
    const result = await qbApiService.getCustomers();

    assert.deepEqual(result.QueryResponse.Customer, [{ Id: "1", DisplayName: "Acme" }]);
    assert.equal(requestCount, 2);
    assert.equal(refreshMock.mock.callCount(), 1);
  } finally {
    getTokensMock.mock.restore();
    refreshMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("clears stored tokens when QuickBooks rejects an invalid refresh token", async () => {
  qbTokenService.saveTokens({
    access_token: "stale-token",
    refresh_token: "expired-refresh-token",
    realmId: "1234567890"
  });

  const axiosPostMock = mock.method(axios, "post", async () => {
    const error = new Error("Bad Refresh Token");
    error.response = {
      status: 400,
      data: {
        error: "invalid_grant",
        error_description: "Incorrect or invalid refresh token"
      }
    };
    throw error;
  });

  try {
    await assert.rejects(
      () => qbTokenService.refreshAccessToken(),
      /re-authorize the app/i
    );

    const tokens = qbTokenService.getTokens();
    assert.deepEqual(tokens, {
      access_token: null,
      refresh_token: null,
      realmId: null
    });
  } finally {
    axiosPostMock.mock.restore();
  }
});
