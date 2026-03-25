import { query } from "../data/db.js";
import { unauthorized } from "../utils/httpError.js";
import { verifyJwt } from "../utils/auth.js";

export async function requireAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      throw unauthorized("Missing bearer token");
    }

    const token = authHeader.slice("Bearer ".length);
    const payload = verifyJwt(token);

    const { rows } = await query(
      "SELECT * FROM users WHERE id = $1",
      [payload.sub]
    );

    if (rows.length === 0) throw unauthorized("Invalid token");

    req.user = rows[0];
    return next();
  } catch (error) {
    return next(unauthorized(error.message));
  }
}

export function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== "ROLE_ADMIN") {
    return next(unauthorized("Admin access required"));
  }
  return next();
}