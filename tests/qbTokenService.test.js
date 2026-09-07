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
  let requestCount = 0;
  const axiosGetMock = mock.method(axios, "get", async (url) => {
    requestCount += 1;
    if (url.includes("/bill/")) {
      return {
        data: {
          Bill: {
            Id: "1",
            CustomField: [
              { DefinitionId: "10", Name: "Customer PO#", StringValue: "CPO-100" },
              { DefinitionId: "20", Name: "Supplier PO#", StringValue: "SPO-200" },
              { DefinitionId: "30", Name: "Vendor Type", StringValue: "PO Vendor" }
            ]
          }
        }
      };
    }

    return {
      data: {
        url,
        QueryResponse: {
          Bill: requestCount === 1
            ? Array.from({ length: 1000 }, (_, index) => ({ Id: String(index + 1) }))
            : [{ Id: "1001" }]
        }
      }
    };
  });

  try {
    const result = await qbApiService.getBillings({
      status: "paid",
      columns: ["Id", "VendorRef", "TotalAmt", "CustomField"],
      startDate: "2025-01-01",
      endDate: "2025-12-31"
    });

    assert.equal(result.QueryResponse.Bill.length, 1001);
    assert.equal(requestCount, 1003);
    assert.match(result.QueryResponse.Bill[0].Id, /^1$/);
    assert.match(axiosGetMock.mock.calls[0].arguments[0], /select%20\*%20from%20Bill/);
    assert.match(axiosGetMock.mock.calls[0].arguments[0], /TxnDate%20%3E%3D%20'2025-01-01'%20and%20TxnDate%20%3C%3D%20'2025-12-31'/);
    assert.match(axiosGetMock.mock.calls[0].arguments[0], /startposition%201%20maxresults%201000/);
    assert.match(axiosGetMock.mock.calls[1].arguments[0], /startposition%201001%20maxresults%201000/);
    assert.equal(result.QueryResponse.Bill[0]["Customer PO#"], "CPO-100");
    assert.equal(result.QueryResponse.Bill[0]["Supplier PO#"], "SPO-200");
    assert.equal(result.QueryResponse.Bill[0]["Vendor Type"], "PO Vendor");
  } finally {
    getTokensMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("rejects invalid billing date filters", async () => {
  await assert.rejects(
    () => qbApiService.getBillings({ startDate: "01-01-2025" }),
    /startDate must use YYYY-MM-DD format/
  );
});

test("builds an unpaid billing query", async () => {
  const getTokensMock = mock.method(qbTokenService, "getTokens", () => ({
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    realmId: "1234567890"
  }));
  const axiosGetMock = mock.method(axios, "get", async (url) => ({
    data: { url, QueryResponse: { Bill: [] } }
  }));

  try {
    await qbApiService.getBillings({ status: "unpaid", columns: ["Id", "Balance"] });
    assert.match(axiosGetMock.mock.calls[0].arguments[0], /Balance%20%3E%20'0'/);
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
