import { Hono } from "hono";
import { z } from "zod";
import { query, queryOne } from "../db/pool.js";
import { HttpError, parse, formatDuration } from "../lib/apiError.js";
import { rateLimit } from "../lib/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";
import { parseAndValidateMonitorUrl, SsrfError } from "../lib/ssrf.js";
import { serializeMonitor, serializeIncident, type MonitorRow, type IncidentRow } from "../lib/serialize.js";
import type { AppEnv } from "../types.js";

const rangeHours: Record<string, number> = { "24h": 24, "7d": 168, "30d": 720 };

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  url: z.string().trim().url("Enter a valid URL").max(2000),
  type: z.literal("http").default("http"),
  intervalSeconds: z.coerce.number().int().min(10, "Minimum interval is 10 seconds").max(86400).default(60),
  timeoutMs: z.coerce.number().int().min(1000, "Minimum timeout is 1000ms").max(120000).default(10000),
  expectedStatus: z.coerce.number().int().min(100).max(599).nullable().optional().default(null),
  failureThreshold: z.coerce.number().int().min(1).max(10).default(3),
  recoveryThreshold: z.coerce.number().int().min(1).max(10).default(2),
});

const patchSchema = createSchema.partial();

async function assertUrlAllowed(url: string): Promise<void> {
  try {
    // At creation time only URL syntax, scheme, port and IP-literal rules are
    // enforced — a hostname that currently fails DNS may still be valid and
    // DNS is re-resolved (and re-validated against private ranges) on every check.
    parseAndValidateMonitorUrl(url);
  } catch (err) {
    if (err instanceof SsrfError) throw new HttpError(400, err.message, "unsafe_url");
    throw err;
  }
}

function parseRange(value: string | undefined): number {
  const hours = rangeHours[value ?? "24h"];
  if (!hours) throw new HttpError(400, "Invalid range. Use 24h, 7d or 30d", "invalid_range");
  return hours;
}

export const monitorRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const user = c.get("user");
    const monitors = await query<MonitorRow>(
      `SELECT * FROM monitors WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.id],
    );

    const uptimeRows = await query<{ monitor_id: string; uptime: number | null; checks: number }>(
      `SELECT m.id AS monitor_id,
              CASE WHEN count(c) = 0 THEN NULL
                   ELSE round(100.0 * count(c) FILTER (WHERE c.success) / count(c), 3)::double precision END AS uptime,
              count(c) AS checks
       FROM monitors m
       LEFT JOIN monitor_checks c ON c.monitor_id = m.id AND c.checked_at >= now() - interval '24 hours'
       WHERE m.user_id = $1
       GROUP BY m.id`,
      [user.id],
    );
    const uptimeMap = new Map(uptimeRows.map((r) => [r.monitor_id, r]));

    return c.json({
      monitors: monitors.map((m) => ({
        ...serializeMonitor(m),
        uptime24h: uptimeMap.get(m.id)?.uptime ?? null,
        checks24h: Number(uptimeMap.get(m.id)?.checks ?? 0),
      })),
    });
  })
  .post("/", async (c) => {
    const user = c.get("user");
    const limited = rateLimit("monitors-create", 30, 60_000, user.id);
    if (!limited.ok) throw new HttpError(429, "Too many monitors created. Please wait a moment.", "rate_limited");

    const body = parse(createSchema, await c.req.json());
    await assertUrlAllowed(body.url);

    const normalizedUrl = body.url.replace(/#.*$/, "").replace(/\/$/, "");
    const duplicate = await queryOne(
      `SELECT id FROM monitors WHERE user_id = $1 AND lower(url) = lower($2)`,
      [user.id, normalizedUrl],
    );
    if (duplicate) throw new HttpError(409, "You are already monitoring this URL", "duplicate_monitor");

    const row = await queryOne<MonitorRow>(
      `INSERT INTO monitors (user_id, name, url, type, interval_seconds, timeout_ms, expected_status, failure_threshold, recovery_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [user.id, body.name, normalizedUrl, body.type, body.intervalSeconds, body.timeoutMs, body.expectedStatus, body.failureThreshold, body.recoveryThreshold],
    );
    return c.json({ monitor: serializeMonitor(row!) }, 201);
  })
  .get("/:id", async (c) => {
    const user = c.get("user");
    const row = await queryOne<MonitorRow>(`SELECT * FROM monitors WHERE id = $1 AND user_id = $2`, [c.req.param("id"), user.id]);
    if (!row) throw new HttpError(404, "Monitor not found", "not_found");
    const uptime = await monitorUptime(row.id, 24);
    return c.json({ monitor: { ...serializeMonitor(row), ...uptime } });
  })
  .patch("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const existing = await queryOne<MonitorRow>(`SELECT * FROM monitors WHERE id = $1 AND user_id = $2`, [id, user.id]);
    if (!existing) throw new HttpError(404, "Monitor not found", "not_found");

    const body = parse(patchSchema, await c.req.json());
    if (body.url && body.url.replace(/\/$/, "") !== existing.url) {
      await assertUrlAllowed(body.url);
      const normalizedUrl = body.url.replace(/#.*$/, "").replace(/\/$/, "");
      const duplicate = await queryOne(
        `SELECT id FROM monitors WHERE user_id = $1 AND lower(url) = lower($2) AND id <> $3`,
        [user.id, normalizedUrl, id],
      );
      if (duplicate) throw new HttpError(409, "You are already monitoring this URL", "duplicate_monitor");
      body.url = normalizedUrl;
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, string> = {
      name: "name",
      url: "url",
      intervalSeconds: "interval_seconds",
      timeoutMs: "timeout_ms",
      expectedStatus: "expected_status",
      failureThreshold: "failure_threshold",
      recoveryThreshold: "recovery_threshold",
    };
    for (const [key, column] of Object.entries(map)) {
      if (key in body) {
        values.push((body as Record<string, unknown>)[key]);
        fields.push(`${column} = $${values.length}`);
      }
    }
    if (fields.length === 0) throw new HttpError(400, "No fields to update", "empty_patch");
    values.push(id, user.id);
    const row = await queryOne<MonitorRow>(
      `UPDATE monitors SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING *`,
      values,
    );
    return c.json({ monitor: serializeMonitor(row!) });
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const deleted = await queryOne(`DELETE FROM monitors WHERE id = $1 AND user_id = $2 RETURNING id`, [c.req.param("id"), user.id]);
    if (!deleted) throw new HttpError(404, "Monitor not found", "not_found");
    return c.json({ ok: true });
  })
  .post("/:id/pause", async (c) => {
    const user = c.get("user");
    const row = await queryOne<MonitorRow>(
      `UPDATE monitors SET active = FALSE, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [c.req.param("id"), user.id],
    );
    if (!row) throw new HttpError(404, "Monitor not found", "not_found");
    return c.json({ monitor: serializeMonitor(row) });
  })
  .post("/:id/resume", async (c) => {
    const user = c.get("user");
    const row = await queryOne<MonitorRow>(
      `UPDATE monitors SET active = TRUE, consecutive_failures = 0, consecutive_successes = 0, last_checked_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [c.req.param("id"), user.id],
    );
    if (!row) throw new HttpError(404, "Monitor not found", "not_found");
    return c.json({ monitor: serializeMonitor(row) });
  })
  .get("/:id/checks", async (c) => {
    const user = c.get("user");
    const monitor = await queryOne(`SELECT id FROM monitors WHERE id = $1 AND user_id = $2`, [c.req.param("id"), user.id]);
    if (!monitor) throw new HttpError(404, "Monitor not found", "not_found");

    const limit = Math.min(Number(c.req.query("limit") || 100), 500);
    const hours = parseRange(c.req.query("range"));
    const rows = await query(
      `SELECT id, checked_at, success, status_code, response_time_ms, error, error_type
       FROM monitor_checks
       WHERE monitor_id = $1 AND checked_at >= now() - ($2 || ' hours')::interval
       ORDER BY checked_at DESC
       LIMIT $3`,
      [c.req.param("id"), hours, limit],
    );
    return c.json({
      checks: rows.map((r) => ({
        id: Number(r.id),
        checkedAt: r.checked_at,
        success: r.success,
        statusCode: r.status_code,
        responseTimeMs: r.response_time_ms,
        error: r.error,
        errorType: r.error_type,
      })),
    });
  })
  .get("/:id/uptime", async (c) => {
    const user = c.get("user");
    const monitor = await queryOne(`SELECT id FROM monitors WHERE id = $1 AND user_id = $2`, [c.req.param("id"), user.id]);
    if (!monitor) throw new HttpError(404, "Monitor not found", "not_found");
    const hours = parseRange(c.req.query("range"));
    const data = await monitorUptime(c.req.param("id"), hours);
    return c.json(data);
  })
  .get("/:id/incidents", async (c) => {
    const user = c.get("user");
    const monitor = await queryOne(`SELECT id FROM monitors WHERE id = $1 AND user_id = $2`, [c.req.param("id"), user.id]);
    if (!monitor) throw new HttpError(404, "Monitor not found", "not_found");
    const rows = await query<IncidentRow>(
      `SELECT * FROM incidents WHERE monitor_id = $1 AND user_id = $2 ORDER BY started_at DESC LIMIT 200`,
      [c.req.param("id"), user.id],
    );
    return c.json({ incidents: rows.map(serializeIncident) });
  });

export async function monitorUptime(monitorId: string, hours: number) {
  const stats = await queryOne<{
    total: number;
    ok: number;
    uptime: number | null;
    avg_ms: number | null;
    min_ms: number | null;
    max_ms: number | null;
    first_check: string | null;
    last_check: string | null;
  }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE success) AS ok,
            CASE WHEN count(*) = 0 THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE success) / count(*), 3)::double precision END AS uptime,
            round(avg(response_time_ms) FILTER (WHERE success), 1)::double precision AS avg_ms,
            min(response_time_ms) FILTER (WHERE success) AS min_ms,
            max(response_time_ms) FILTER (WHERE success) AS max_ms,
            min(checked_at) AS first_check,
            max(checked_at) AS last_check
     FROM monitor_checks
     WHERE monitor_id = $1 AND checked_at >= now() - ($2 || ' hours')::interval`,
    [monitorId, hours],
  );

  const bucketSeconds = hours <= 24 ? 1800 : hours <= 168 ? 10800 : 43200;
  const series = await query<{ bucket: string; avg_ms: number | null; max_ms: number | null; ok: number; total: number }>(
    `SELECT to_timestamp(floor(extract(epoch from checked_at) / $2) * $2)::timestamptz AS bucket,
            round(avg(response_time_ms) FILTER (WHERE success), 1)::double precision AS avg_ms,
            max(response_time_ms) FILTER (WHERE success) AS max_ms,
            count(*) FILTER (WHERE success) AS ok,
            count(*) AS total
     FROM monitor_checks
     WHERE monitor_id = $1 AND checked_at >= now() - ($3 || ' hours')::interval
     GROUP BY 1 ORDER BY 1`,
    [monitorId, bucketSeconds, hours],
  );

  const bucketHours = hours <= 24 ? 1 : hours <= 168 ? 3 : 12;
  const bucketCount = hours / bucketHours;
  const timeline = await query<{ bucket: string; uptime: number | null; total: number; ok: number }>(
    `WITH buckets AS (
       SELECT generate_series(
         date_trunc('hour', now()) - ($2::int * interval '1 hour') * ($3::int - 1),
         date_trunc('hour', now()),
         ($2::int * interval '1 hour')
       ) AS bucket
     )
     SELECT b.bucket::text,
            CASE WHEN count(c) = 0 THEN NULL
                 ELSE round(100.0 * count(c) FILTER (WHERE c.success) / count(c), 2) END AS uptime,
            count(c) AS total,
            count(c) FILTER (WHERE c.success) AS ok
     FROM buckets b
     LEFT JOIN monitor_checks c
       ON c.monitor_id = $1
      AND c.checked_at >= b.bucket
      AND c.checked_at < b.bucket + ($2::int * interval '1 hour')
     GROUP BY b.bucket ORDER BY b.bucket`,
    [monitorId, bucketHours, bucketCount],
  );

  const downtime = await queryOne<{ total_seconds: number; incidents: number }>(
    `SELECT coalesce(sum(
              CASE WHEN status = 'ongoing'
                   THEN extract(epoch from (now() - started_at))
                   ELSE duration_seconds END), 0) AS total_seconds,
            count(*) AS incidents
     FROM incidents
     WHERE monitor_id = $1
       AND started_at >= now() - ($2 || ' hours')::interval`,
    [monitorId, hours],
  );

  const totalSeconds = Number(downtime?.total_seconds ?? 0);
  return {
    rangeHours: hours,
    stats: {
      totalChecks: Number(stats?.total ?? 0),
      successfulChecks: Number(stats?.ok ?? 0),
      uptime: stats?.uptime ?? null,
      avgResponseTimeMs: stats?.avg_ms ?? null,
      minResponseTimeMs: stats?.min_ms ?? null,
      maxResponseTimeMs: stats?.max_ms ?? null,
      firstCheckAt: stats?.first_check ?? null,
      lastCheckAt: stats?.last_check ?? null,
      incidentCount: Number(downtime?.incidents ?? 0),
      downtimeSeconds: Math.round(totalSeconds),
      downtimeLabel: formatDuration(totalSeconds),
      hasData: Number(stats?.total ?? 0) > 0,
    },
    series: series.map((s) => ({
      time: s.bucket,
      avgResponseTimeMs: s.avg_ms === null ? null : Number(s.avg_ms),
      maxResponseTimeMs: s.max_ms ?? null,
      uptime: s.total === 0 ? null : round2((100 * Number(s.ok)) / s.total),
      checks: Number(s.total),
    })),
    timeline: timeline.map((t) => ({
      time: t.bucket,
      uptime: t.uptime === null ? null : Number(t.uptime),
      checks: Number(t.total),
    })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
