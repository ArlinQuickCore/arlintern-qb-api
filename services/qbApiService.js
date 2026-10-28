import axios from "axios";
import qbTokenService from "./qbTokenService.js";

const getCompanyUrl = (realmId, resource) =>
  `https://quickbooks.api.intuit.com/v3/company/${realmId}/${resource}`;
const quickBooksRequestConfig = {
  timeout: 20000
};
const quickBooksMinorVersion = process.env.QBO_MINOR_VERSION || "75";

async function retryAfterRefresh(requestFn, label, emptyResponse) {
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      if (error.response?.status === 429 && attempt < 3) {
        const retryAfter = Number(error.response.headers?.["retry-after"]) || 2;
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 10) * 1000));
        continue;
      }

      if (!error.response || error.response.status !== 401) {
        throw error;
      }

      try {
        await qbTokenService.refreshAccessToken();
        return await requestFn();
      } catch (refreshError) {
        if (emptyResponse) {
          return {
            ...emptyResponse,
            status: "unauthorized",
            message: `QuickBooks rejected the stored token while ${label}. Re-run OAuth.`,
            details: refreshError.response?.data || refreshError.message
          };
        }

        return {
          status: "unauthorized",
          message: `QuickBooks rejected the stored token while ${label}. Re-run OAuth.`,
          details: refreshError.response?.data || refreshError.message
        };
      }
    }
  }

  throw new Error(`QuickBooks rate limit exceeded while ${label}. Try again later.`);
}

async function queryResource(resource, label, queryOptions = {}) {
  const { access_token, realmId } = await qbTokenService.getTokens();

  if (!access_token || !realmId) {
    return {
      QueryResponse: { [resource]: [] },
      message: "No QuickBooks token or realm is stored yet. Complete OAuth first."
    };
  }

  const select = queryOptions.columns?.length
    ? queryOptions.columns.join(", ")
    : "*";
  const where = queryOptions.where ? ` where ${queryOptions.where}` : "";
  const pageSize = queryOptions.fetchAll ? 1000 : null;

  const requestPage = async (startPosition = 1) => {
    const pagination = pageSize
      ? ` startposition ${startPosition} maxresults ${pageSize}`
      : "";
    const query = encodeURIComponent(`select ${select} from ${resource}${where}${pagination}`);

    return retryAfterRefresh(async () => {
      const currentTokens = await qbTokenService.getTokens();
      const response = await axios.get(
        getCompanyUrl(
          currentTokens.realmId,
          `query?query=${query}&minorversion=${quickBooksMinorVersion}`
        ),
        {
          ...quickBooksRequestConfig,
          headers: {
            Authorization: `Bearer ${currentTokens.access_token}`,
            Accept: "application/json"
          }
        }
      );

      return response.data;
    }, label, {
      QueryResponse: { [resource]: [] }
    });
  };

  if (queryOptions.fetchAll) {
    const allRows = [];
    let startPosition = 1;
    let response;

    do {
      response = await requestPage(startPosition);
      const rows = response.QueryResponse?.[resource] || [];
      allRows.push(...rows);
      startPosition += pageSize;
    } while ((response.QueryResponse?.[resource] || []).length === pageSize);

    return {
      ...response,
      QueryResponse: {
        ...response.QueryResponse,
        [resource]: allRows
      }
    };
  }

  try {
    return await requestPage();
  } catch (error) {
    return {
      QueryResponse: { [resource]: [] },
      status: "unauthorized",
      message: `QuickBooks rejected the stored token while loading ${label}. Re-run OAuth.`,
      details: error.response?.data || error.message
    };
  }
}

async function createResource(resource, payload, label) {
  const { access_token, realmId } = await qbTokenService.getTokens();

  if (!access_token || !realmId) {
    throw new Error("No QuickBooks token or realm is stored yet. Complete OAuth first.");
  }

  const requestFn = async () => {
    const currentTokens = await qbTokenService.getTokens();
    const response = await axios.post(getCompanyUrl(currentTokens.realmId, resource), payload, {
      headers: {
        Authorization: `Bearer ${currentTokens.access_token}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });

    return response.data;
  };

  try {
    return await retryAfterRefresh(requestFn, label);
  } catch (error) {
    return {
      status: "unauthorized",
      message: `QuickBooks rejected the stored token while creating ${label}. Re-run OAuth.`,
      details: error.response?.data || error.message
    };
  }
}

async function getResourceDetails(resource, responseKey, ids, label) {
  const details = new Map();
  const concurrency = 5;

  for (let index = 0; index < ids.length; index += concurrency) {
    const batch = ids.slice(index, index + concurrency);
    const results = await Promise.all(batch.map((id) => retryAfterRefresh(async () => {
      const currentTokens = await qbTokenService.getTokens();
      const response = await axios.get(
        getCompanyUrl(
          currentTokens.realmId,
          `${resource.toLowerCase()}/${encodeURIComponent(id)}?minorversion=${quickBooksMinorVersion}`
        ),
        {
          ...quickBooksRequestConfig,
          headers: {
            Authorization: `Bearer ${currentTokens.access_token}`,
            Accept: "application/json"
          }
        }
      );

      return response.data?.[responseKey];
    }, label).catch((error) => {
      // One failed detail lookup must not fail the whole list; fall back to the query row.
      console.warn(`Failed ${label} for ${id}:`, error.message);
      return null;
    })));

    results.forEach((detail, resultIndex) => {
      if (detail?.status === "unauthorized") {
        return;
      }

      if (detail?.Id) {
        details.set(String(detail.Id), detail);
      } else if (detail) {
        details.set(String(batch[resultIndex]), detail);
      }
    });
  }

  return details;
}

async function getCustomers() {
  const { access_token, realmId } = await qbTokenService.getTokens();

  if (!access_token || !realmId) {
    return {
      QueryResponse: {
        Customer: []
      },
      message: "No QuickBooks token or realm is stored yet. Complete OAuth first."
    };
  }

  const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=select * from Customer`;

  const requestFn = async () => {
    const currentTokens = await qbTokenService.getTokens();
    const response = await axios.get(
      `https://quickbooks.api.intuit.com/v3/company/${currentTokens.realmId}/query?query=select * from Customer`,
      {
        ...quickBooksRequestConfig,
        headers: {
          Authorization: `Bearer ${currentTokens.access_token}`,
          Accept: "application/json"
        }
      }
    );

    return response.data;
  };

  try {
    return await retryAfterRefresh(requestFn, "loading customers", {
      QueryResponse: {
        Customer: []
      }
    });
  } catch (error) {
    return {
      QueryResponse: {
        Customer: []
      },
      status: "unauthorized",
      message: "QuickBooks rejected the stored token. Re-run OAuth to refresh the access token and realm.",
      details: error.response?.data || error.message
    };
  }
}

const billColumns = new Set([
  "Id",
  "SyncToken",
  "MetaData",
  "CustomField",
  "DocNumber",
  "TxnDate",
  "CurrencyRef",
  "ExchangeRate",
  "PrivateNote",
  "Line",
  "VendorRef",
  "APAccountRef",
  "TermsRef",
  "DueDate",
  "SalesTermRef",
  "LinkedTxn",
  "TotalAmt",
  "HomeTotalAmt",
  "Balance",
  "Memo",
  "TxnTaxDetail"
]);

const billingCustomColumnAliases = {
  "Customer PO#": process.env.CUSTOMER_PO_FIELD_ID || "1",
  "Supplier PO#": process.env.SUPPLIER_PO_FIELD_ID || "2"
};

const billingColumnAliases = {
  "Customer PO#": "CustomField",
  "Supplier PO#": "CustomField",
  "Vendor Type": "CustomField",
  PHASE: "Line.CustomField"
};

function getCustomFieldValue(customFields, definitionId, fieldName) {
  const field = customFields?.find(
    (field) =>
      String(field.DefinitionId) === String(definitionId) ||
      field.Name?.trim().toLowerCase() === fieldName.toLowerCase()
  );

  if (!field) {
    return null;
  }

  return field.StringValue ?? field.NumberValue ?? field.BooleanValue ?? field.DateValue ?? null;
}

function addBillingColumnAliases(bill, billDetails = new Map()) {
  const detail = billDetails.get(String(bill.Id)) || bill;
  const customFields = detail.CustomField || bill.CustomField;
  const phaseFieldId = process.env.LINE_PHASE_FIELD_ID || "4";

  const lines = (detail.Line || bill.Line || []).map((line) => ({
    ...line,
    PHASE: getCustomFieldValue(line.CustomField, phaseFieldId, "PHASE")
  }));

  return {
    ...detail,
    Line: lines,
    "Customer PO#": getCustomFieldValue(
      customFields,
      billingCustomColumnAliases["Customer PO#"],
      "Customer PO#"
    ),
    "Supplier PO#": getCustomFieldValue(
      customFields,
      billingCustomColumnAliases["Supplier PO#"],
      "Supplier PO#"
    ),
    "Vendor Type": getCustomFieldValue(
      customFields,
      process.env.VENDOR_TYPE_FIELD_ID || "3",
      "Vendor Type"
    )
  };
}

function addBillingDetails(response, billDetails) {
  const bills = response.QueryResponse?.Bill;

  if (!Array.isArray(bills)) {
    return response;
  }

  return {
    ...response,
    QueryResponse: {
      ...response.QueryResponse,
      Bill: bills.map((bill) => addBillingColumnAliases(bill, billDetails))
    }
  };
}

async function getBillings(options = {}) {
  const requestedColumns = options.columns?.length
    ? options.columns
    : null;
  const hasAliasColumn = requestedColumns?.some(
    (column) => billingColumnAliases[column] || column === "CustomField"
  );
  const columns = requestedColumns && !hasAliasColumn
    ? [...new Set(requestedColumns)]
    : null;

  if (requestedColumns && requestedColumns.some((column) => !billColumns.has(column) && !billingColumnAliases[column])) {
    throw new Error("Invalid billing column. Use valid QuickBooks Bill fields.");
  }

  const status = options.status || (options.paidOnly ? "paid" : "all");
  const whereByStatus = {
    paid: "Balance = '0'",
    unpaid: "Balance > '0'",
    all: undefined
  };

  if (!(status in whereByStatus)) {
    throw new Error("Invalid billing status. Use paid, unpaid, or all.");
  }

  const dateFilters = [];
  for (const [name, value, operator] of [
    ["startDate", options.startDate, ">="],
    ["endDate", options.endDate, "<="]
  ]) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`${name} must use YYYY-MM-DD format.`);
    }

    if (value) {
      dateFilters.push(`TxnDate ${operator} '${value}'`);
    }
  }

  const filters = [whereByStatus[status], ...dateFilters].filter(Boolean);

  const response = await queryResource("Bill", "billing", {
    columns,
    where: filters.length ? filters.join(" and ") : undefined,
    fetchAll: true
  });

  const billDetails = requestedColumns?.some(
    (column) => billingColumnAliases[column] || column === "CustomField"
  )
    ? await getResourceDetails(
      "Bill",
      "Bill",
      (response.QueryResponse?.Bill || []).map((bill) => bill.Id).filter(Boolean),
      "billing details"
    )
    : new Map();

  return addBillingDetails(response, billDetails);
}

async function createBilling(payload) {
  return createResource("bill", payload, "billing");
}

const invoiceColumns = new Set([
  "Id",
  "SyncToken",
  "MetaData",
  "CustomField",
  "DocNumber",
  "TxnDate",
  "CurrencyRef",
  "ExchangeRate",
  "PrivateNote",
  "Line",
  "CustomerRef",
  "CustomerMemo",
  "BillEmail",
  "BillAddr",
  "ShipAddr",
  "SalesTermRef",
  "DueDate",
  "LinkedTxn",
  "TotalAmt",
  "HomeTotalAmt",
  "Balance",
  "PrintStatus",
  "EmailStatus",
  "TxnTaxDetail"
]);

async function getInvoices(options = {}) {
  const requestedColumns = options.columns?.length
    ? [...new Set(options.columns)]
    : null;

  if (requestedColumns && requestedColumns.some((column) => !invoiceColumns.has(column))) {
    throw new Error("Invalid invoice column. Use valid QuickBooks Invoice fields.");
  }

  const status = options.status || (options.paidOnly ? "paid" : "all");
  const whereByStatus = {
    paid: "Balance = '0'",
    unpaid: "Balance > '0'",
    all: undefined
  };

  if (!(status in whereByStatus)) {
    throw new Error("Invalid invoice status. Use paid, unpaid, or all.");
  }

  const dateFilters = [];
  for (const [name, value, operator] of [
    ["startDate", options.startDate, ">="],
    ["endDate", options.endDate, "<="]
  ]) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`${name} must use YYYY-MM-DD format.`);
    }

    if (value) {
      dateFilters.push(`TxnDate ${operator} '${value}'`);
    }
  }

  const filters = [whereByStatus[status], ...dateFilters].filter(Boolean);

  return queryResource("Invoice", "invoices", {
    columns: requestedColumns,
    where: filters.length ? filters.join(" and ") : undefined,
    fetchAll: true
  });
}

const transactionTypes = new Set([
  "CreditCardCharge",
  "Check",
  "Invoice",
  "ReceivePayment",
  "JournalEntry",
  "Bill",
  "CreditCardCredit",
  "VendorCredit",
  "Credit",
  "BillPaymentCheck",
  "BillPaymentCreditCard",
  "Charge",
  "Transfer",
  "Deposit",
  "Statement",
  "BillableCharge",
  "TimeActivity",
  "CashPurchase",
  "SalesReceipt",
  "CreditMemo",
  "CreditRefund",
  "Estimate",
  "InventoryQuantityAdjustment",
  "PurchaseOrder",
  "GlobalTaxPayment",
  "GlobalTaxAdjustment"
]);

async function getTransactionReport(reportName, params, label) {
  const { access_token, realmId } = await qbTokenService.getTokens();

  if (!access_token || !realmId) {
    return {
      Rows: {},
      message: "No QuickBooks token or realm is stored yet. Complete OAuth first."
    };
  }

  const searchParams = new URLSearchParams({
    minorversion: quickBooksMinorVersion,
    ...params
  });

  const requestFn = async () => {
    const currentTokens = await qbTokenService.getTokens();
    const response = await axios.get(
      getCompanyUrl(currentTokens.realmId, `reports/${reportName}?${searchParams.toString()}`),
      {
        ...quickBooksRequestConfig,
        headers: {
          Authorization: `Bearer ${currentTokens.access_token}`,
          Accept: "application/json"
        }
      }
    );

    return response.data;
  };

  return retryAfterRefresh(requestFn, label, { Rows: {} });
}

async function getTransactions(options = {}) {
  const dateParams = {};

  for (const [name, param, value] of [
    ["startDate", "start_date", options.startDate],
    ["endDate", "end_date", options.endDate]
  ]) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`${name} must use YYYY-MM-DD format.`);
    }

    if (value) {
      dateParams[param] = value;
    }
  }

  const requestedTypes = options.transactionTypes?.length
    ? [...new Set(options.transactionTypes)]
    : null;

  if (requestedTypes && requestedTypes.some((type) => !transactionTypes.has(type))) {
    throw new Error("Invalid transaction type. Use valid QuickBooks transaction type names.");
  }

  // QuickBooks' transaction_type report param only accepts one value at a time,
  // so fan out a request per requested type and merge the report rows together.
  if (!requestedTypes || requestedTypes.length <= 1) {
    const params = {
      ...dateParams,
      ...(requestedTypes ? { transaction_type: requestedTypes[0] } : {})
    };

    return getTransactionReport("TransactionList", params, "transactions");
  }

  const reports = await Promise.all(
    requestedTypes.map((type) =>
      getTransactionReport("TransactionList", { ...dateParams, transaction_type: type }, "transactions")
    )
  );

  const mergedRows = reports.flatMap((report) => report.Rows?.Row || []);

  return {
    ...reports[0],
    Rows: { Row: mergedRows }
  };
}

const creditMemoStatusFilters = {
  refunded: undefined,
  open: "Balance > '0'",
  all: undefined
};

// QBO records a credit-memo refund as a linked RefundReceipt, or as a
// Check/Expense with the credit memo added in its "Add to check" panel.
const refundLinkedTxnTypes = new Set(["RefundReceipt", "Check", "Expense"]);

function getLinkedTransactions(creditMemo) {
  return (creditMemo.LinkedTxn || [])
    .filter((txn) => txn.TxnId && txn.TxnType)
    .map((txn) => ({ type: txn.TxnType, id: txn.TxnId }));
}

// Shapes a CreditMemo into the transaction-list table columns (date, type,
// ref no., contact, due date, balance, total amount, memo, last modified, status).
function toCreditMemoTableRow(creditMemo) {
  const linkedTransactions = getLinkedTransactions(creditMemo);
  const refundTransactions = linkedTransactions.filter((txn) => refundLinkedTxnTypes.has(txn.type));
  const balance = creditMemo.Balance ?? 0;
  const totalAmount = creditMemo.TotalAmt ?? 0;
  const hasLinkedRefund = refundTransactions.length > 0;
  // QuickBooks does not always link the refund/payment back to the credit
  // memo, so a zero balance is the reliable signal that the credit was settled.
  const refundReceived = balance === 0 && totalAmount > 0;

  let status = "Open";
  if (hasLinkedRefund) {
    status = balance === 0 ? "Refunded" : "Partially refunded";
  } else if (refundReceived) {
    status = "Closed";
  } else if (balance < totalAmount) {
    status = "Partially applied";
  }

  return {
    id: creditMemo.Id,
    date: creditMemo.TxnDate || null,
    type: "Credit memo",
    refNo: creditMemo.DocNumber || null,
    contact: creditMemo.CustomerRef?.name || null,
    dueDate: null,
    balance,
    totalAmount,
    memo: creditMemo.PrivateNote || creditMemo.CustomerMemo?.value || null,
    lastModifiedDate: creditMemo.MetaData?.LastUpdatedTime || null,
    status,
    refundReceived,
    refundTransactionIds: refundTransactions.map((txn) => txn.id),
    linkedTransactions
  };
}

async function getCreditMemos(options = {}) {
  const status = options.status || "refunded";

  if (!(status in creditMemoStatusFilters)) {
    throw new Error("Invalid credit memo status. Use refunded, open, or all.");
  }

  const filters = [];

  if (creditMemoStatusFilters[status]) {
    filters.push(creditMemoStatusFilters[status]);
  }

  for (const [name, value, operator] of [
    ["startDate", options.startDate, ">="],
    ["endDate", options.endDate, "<="]
  ]) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`${name} must use YYYY-MM-DD format.`);
    }

    if (value) {
      filters.push(`TxnDate ${operator} '${value}'`);
    }
  }

  for (const [field, value] of [
    ["DocNumber", options.docNumber],
    ["Id", options.id]
  ]) {
    if (value) {
      filters.push(`${field} = '${String(value).replace(/'/g, "\\'")}'`);
    }
  }

  const response = await queryResource("CreditMemo", "credit memos", {
    where: filters.length ? filters.join(" and ") : undefined,
    fetchAll: true
  });

  const { QueryResponse, ...rest } = response;
  let creditMemos = QueryResponse?.CreditMemo || [];

  // Query responses can omit LinkedTxn/Balance, so details=true re-reads each
  // entity for reliable refund detection. Capped because each read is a call.
  if (options.details && creditMemos.length) {
    if (creditMemos.length > 100) {
      throw new Error("Too many credit memos for details. Narrow the filters (docNumber, id, dates) to 100 or fewer.");
    }

    const creditMemoDetails = await getResourceDetails(
      "CreditMemo",
      "CreditMemo",
      creditMemos.map((creditMemo) => creditMemo.Id).filter(Boolean),
      "credit memo details"
    );

    creditMemos = creditMemos.map(
      (creditMemo) => creditMemoDetails.get(String(creditMemo.Id)) || creditMemo
    );
  }

  let rows = creditMemos.map(toCreditMemoTableRow);

  if (status === "refunded") {
    rows = rows.filter((row) => row.refundReceived);
  }

  return {
    ...rest,
    count: rows.length,
    creditMemos: rows
  };
}

async function createCustomer(payload) {
  const { access_token, realmId } = await qbTokenService.getTokens();

  if (!access_token || !realmId) {
    throw new Error("No QuickBooks token or realm is stored yet. Complete OAuth first.");
  }

  const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/customer`;

  const requestFn = async () => {
    const currentTokens = await qbTokenService.getTokens();
    const response = await axios.post(
      `https://quickbooks.api.intuit.com/v3/company/${currentTokens.realmId}/customer`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${currentTokens.access_token}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        }
      }
    );

    return response.data;
  };

  try {
    return await retryAfterRefresh(requestFn, "creating customers");
  } catch (error) {
    return {
      status: "unauthorized",
      message: "QuickBooks rejected the stored token. Re-run OAuth to refresh the access token and realm.",
      details: error.response?.data || error.message
    };
  }
}

const qbApiService = {
  getCustomers,
  createCustomer,
  getInvoices,
  createInvoice: (payload) => createResource("invoice", payload, "invoices"),
  getItems: () => queryResource("Item", "items"),
  createItem: (payload) => createResource("item", payload, "items"),
  getPayments: () => queryResource("Payment", "payments"),
  createPayment: (payload) => createResource("payment", payload, "payments"),
  getBillings,
  createBilling,
  getVendors: () => queryResource("Vendor", "vendors"),
  createVendor: (payload) => createResource("vendor", payload, "vendors"),
  getTransactions,
  getCreditMemos
};

export default qbApiService;
