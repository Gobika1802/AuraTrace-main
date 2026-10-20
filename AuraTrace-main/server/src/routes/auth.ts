import { Hono } from "hono";
import { z } from "zod";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { query, queryOne } from "../db/pool.js";
import { hashPassword, verifyPassword, randomToken, sha256 } from "../lib/password.js";
import { HttpError, parse } from "../lib/apiError.js";
import { rateLimit } from "../lib/rateLimit.js";
import { SESSION_COOKIE, requireAuth, sessionExpiry } from "../middleware/auth.js";
import { env } from "../env.js";
import type { AppEnv } from "../types.js";

const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long")
    .regex(/[a-zA-Z]/, "Password must include a letter")
    .regex(/[0-9]/, "Password must include a number"),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1, "Password is required").max(200),
});

function clientIpOf(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
}

async function createSession(userId: string, userAgent: string | undefined, ip: string): Promise<string> {
  const token = randomToken(32);
  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [userId, sha256(token), userAgent?.slice(0, 300) ?? null, ip, sessionExpiry()],
  );
  return token;
}

function persistSessionCookie(c: any, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProduction,
    path: "/",
    maxAge: env.sessionDays * 24 * 60 * 60,
  });
}

export const authRoutes = new Hono<AppEnv>()
  .post("/register", async (c) => {
    const ip = clientIpOf(c);
    const limited = rateLimit("auth", 10, 60_000, ip);
    if (!limited.ok) throw new HttpError(429, "Too many attempts. Please wait a minute and try again.", "rate_limited");

    const body = parse(registerSchema, await c.req.json());
    const existing = await queryOne(`SELECT id FROM users WHERE lower(email) = lower($1)`, [body.email]);
    if (existing) throw new HttpError(409, "An account with this email already exists", "email_taken");

    const passwordHash = await hashPassword(body.password);
    const user = await queryOne<{ id: string; email: string; name: string }>(
      `INSERT INTO users (email, password_hash, name) VALUES ($1,$2,$3) RETURNING id, email, name`,
      [body.email, passwordHash, body.name],
    );
    await query(`INSERT INTO notification_settings (user_id, recipient_email) VALUES ($1,$2)`, [user!.id, body.email]);

    const token = await createSession(user!.id, c.req.header("user-agent"), ip);
    persistSessionCookie(c, token);
    return c.json({ user: { id: user!.id, email: user!.email, name: user!.name } }, 201);
  })
  .post("/login", async (c) => {
    const ip = clientIpOf(c);
    const limited = rateLimit("auth", 10, 60_000, ip);
    if (!limited.ok) throw new HttpError(429, "Too many attempts. Please wait a minute and try again.", "rate_limited");

    const body = parse(loginSchema, await c.req.json());
    const user = await queryOne<{ id: string; email: string; name: string; password_hash: string }>(
      `SELECT id, email, name, password_hash FROM users WHERE lower(email) = lower($1)`,
      [body.email],
    );
    const ok = user && (await verifyPassword(body.password, user.password_hash));
    if (!ok || !user) throw new HttpError(401, "Invalid email or password", "invalid_credentials");

    const token = await createSession(user.id, c.req.header("user-agent"), ip);
    persistSessionCookie(c, token);
    return c.json({ user: { id: user.id, email: user.email, name: user.name } });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      await query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  })
  .get("/me", requireAuth, (c) => {
    return c.json({ user: c.get("user") });
  });
