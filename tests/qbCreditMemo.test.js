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

const refundedCreditMemo = {
  Id: "145",
  DocNumber: "IN92468",
  TxnDate: "2026-08-12",
  CustomerRef: { value: "34", name: "Oshkosh Truck Corporation" },
  Balance: 0,
  TotalAmt: 10802.82,
  PrivateNote: "Refund for invoice IN92468",
  MetaData: { LastUpdatedTime: "2026-08-13T17:30:15.842202Z" },
  LinkedTxn: [{ TxnId: "100", TxnType: "RefundReceipt" }]
};

const openCreditMemo = {
  Id: "146",
  DocNumber: "IN92500",
  TxnDate: "2026-08-15",
  CustomerRef: { value: "35", name: "Acme Corp" },
  Balance: 500,
  TotalAmt: 500
};

const appliedCreditMemo = {
  Id: "147",
  DocNumber: "IN92501",
  TxnDate: "2026-08-16",
  CustomerRef: { value: "35", name: "Acme Corp" },
  Balance: 0,
  TotalAmt: 250,
  LinkedTxn: [{ TxnId: "99", TxnType: "Payment" }]
};

function mockTokens() {
  return mock.method(qbTokenService, "getTokens", () => ({
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    realmId: "1234567890"
  }));
}

test("exposes QuickBooks credit memo resource support", () => {
  assert.equal(typeof qbApiService.getCreditMemos, "function");
});

test("returns credit memo table details when the refund is received", async () => {
  const getTokensMock = mockTokens();
  const axiosGetMock = mock.method(axios, "get", async (url) => ({
    data: {
      url,
      QueryResponse: {
        CreditMemo: [refundedCreditMemo, openCreditMemo, appliedCreditMemo]
      }
    }
  }));

  try {
    const result = await qbApiService.getCreditMemos();

    assert.match(axiosGetMock.mock.calls[0].arguments[0], /select%20\*%20from%20CreditMemo/);
    assert.equal(result.count, 2);
    assert.equal(result.creditMemos.length, 2);

    const row = result.creditMemos[0];
    assert.deepEqual(row, {
      id: "145",
      date: "2026-08-12",
      type: "Credit memo",
      refNo: "IN92468",
      contact: "Oshkosh Truck Corporation",
      dueDate: null,
      balance: 0,
      totalAmount: 10802.82,
      memo: "Refund for invoice IN92468",
      lastModifiedDate: "2026-08-13T17:30:15.842202Z",
      status: "Refunded",
      refundReceived: true,
      refundTransactionIds: ["100"],
      linkedTransactions: [{ type: "RefundReceipt", id: "100" }]
    });

    const appliedRow = result.creditMemos[1];
    assert.equal(appliedRow.id, "147");
    assert.equal(appliedRow.status, "Closed");
    assert.equal(appliedRow.refundReceived, true);
    assert.deepEqual(appliedRow.refundTransactionIds, []);
    assert.deepEqual(appliedRow.linkedTransactions, [{ type: "Payment", id: "99" }]);
  } finally {
    getTokensMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("builds a credit memo query filtered by reference number and dates", async () => {
  const getTokensMock = mockTokens();
  const axiosGetMock = mock.method(axios, "get", async (url) => ({
    data: { url, QueryResponse: { CreditMemo: [] } }
  }));

  try {
    const result = await qbApiService.getCreditMemos({
      docNumber: "IN92468",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      status: "all"
    });

    const requestUrl = axiosGetMock.mock.calls[0].arguments[0];
    assert.match(requestUrl, /select%20\*%20from%20CreditMemo/);
    assert.match(requestUrl, /TxnDate%20%3E%3D%20'2026-08-01'%20and%20TxnDate%20%3C%3D%20'2026-08-31'/);
    assert.match(requestUrl, /DocNumber%20%3D%20'IN92468'/);
    assert.match(requestUrl, /minorversion=75/);
    assert.equal(result.count, 0);
    assert.deepEqual(result.creditMemos, []);
  } finally {
    getTokensMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("builds an open credit memo query with a balance filter", async () => {
  const getTokensMock = mockTokens();
  const axiosGetMock = mock.method(axios, "get", async (url) => ({
    data: { url, QueryResponse: { CreditMemo: [openCreditMemo] } }
  }));

  try {
    const result = await qbApiService.getCreditMemos({ status: "open" });

    assert.match(axiosGetMock.mock.calls[0].arguments[0], /Balance%20%3E%20'0'/);
    assert.equal(result.count, 1);
    assert.equal(result.creditMemos[0].status, "Open");
    assert.equal(result.creditMemos[0].refundReceived, false);
  } finally {
    getTokensMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("detects refunds from linked checks when full details are requested", async () => {
  const getTokensMock = mockTokens();
  const creditMemoWithoutLinks = { ...refundedCreditMemo, Id: "200", LinkedTxn: undefined };
  const axiosGetMock = mock.method(axios, "get", async (url) => {
    if (url.includes("/creditmemo/200")) {
      return {
        data: {
          CreditMemo: {
            ...creditMemoWithoutLinks,
            LinkedTxn: [{ TxnId: "300", TxnType: "Check" }]
          }
        }
      };
    }

    return { data: { url, QueryResponse: { CreditMemo: [creditMemoWithoutLinks] } } };
  });

  try {
    const result = await qbApiService.getCreditMemos({ docNumber: "IN92468", details: true });

    assert.equal(result.count, 1);
    const row = result.creditMemos[0];
    assert.equal(row.status, "Refunded");
    assert.equal(row.refundReceived, true);
    assert.deepEqual(row.refundTransactionIds, ["300"]);
    assert.deepEqual(row.linkedTransactions, [{ type: "Check", id: "300" }]);
  } finally {
    getTokensMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("rejects details requests for large credit memo result sets", async () => {
  const getTokensMock = mockTokens();
  const axiosGetMock = mock.method(axios, "get", async (url) => ({
    data: {
      url,
      QueryResponse: {
        CreditMemo: Array.from({ length: 101 }, (_, index) => ({ Id: String(index + 1) }))
      }
    }
  }));

  try {
    await assert.rejects(
      () => qbApiService.getCreditMemos({ status: "all", details: true }),
      /Too many credit memos for details/
    );
  } finally {
    getTokensMock.mock.restore();
    axiosGetMock.mock.restore();
  }
});

test("rejects invalid credit memo date filters", async () => {
  await assert.rejects(
    () => qbApiService.getCreditMemos({ startDate: "08-01-2026" }),
    /startDate must use YYYY-MM-DD format/
  );
});

test("rejects invalid credit memo status", async () => {
  await assert.rejects(
    () => qbApiService.getCreditMemos({ status: "paid" }),
    /Invalid credit memo status/
  );
});
