import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { env } from "../env.js";
import { queryOne } from "../db/pool.js";
import { sha256 } from "../lib/password.js";
import { HttpError } from "../lib/apiError.js";
import type { AppEnv } from "../types.js";

export const SESSION_COOKIE = "auratrace_session";

export function sessionExpiry(): Date {
  return new Date(Date.now() + env.sessionDays * 24 * 60 * 60 * 1000);
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }
  const session = await queryOne<{ user_id: string; email: string; name: string }>(
    `SELECT s.user_id, u.email, u.name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!session) {
    return c.json({ error: "Your session has expired. Please sign in again." }, 401);
  }
  c.set("user", { id: session.user_id, email: session.email, name: session.name });
  await next();
});

export function assertOwnership(row: { user_id: string } | null, userId: string, resource = "Resource"): never | void {
  if (!row) throw new HttpError(404, `${resource} not found`, "not_found");
  if (row.user_id !== userId) throw new HttpError(404, `${resource} not found`, "not_found");
}
