import qbApiService from "../services/qbApiService.js";

const qbInvoiceController = {
  async list(req, res) {
    try {
      const columns = req.query.columns
        ? req.query.columns.split(",").map((column) => column.trim()).filter(Boolean)
        : undefined;
      const status = req.query.status || (req.query.paidOnly === "true" ? "paid" : "all");
      const data = await qbApiService.getInvoices({
        columns,
        status,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      res.json(data);
    } catch (err) {
      console.error("Invoice list error:", err);
      res.status(500).json({ error: err.message });
    }
  },

  async create(req, res) {
    try {
      const data = await qbApiService.createInvoice(req.body);
      res.json(data);
    } catch (err) {
      console.error("Invoice create error:", err);
      res.status(500).json({ error: err.message });
    }
  }
};

export default qbInvoiceController;
