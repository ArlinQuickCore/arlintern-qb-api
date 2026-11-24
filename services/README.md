# QuickBooks OAuth2 – Production Token System (Node.js + Express)

This project handles:
- Production OAuth redirect
- Authorization code capture
- Token exchange
- Refresh token flow

## 1. Install

## Transaction creator report

`GET /api/transactions/created-by` returns the QuickBooks TransactionList
report with the `tx_date`, `txn_type`, `doc_num`, and `create_by` columns.
The response retains QuickBooks' report structure, including column metadata
and row values. It accepts the optional `startDate` and `endDate` parameters
(YYYY-MM-DD) and comma-separated `transactionTypes`, as does
`GET /api/transactions`. Multiple transaction types are requested separately
and their report rows are combined. This endpoint requires a connected
QuickBooks account; creator values depend on what QuickBooks returns.
The endpoint requires the configured `POWERBI_API_KEY`, supplied as a
Bearer token, `X-API-Key`, or Basic authentication password.

The existing transaction list and details endpoints are unchanged.
