import axios from "axios";
import qbTokenService from "./qbTokenService.js";

const getCompanyUrl = (realmId, resource) =>
  `https://quickbooks.api.intuit.com/v3/company/${realmId}/${resource}`;

async function retryAfterRefresh(requestFn, label, emptyResponse) {
  try {
    return await requestFn();
  } catch (error) {
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

async function getBillings(options = {}) {
  const requestedColumns = options.columns?.length
    ? options.columns
    : null;
  const columns = requestedColumns
    ? requestedColumns.filter((column) => billColumns.has(column))
    : null;

  if (requestedColumns && columns.length !== requestedColumns.length) {
    throw new Error("Invalid billing column. Use valid QuickBooks Bill fields.");
  }

  return queryResource("Bill", "billing", {
    columns,
    where: options.paidOnly ? "Balance = '0'" : undefined,
    fetchAll: true
  });
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
