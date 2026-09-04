import qbApiService from "../services/qbApiService.js";

const qbBillingController = {
  async list(req, res) {
    try {
      const columns = req.query.columns
        ? req.query.columns.split(",").map((column) => column.trim()).filter(Boolean)
        : undefined;
      const paidOnly = req.query.paidOnly === "true";
      const data = await qbApiService.getBillings({ columns, paidOnly });
      res.json(data);
    } catch (err) {
      console.error("Billing list error:", err);
      res.status(500).json({ error: err.message });
    }
  },

  async create(req, res) {
    try {
      const data = await qbApiService.createBilling(req.body);
      res.json(data);
    } catch (err) {
      console.error("Billing create error:", err);
      res.status(500).json({ error: err.message });
    }
  }
};

export default qbBillingController;