import qbApiService from "../services/qbApiService.js";

const qbCreditMemoController = {
  async list(req, res) {
    try {
      const data = await qbApiService.getCreditMemos({
        docNumber: req.query.docNumber || req.query.refNo,
        id: req.query.id,
        status: req.query.status,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      res.json(data);
    } catch (err) {
      console.error("Credit memo list error:", err);
      res.status(500).json({ error: err.message });
    }
  }
};

export default qbCreditMemoController;
