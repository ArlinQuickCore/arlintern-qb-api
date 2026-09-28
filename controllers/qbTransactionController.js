import qbApiService from "../services/qbApiService.js";

const qbTransactionController = {
  async list(req, res) {
    try {
      const transactionTypes = req.query.transactionTypes
        ? req.query.transactionTypes.split(",").map((type) => type.trim()).filter(Boolean)
        : undefined;
      const data = await qbApiService.getTransactions({
        transactionTypes,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      res.json(data);
    } catch (err) {
      console.error("Transaction list error:", err);
      res.status(500).json({ error: err.message });
    }
  }
};

export default qbTransactionController;
