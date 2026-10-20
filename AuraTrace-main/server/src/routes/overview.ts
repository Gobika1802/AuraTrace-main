import { Hono } from "hono";
import { query, queryOne } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { serializeMonitor, serializeIncident, type MonitorRow, type IncidentRow } from "../lib/serialize.js";
import type { AppEnv } from "../types.js";

export const overviewRoutes = new Hono<AppEnv>().get("/", requireAuth, async (c) => {
  const user = c.get("user");

  const monitors = await query<MonitorRow>(`SELECT * FROM monitors WHERE user_id = $1 ORDER BY created_at DESC`, [user.id]);

  const uptimeRows = await query<{ monitor_id: string; uptime: number | null; checks: number; avg_ms: number | null }>(
    `SELECT m.id AS monitor_id,
            CASE WHEN count(c) = 0 THEN NULL
                 ELSE round(100.0 * count(c) FILTER (WHERE c.success) / count(c), 3)::double precision END AS uptime,
            count(c) AS checks,
            round(avg(c.response_time_ms) FILTER (WHERE c.success), 1)::double precision AS avg_ms
     FROM monitors m
     LEFT JOIN monitor_checks c ON c.monitor_id = m.id AND c.checked_at >= now() - interval '24 hours'
     WHERE m.user_id = $1
     GROUP BY m.id`,
    [user.id],
  );
  const uptimeMap = new Map(uptimeRows.map((r) => [r.monitor_id, r]));

  const active = monitors.filter((m) => m.active);
  const up = active.filter((m) => m.status === "up").length;
  const down = active.filter((m) => m.status === "down").length;
  const paused = monitors.length - active.length;

  const uptimeValues = uptimeRows.map((r) => r.uptime).filter((v): v is number => v !== null);
  const overallUptime = uptimeValues.length
    ? Math.round((uptimeValues.reduce((a, b) => a + b, 0) / uptimeValues.length) * 1000) / 1000
    : null;

  const responseValues = active
    .filter((m) => m.status !== "down" && typeof m.last_response_time_ms === "number")
    .map((m) => m.last_response_time_ms as number);
  const avgResponse = responseValues.length
    ? Math.round(responseValues.reduce((a, b) => a + b, 0) / responseValues.length)
    : null;

  const ongoing = await query<{ count: string }>(`SELECT count(*) FROM incidents WHERE user_id = $1 AND status = 'ongoing'`, [user.id]);
  const recentIncidents = await query<IncidentRow & { monitor_name: string; monitor_url: string }>(
    `SELECT i.*, m.name AS monitor_name, m.url AS monitor_url
     FROM incidents i JOIN monitors m ON m.id = i.monitor_id
     WHERE i.user_id = $1 ORDER BY i.started_at DESC LIMIT 8`,
    [user.id],
  );

  // Aggregate response-time trend across all active monitors (last 24h, 30-min buckets).
  const trend = await query<{ bucket: string; avg_ms: number | null; max_ms: number | null; checks: number; ok: number }>(
    `SELECT to_timestamp(floor(extract(epoch from checked_at) / 1800) * 1800)::timestamptz AS bucket,
            round(avg(c.response_time_ms) FILTER (WHERE c.success), 1) AS avg_ms,
            max(c.response_time_ms) FILTER (WHERE c.success) AS max_ms,
            count(*) AS checks,
            count(*) FILTER (WHERE c.success) AS ok
     FROM monitor_checks c
     JOIN monitors m ON m.id = c.monitor_id
     WHERE m.user_id = $1 AND c.checked_at >= now() - interval '24 hours'
     GROUP BY 1 ORDER BY 1`,
    [user.id],
  );

  // 24h availability per monitor (for the compact status bars).
  const perMonitor24 = await query<{ monitor_id: string; bucket: string; uptime: number | null; checks: number }>(
    `SELECT m.id AS monitor_id,
            to_char(date_trunc('hour', c.checked_at), 'YYYY-MM-DD"T"HH24:00:00Z') AS bucket,
            round(100.0 * count(*) FILTER (WHERE c.success) / count(*), 2) AS uptime,
            count(*) AS checks
     FROM monitors m
     JOIN monitor_checks c ON c.monitor_id = m.id AND c.checked_at >= now() - interval '24 hours'
     WHERE m.user_id = $1
     GROUP BY m.id, date_trunc('hour', c.checked_at)
     ORDER BY 2`,
    [user.id],
  );

  const availabilityByMonitor = new Map<string, { time: string; uptime: number; checks: number }[]>();
  for (const row of perMonitor24) {
    const list = availabilityByMonitor.get(row.monitor_id) ?? [];
    list.push({ time: row.bucket, uptime: Number(row.uptime), checks: Number(row.checks) });
    availabilityByMonitor.set(row.monitor_id, list);
  }

  const hasAnyMonitor = monitors.length > 0;

  return c.json({
    metrics: {
      totalMonitors: monitors.length,
      up,
      down,
      paused,
      overallUptime24h: overallUptime,
      avgResponseTimeMs: avgResponse,
      activeIncidents: Number(ongoing[0]?.count ?? 0),
      hasAnyMonitor,
    },
    monitors: monitors.map((m) => ({
      ...serializeMonitor(m),
      uptime24h: uptimeMap.get(m.id)?.uptime ?? null,
      checks24h: Number(uptimeMap.get(m.id)?.checks ?? 0),
    })),
    responseTrend: trend.map((t) => ({
      time: t.bucket,
      avgResponseTimeMs: t.avg_ms === null ? null : Number(t.avg_ms),
      maxResponseTimeMs: t.max_ms ?? null,
      checks: Number(t.checks),
    })),
    availability: Object.fromEntries(availabilityByMonitor),
    recentIncidents: recentIncidents.map(serializeIncident),
  });
});
