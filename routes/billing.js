import express from "express";
import qbBillingController from "../controllers/qbBillingController.js";

const router = express.Router();

router.get("/", qbBillingController.list);
router.post("/", qbBillingController.create);

export default router;