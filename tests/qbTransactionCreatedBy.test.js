import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import app from "../server.js";
import qbApiService from "../services/qbApiService.js";
import qbTokenService from "../services/qbTokenService.js";

const tokens = { access_token: "test-token", realmId: "test-realm" };

function report(type = "Invoice") {
  return {
    Columns: {
      Column: ["Date", "Transaction Type", "Num", "Created By"]
        .map((ColTitle) => ({ ColTitle }))
    },
    Rows: {
      Row: [{
        ColData: [
          { value: "2026-01-01" },
          { value: type, id: "42" },
          { value: "123" },
          { value: "Creator" }
        ]
      }]
    }
  };
}

test("requests created by from the transaction report and returns its response", async (t) => {
  t.mock.method(qbTokenService, "getTokens", async () => tokens);
  const expected = report();
  const get = t.mock.method(axios, "get", async () => ({ data: expected }));

  assert.deepEqual(await qbApiService.getTransactionCreatedBy(), expected);
  const url = new URL(get.mock.calls[0].arguments[0]);
  assert.match(url.pathname, /\/reports\/TransactionList$/);
  assert.equal(url.searchParams.get("columns"), "tx_date,txn_type,doc_num,create_by");
  assert.equal(url.searchParams.has("transaction_type"), false);
});

test("applies filters and combines reports for multiple transaction types", async (t) => {
  t.mock.method(qbTokenService, "getTokens", async () => tokens);
  const get = t.mock.method(axios, "get", async (url) => ({
    data: report(new URL(url).searchParams.get("transaction_type"))
  }));
  const result = await qbApiService.getTransactionCreatedBy({
    transactionTypes: ["Invoice", "Bill"],
    startDate: "2026-01-01",
    endDate: "2026-01-31"
  });

  assert.equal(get.mock.calls.length, 2);
  for (const call of get.mock.calls) {
    const params = new URL(call.arguments[0]).searchParams;
    assert.equal(params.get("columns"), "tx_date,txn_type,doc_num,create_by");
    assert.equal(params.get("start_date"), "2026-01-01");
    assert.equal(params.get("end_date"), "2026-01-31");
  }
  assert.deepEqual(result.Rows.Row.map((row) => row.ColData[1].value), ["Invoice", "Bill"]);
});

test("does not alter the existing transaction report request", async (t) => {
  t.mock.method(qbTokenService, "getTokens", async () => tokens);
  const get = t.mock.method(axios, "get", async () => ({ data: report() }));
  await qbApiService.getTransactions();
  assert.equal(new URL(get.mock.calls[0].arguments[0]).searchParams.has("columns"), false);
});

test("reports missing QuickBooks credentials rather than an empty success", async (t) => {
  t.mock.method(qbTokenService, "getTokens", async () => ({}));
  await assert.rejects(qbApiService.getTransactionCreatedBy(), /No QuickBooks token or realm/);
});

test("reports a rejected QuickBooks token rather than an empty success", async (t) => {
  t.mock.method(qbTokenService, "getTokens", async () => tokens);
  t.mock.method(qbTokenService, "refreshAccessToken", async () => {
    throw new Error("refresh failed");
  });
  t.mock.method(axios, "get", async () => {
    const error = new Error("unauthorized");
    error.response = { status: 401 };
    throw error;
  });
  await assert.rejects(qbApiService.getTransactionCreatedBy(), /QuickBooks rejected the stored token/);
});

test("validates transaction types and dates", async () => {
  await assert.rejects(
    qbApiService.getTransactionCreatedBy({ transactionTypes: ["Unknown"] }),
    /Invalid transaction type/
  );
  await assert.rejects(
    qbApiService.getTransactionCreatedBy({ startDate: "01-01-2026" }),
    /startDate must use YYYY-MM-DD/
  );
});

test("serves the separate created-by endpoint", async (t) => {
  const previousKey = process.env.POWERBI_API_KEY;
  process.env.POWERBI_API_KEY = "test-key";
  t.after(() => {
    if (previousKey === undefined) delete process.env.POWERBI_API_KEY;
    else process.env.POWERBI_API_KEY = previousKey;
  });
  t.mock.method(qbTokenService, "getTokens", async () => tokens);
  const get = t.mock.method(axios, "get", async () => ({ data: report() }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/transactions/created-by?transactionTypes=Invoice&startDate=2026-01-01`;
  const unauthorized = await fetch(url);
  assert.equal(unauthorized.status, 401);
  assert.equal(get.mock.calls.length, 0);
  const response = await fetch(url, { headers: { "X-API-Key": "test-key" } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), report());
  const params = new URL(get.mock.calls[0].arguments[0]).searchParams;
  assert.equal(params.get("transaction_type"), "Invoice");
  assert.equal(params.get("start_date"), "2026-01-01");
});
