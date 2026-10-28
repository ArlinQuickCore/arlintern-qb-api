import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { mock } from "node:test";
import qbTokenService from "../services/qbTokenService.js";
import qbApiService from "../services/qbApiService.js";
import qbStorageService from "../services/qbStorageService.js";

// Tests must never touch real Redis even if KV/Upstash env vars happen to be
// present (e.g. a Vercel build machine); force the local file-based path.
mock.method(qbStorageService, "isConfigured", () => false);

function mockTokens() {
  return mock.method(qbTokenService, "getTokens", () => ({
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    realmId: "1234567890"
  }));
}

test("exposes QuickBooks transaction details support", () => {
  assert.equal(typeof qbApiService.getTransactionDetails, "function");
});

test("queries every transaction entity with all columns", async () => {
  const getTokensMock = mockTokens();
  const requestedUrls = [];
  const axiosGetMock = mock.method(axios, "get", async (url) => {
    requestedUrls.push(url);
    return { data: { url, QueryResponse: {} } };
  });

  try {
    const result = await qbApiService.getTransactionDetails({
      startDate: "2026-08-01",
      endDate: "2026-08-31"
    });

    const entities = ["Invoice", "Payment", "Bill", "BillPayment", "Purchase",
      "CreditMemo", "RefundReceipt", "SalesReceipt", "Estimate", "Deposit",
      "Transfer", "JournalEntry", "VendorCredit", "PurchaseOrder", "TimeActivity"];

    assert.equal(requestedUrls.length, entities.length);
    for (const entity of entities) {
      assert.ok(
        requestedUrls.some((url) => url.includes(`select%20*%20from%20${entity}`)),
        `expected a select * query for ${entity}`
      );
    }
    assert.match(requestedUrls[0], /TxnDate%20%3E%3D%20'2026-08-01'%20and%20TxnDate%20%3C%3D%20'2026-08-31'/);
    assert.equal(result.count, 0);
    assert.equal(result.capped, false);
    assert.deepEqual(result.transactions, []);
  } finally {
    getTokensMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("fans out per requested type and merges full entity rows", async () => {
  const getTokensMock = mockTokens();
  const axiosGetMock = mock.method(axios, "get", async (url) => {
    if (url.includes("from%20Invoice")) {
      return {
        data: {
          url,
          QueryResponse: {
            Invoice: [{ Id: "1", DocNumber: "IN92468", TotalAmt: 10802.82, Line: [{ Id: "1" }] }]
          }
        }
      };
    }

    if (url.includes("from%20CreditMemo")) {
      return {
        data: {
          url,
          QueryResponse: {
            CreditMemo: [{ Id: "2", DocNumber: "IN92468", Balance: 0 }]
          }
        }
      };
    }

    return { data: { url, QueryResponse: {} } };
  });

  try {
    const result = await qbApiService.getTransactionDetails({
      transactionTypes: ["Invoice", "CreditMemo"]
    });

    assert.equal(result.count, 2);
    assert.deepEqual(result.byType, { Invoice: 1, CreditMemo: 1 });
    assert.equal(result.transactions[0].transactionType, "Invoice");
    assert.equal(result.transactions[0].DocNumber, "IN92468");
    assert.deepEqual(result.transactions[0].Line, [{ Id: "1" }]);
    assert.equal(result.transactions[1].transactionType, "CreditMemo");
  } finally {
    getTokensMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("maps report type aliases to their queryable entity", async () => {
  const getTokensMock = mockTokens();
  const requestedUrls = [];
  const axiosGetMock = mock.method(axios, "get", async (url) => {
    requestedUrls.push(url);
    return { data: { url, QueryResponse: {} } };
  });

  try {
    await qbApiService.getTransactionDetails({ transactionTypes: ["ReceivePayment", "Check"] });

    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls.some((url) => url.includes("from%20Payment")));
    assert.ok(requestedUrls.some((url) => url.includes("from%20Purchase")));
  } finally {
    getTokensMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("rejects unsupported transaction types for details", async () => {
  await assert.rejects(
    () => qbApiService.getTransactionDetails({ transactionTypes: ["Statement"] }),
    /Unsupported transaction type for details: Statement/
  );
});

test("rejects invalid transaction detail date filters", async () => {
  await assert.rejects(
    () => qbApiService.getTransactionDetails({ endDate: "2026/08/31" }),
    /endDate must use YYYY-MM-DD format/
  );
});
