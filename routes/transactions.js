import express from "express";
import qbTransactionController from "../controllers/qbTransactionController.js";
import powerBiAuth from "../middleware/powerBiAuth.js";

const router = express.Router();

router.get("/", qbTransactionController.list);
router.get("/created-by", powerBiAuth, qbTransactionController.createdBy);
router.get("/details", qbTransactionController.details);

export default router;
