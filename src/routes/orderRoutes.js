import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  getOrderById,
  getUserOrders,
  placeOrder,
} from "../services/tradingService.js";

const router = Router();

router.post("/api/orders/pay", requireAuth, async (req, res, next) => {
  try {
    const order = await placeOrder({
      userId: req.user.id,
      coinId: req.body?.coinId,
      quantity: req.body?.quantity,
      orderType: req.body?.orderType,
    });
    return res.json(order);
  } catch (error) {
    return next(error);
  }
});

router.get("/api/orders/:orderId", requireAuth, async (req, res, next) => {
  try {
    return res.json(await getOrderById(req.user.id, req.params.orderId));
  } catch (error) {
    return next(error);
  }
});

router.get("/api/orders", requireAuth, async (req, res, next) => {
  try {
    const orders = await getUserOrders(
      req.user.id,
      req.query.order_type,
      req.query.asset_symbol
    );
    return res.json(orders);
  } catch (error) {
    return next(error);
  }
});

export default router;
