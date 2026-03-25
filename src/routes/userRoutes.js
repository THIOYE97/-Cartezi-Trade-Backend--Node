import { Router } from "express";
import { query } from "../data/db.js";
import { requireAdmin, requireAuth } from "../middleware/requireAuth.js";
import { sanitizeUser } from "../services/coreService.js";
import { notFound } from "../utils/httpError.js";

const router = Router();

// Son propre profil
router.get("/api/users/profile", requireAuth, async (req, res) => {
  return res.json(sanitizeUser(req.user));
});

// Par ID — admin seulement
router.get("/api/users/:userId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM users WHERE id = $1",
      [req.params.userId]
    );
    if (!rows[0]) throw notFound("User not found");
    return res.json(sanitizeUser(rows[0]));
  } catch (error) {
    return next(error);
  }
});

// Par email — admin seulement
router.get("/api/users/email/:email", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM users WHERE email = $1",
      [String(req.params.email).toLowerCase()]
    );
    if (!rows[0]) throw notFound("User not found");
    return res.json(sanitizeUser(rows[0]));
  } catch (error) {
    return next(error);
  }
});

export default router;