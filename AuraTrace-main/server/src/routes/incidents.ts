import { Hono } from "hono";
import { query, queryOne } from "../db/pool.js";
import { HttpError } from "../lib/apiError.js";
import { requireAuth } from "../middleware/auth.js";
import { serializeIncident, type IncidentRow } from "../lib/serialize.js";
import type { AppEnv } from "../types.js";

export const incidentRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const user = c.get("user");
    const status = c.req.query("status") || "all";
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!["all", "ongoing", "resolved"].includes(status)) {
      throw new HttpError(400, "Invalid status filter", "invalid_filter");
    }

    const conditions = ["i.user_id = $1"];
    const params: unknown[] = [user.id];
    if (status !== "all") {
      params.push(status);
      conditions.push(`i.status = $${params.length}`);
    }
    if (from) {
      const date = new Date(from);
      if (Number.isNaN(date.getTime())) throw new HttpError(400, "Invalid from date", "invalid_date");
      params.push(date);
      conditions.push(`i.started_at >= $${params.length}`);
    }
    if (to) {
      const date = new Date(to);
      if (Number.isNaN(date.getTime())) throw new HttpError(400, "Invalid to date", "invalid_date");
      params.push(date);
      conditions.push(`i.started_at <= $${params.length}`);
    }

    const rows = await query<IncidentRow & { monitor_name: string; monitor_url: string }>(
      `SELECT i.*, m.name AS monitor_name, m.url AS monitor_url
       FROM incidents i
       JOIN monitors m ON m.id = i.monitor_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY i.started_at DESC
       LIMIT 300`,
      params,
    );
    return c.json({ incidents: rows.map(serializeIncident) });
  })
  .get("/:id", async (c) => {
    const user = c.get("user");
    const row = await queryOne<IncidentRow & { monitor_name: string; monitor_url: string }>(
      `SELECT i.*, m.name AS monitor_name, m.url AS monitor_url
       FROM incidents i
       JOIN monitors m ON m.id = i.monitor_id
       WHERE i.id = $1 AND i.user_id = $2`,
      [c.req.param("id"), user.id],
    );
    if (!row) throw new HttpError(404, "Incident not found", "not_found");

    const checks = await query(
      `SELECT id, checked_at, success, status_code, response_time_ms, error, error_type
       FROM monitor_checks
       WHERE monitor_id = $1
         AND checked_at >= ($2::timestamptz - interval '30 minutes')
         AND checked_at <= ($3::timestamptz + interval '30 minutes')
       ORDER BY checked_at ASC
       LIMIT 500`,
      [row.monitor_id, row.started_at, row.recovered_at ?? new Date()],
    );

    return c.json({
      incident: serializeIncident(row),
      checks: checks.map((r) => ({
        id: Number(r.id),
        checkedAt: r.checked_at,
        success: r.success,
        statusCode: r.status_code,
        responseTimeMs: r.response_time_ms,
        error: r.error,
        errorType: r.error_type,
      })),
    });
  });
