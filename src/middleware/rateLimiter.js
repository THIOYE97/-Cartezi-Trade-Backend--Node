import rateLimit from "express-rate-limit";

function makeLimit(windowMinutes, max, message) {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message },
    skipSuccessfulRequests: false,
  });
}

// Signin : 10 tentatives / 15 min
export const signinLimiter = makeLimit(15, 10, "Too many login attempts, please try again later");

// OTP : 6 tentatives / 10 min (brute-force sur 6 chiffres)
export const otpLimiter = makeLimit(10, 6, "Too many OTP attempts, please request a new code");

// Signup : 5 créations / heure par IP
export const signupLimiter = makeLimit(60, 5, "Too many accounts created from this IP");

// Reset password : 5 demandes / 30 min
export const resetPasswordLimiter = makeLimit(30, 5, "Too many password reset requests");