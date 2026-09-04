import qbApiService from "../services/qbApiService.js";

const qbBillingController = {
  async list(req, res) {
    try {
      const data = await qbApiService.getBillings();
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