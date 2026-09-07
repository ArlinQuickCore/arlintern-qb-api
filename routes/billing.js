import express from "express";
import qbBillingController from "../controllers/qbBillingController.js";
import powerBiAuth from "../middleware/powerBiAuth.js";

const router = express.Router();

router.use(powerBiAuth);
router.get("/", qbBillingController.list);
router.post("/", qbBillingController.create);

export default router;