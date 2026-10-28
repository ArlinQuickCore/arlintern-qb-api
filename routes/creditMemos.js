import express from "express";
import qbCreditMemoController from "../controllers/qbCreditMemoController.js";

const router = express.Router();

router.get("/", qbCreditMemoController.list);

export default router;
