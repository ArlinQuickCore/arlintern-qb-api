import express from "express";
import qbTransactionController from "../controllers/qbTransactionController.js";

const router = express.Router();

router.get("/", qbTransactionController.list);

export default router;
