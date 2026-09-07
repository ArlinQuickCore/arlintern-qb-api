import axios from "axios";
import qbTokenService from "./qbTokenService.js";

const getCompanyUrl = (realmId, resource) =>
  `https://quickbooks.api.intuit.com/v3/company/${realmId}/${resource}`;
const quickBooksRequestConfig = {
  timeout: 20000
};

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
  const { access_token, realmId } = qbTokenService.getTokens();

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
      const currentTokens = qbTokenService.getTokens();
      const response = await axios.get(
        getCompanyUrl(currentTokens.realmId, `query?query=${query}`),
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
  const { access_token, realmId } = qbTokenService.getTokens();

  if (!access_token || !realmId) {
    throw new Error("No QuickBooks token or realm is stored yet. Complete OAuth first.");
  }

  const requestFn = async () => {
    const currentTokens = qbTokenService.getTokens();
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
  const concurrency = 2;

  for (let index = 0; index < ids.length; index += concurrency) {
    const batch = ids.slice(index, index + concurrency);
    const results = await Promise.all(batch.map((id) => retryAfterRefresh(async () => {
      const currentTokens = qbTokenService.getTokens();
      const response = await axios.get(
        getCompanyUrl(currentTokens.realmId, `${resource.toLowerCase()}/${encodeURIComponent(id)}`),
        {
          ...quickBooksRequestConfig,
          headers: {
            Authorization: `Bearer ${currentTokens.access_token}`,
            Accept: "application/json"
          }
        }
      );

      return response.data?.[responseKey];
    }, label)));

    results.forEach((detail, resultIndex) => {
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
  const { access_token, realmId } = qbTokenService.getTokens();

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
    const currentTokens = qbTokenService.getTokens();
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
  "Vendor Type": "VendorRef"
};

function getCustomFieldValue(customFields, definitionId, fieldName) {
  return customFields?.find(
    (field) =>
      String(field.DefinitionId) === String(definitionId) ||
      field.Name?.trim().toLowerCase() === fieldName.toLowerCase()
  )?.StringValue || null;
}

function addBillingColumnAliases(bill, billDetails = new Map()) {
  const detail = billDetails.get(String(bill.Id)) || bill;
  const customFields = detail.CustomField || bill.CustomField;

  return {
    ...detail,
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

  const response = await queryResource("Bill", "billing", {
    columns,
    where: whereByStatus[status],
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

async function createCustomer(payload) {
  const { access_token, realmId } = qbTokenService.getTokens();

  if (!access_token || !realmId) {
    throw new Error("No QuickBooks token or realm is stored yet. Complete OAuth first.");
  }

  const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/customer`;

  const requestFn = async () => {
    const currentTokens = qbTokenService.getTokens();
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
  getInvoices: () => queryResource("Invoice", "invoices"),
  createInvoice: (payload) => createResource("invoice", payload, "invoices"),
  getItems: () => queryResource("Item", "items"),
  createItem: (payload) => createResource("item", payload, "items"),
  getPayments: () => queryResource("Payment", "payments"),
  createPayment: (payload) => createResource("payment", payload, "payments"),
  getBillings,
  createBilling,
  getVendors: () => queryResource("Vendor", "vendors"),
  createVendor: (payload) => createResource("vendor", payload, "vendors")
};

export default qbApiService;
