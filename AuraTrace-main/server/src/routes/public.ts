import { Hono } from "hono";
import { queryOne, query } from "../db/pool.js";
import { HttpError } from "../lib/apiError.js";
import type { AppEnv } from "../types.js";

/**
 * Public, unauthenticated status page endpoint.
 * Exposes only explicitly selected monitors and sanitized incident info —
 * never URLs' configuration, credentials, internal errors or account data.
 */
export const publicRoutes = new Hono<AppEnv>().get("/status/:slug", async (c) => {
  const slug = c.req.param("slug").toLowerCase();
  const page = await queryOne<{ id: string; title: string; description: string | null; published: boolean }>(
    `SELECT id, title, description, published FROM status_pages WHERE slug = $1`,
    [slug],
  );
  if (!page || !page.published) throw new HttpError(404, "Status page not found", "not_found");

  const monitors = await query<{ monitor_id: string; name: string; status: string; active: boolean }>(
    `SELECT spm.monitor_id, m.name, m.status, m.active
     FROM status_page_monitors spm
     JOIN monitors m ON m.id = spm.monitor_id
     WHERE spm.status_page_id = $1
     ORDER BY spm.position, m.name`,
    [page.id],
  );

  const uptimeRows = await query<{ monitor_id: string; uptime24: number | null; uptime7: number | null; checks: number }>(
    `SELECT m.id AS monitor_id,
            CASE WHEN count(c) = 0 THEN NULL
                 ELSE round(100.0 * count(c) FILTER (WHERE c.success) / count(*), 2) END AS uptime24,
            NULL::numeric AS uptime7,
            count(c) AS checks
     FROM status_page_monitors spm
     JOIN monitors m ON m.id = spm.monitor_id
     LEFT JOIN monitor_checks c ON c.monitor_id = m.id AND c.checked_at >= now() - interval '24 hours'
     WHERE spm.status_page_id = $1
     GROUP BY m.id`,
    [page.id],
  );

  const uptime7Rows = await query<{ monitor_id: string; uptime7: number | null }>(
    `SELECT m.id AS monitor_id,
            CASE WHEN count(c) = 0 THEN NULL
                 ELSE round(100.0 * count(c) FILTER (WHERE c.success) / count(*), 2) END AS uptime7
     FROM status_page_monitors spm
     JOIN monitors m ON m.id = spm.monitor_id
     LEFT JOIN monitor_checks c ON c.monitor_id = m.id AND c.checked_at >= now() - interval '7 days'
     WHERE spm.status_page_id = $1
     GROUP BY m.id`,
    [page.id],
  );
  const uptime7Map = new Map(uptime7Rows.map((r) => [r.monitor_id, r.uptime7 === null ? null : Number(r.uptime7)]));
  const uptimeMap = new Map(uptimeRows.map((r) => [r.monitor_id, r.uptime24 === null ? null : Number(r.uptime24)]));

  const activeIncidents = await query<{ id: string; title: string; started_at: string; monitor_id: string }>(
    `SELECT i.id, i.title, i.started_at, i.monitor_id
     FROM incidents i
     JOIN status_page_monitors spm ON spm.monitor_id = i.monitor_id AND spm.status_page_id = $1
     WHERE i.status = 'ongoing'
     ORDER BY i.started_at DESC`,
    [page.id],
  );

  const statuses = monitors.map((m) => (m.active ? m.status : "paused"));
  const overall = statuses.includes("down")
    ? "down"
    : statuses.includes("pending")
      ? "degraded"
      : statuses.includes("paused") && statuses.every((s) => s === "paused")
        ? "paused"
        : "operational";

  return c.json({
    statusPage: {
      title: page.title,
      description: page.description,
      overall,
      updatedAt: new Date().toISOString(),
      services: monitors.map((m) => ({
        name: m.name,
        status: m.active ? m.status : "paused",
        uptime24h: uptimeMap.get(m.monitor_id) ?? null,
        uptime7d: uptime7Map.get(m.monitor_id) ?? null,
      })),
      incidents: activeIncidents.map((i) => ({
        title: i.title,
        startedAt: i.started_at,
        // Sanitized: no error internals on public pages.
        message: "We are investigating this issue and working to restore service.",
      })),
    },
  });
});
