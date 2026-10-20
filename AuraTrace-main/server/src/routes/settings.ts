import { Hono } from "hono";
import { z } from "zod";
import { query, queryOne } from "../db/pool.js";
import { parse } from "../lib/apiError.js";
import { requireAuth } from "../middleware/auth.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { HttpError } from "../lib/apiError.js";
import { sendNotification } from "../lib/email.js";
import type { AppEnv } from "../types.js";

const settingsSchema = z.object({
  emailEnabled: z.boolean(),
  notifyDown: z.boolean(),
  notifyRecovery: z.boolean(),
  recipientEmail: z.string().trim().toLowerCase().email().max(200).nullable(),
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200).regex(/[a-zA-Z]/).regex(/[0-9]/),
});

export const settingsRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const user = c.get("user");
    const settings = await queryOne(
      `SELECT email_enabled, notify_down, notify_recovery, recipient_email FROM notification_settings WHERE user_id = $1`,
      [user.id],
    );
    return c.json({
      notificationSettings: {
        emailEnabled: settings?.email_enabled ?? true,
        notifyDown: settings?.notify_down ?? true,
        notifyRecovery: settings?.notify_recovery ?? true,
        recipientEmail: settings?.recipient_email ?? user.email,
      },
    });
  })
  .put("/", async (c) => {
    const user = c.get("user");
    const body = parse(settingsSchema, await c.req.json());
    await query(
      `INSERT INTO notification_settings (user_id, email_enabled, notify_down, notify_recovery, recipient_email, updated_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (user_id) DO UPDATE
         SET email_enabled = EXCLUDED.email_enabled,
             notify_down = EXCLUDED.notify_down,
             notify_recovery = EXCLUDED.notify_recovery,
             recipient_email = EXCLUDED.recipient_email,
             updated_at = now()`,
      [user.id, body.emailEnabled, body.notifyDown, body.notifyRecovery, body.recipientEmail],
    );
    return c.json({ ok: true });
  })
  .get("/profile", async (c) => {
    const user = c.get("user");
    const row = await queryOne(`SELECT id, email, name, created_at FROM users WHERE id = $1`, [user.id]);
    return c.json({
      profile: { id: row?.id, email: row?.email, name: row?.name, createdAt: row?.created_at },
    });
  })
  .put("/profile", async (c) => {
    const user = c.get("user");
    const body = parse(profileSchema, await c.req.json());
    const updated = await queryOne(`UPDATE users SET name = $1, email = $2, updated_at = now() WHERE id = $3 RETURNING id, email, name`, [
      body.name,
      body.email,
      user.id,
    ]);
    return c.json({ profile: updated });
  })
  .put("/password", async (c) => {
    const user = c.get("user");
    const body = parse(passwordSchema, await c.req.json());
    const row = await queryOne<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
      throw new HttpError(400, "Current password is incorrect", "invalid_password");
    }
    const hash = await hashPassword(body.newPassword);
    await query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [hash, user.id]);
    await query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`, [user.id]);
    return c.json({ ok: true });
  })
  .get("/notifications", async (c) => {
    const user = c.get("user");
    const rows = await query(
      `SELECT n.id, n.event_type, n.channel, n.status, n.recipient, n.error, n.created_at,
              m.name AS monitor_name, i.title AS incident_title
       FROM notification_logs n
       LEFT JOIN monitors m ON m.id = n.monitor_id
       LEFT JOIN incidents i ON i.id = n.incident_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 100`,
      [user.id],
    );
    return c.json({
      logs: rows.map((r) => ({
        id: Number(r.id),
        eventType: r.event_type,
        channel: r.channel,
        status: r.status,
        recipient: r.recipient,
        error: r.error,
        createdAt: r.created_at,
        monitorName: r.monitor_name ?? null,
        incidentTitle: r.incident_title ?? null,
      })),
    });
  })
  .post("/notifications/test", async (c) => {
    const user = c.get("user");
    const settings = await queryOne<{ recipient_email: string | null }>(`SELECT recipient_email FROM notification_settings WHERE user_id = $1`, [user.id]);
    const sent = await sendNotification({
      userId: user.id,
      monitorId: null as unknown as string,
      incidentId: null,
      eventType: "test",
      monitorName: "AuraTrace test alert",
      url: "https://example.com",
      recipient: settings?.recipient_email ?? user.email,
      detectedAt: new Date(),
    });
    return c.json({ sent });
  });
