import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function signJwt(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
    },
    env.jwtSecret,
    { expiresIn: "24h" }
  );
}

export function verifyJwt(token) {
  return jwt.verify(token, env.jwtSecret);
}
