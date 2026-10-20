import { Hono } from "hono";
import { z } from "zod";
import { query, queryOne } from "../db/pool.js";
import { HttpError, parse } from "../lib/apiError.js";
import { requireAuth } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Slug must be 3-40 characters: lowercase letters, numbers and hyphens");

const createSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100),
  description: z.string().trim().max(500).nullable().optional().default(null),
  slug: slugSchema.optional(),
  monitorIds: z.array(z.string().uuid()).min(1, "Select at least one monitor").max(50),
  published: z.boolean().default(true),
});

const patchSchema = createSchema.partial();

function randomSlug(): string {
  return `status-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadStatusPage(id: string, userId: string) {
  const page = await queryOne<{ id: string; user_id: string; slug: string; title: string; description: string | null; published: boolean; created_at: string; updated_at: string }>(
    `SELECT * FROM status_pages WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!page) throw new HttpError(404, "Status page not found", "not_found");
  const monitors = await query<{ monitor_id: string; name: string; url: string; status: string; active: boolean; position: number }>(
    `SELECT spm.monitor_id, m.name, m.url, m.status, m.active, spm.position
     FROM status_page_monitors spm
     JOIN monitors m ON m.id = spm.monitor_id
     WHERE spm.status_page_id = $1
     ORDER BY spm.position, m.name`,
    [id],
  );
  return { page, monitors };
}

async function assertMonitorsOwned(monitorIds: string[], userId: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM monitors WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, monitorIds],
  );
  if (rows.length !== new Set(monitorIds).size) {
    throw new HttpError(400, "One or more selected monitors do not exist", "invalid_monitors");
  }
}

export const statusPageRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const user = c.get("user");
    const pages = await query(
      `SELECT sp.*,
              (SELECT count(*) FROM status_page_monitors spm WHERE spm.status_page_id = sp.id) AS monitor_count
       FROM status_pages sp WHERE sp.user_id = $1 ORDER BY sp.created_at DESC`,
      [user.id],
    );
    return c.json({
      statusPages: pages.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        description: p.description,
        published: p.published,
        monitorCount: Number(p.monitor_count ?? 0),
        createdAt: p.created_at,
        publicUrl: `${(process.env.APP_URL || "").replace(/\/$/, "")}/status/${p.slug}`,
      })),
    });
  })
  .post("/", async (c) => {
    const user = c.get("user");
    const body = parse(createSchema, await c.req.json());
    await assertMonitorsOwned(body.monitorIds, user.id);

    let slug = body.slug ?? randomSlug();
    const taken = await queryOne(`SELECT id FROM status_pages WHERE slug = $1`, [slug]);
    if (taken) {
      if (body.slug) throw new HttpError(409, "This slug is already taken", "slug_taken");
      slug = `${randomSlug()}-${Math.random().toString(36).slice(2, 5)}`;
    }

    const page = await queryOne<{ id: string }>(
      `INSERT INTO status_pages (user_id, slug, title, description, published) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [user.id, slug, body.title, body.description ?? null, body.published],
    );
    for (const [index, monitorId] of body.monitorIds.entries()) {
      await query(`INSERT INTO status_page_monitors (status_page_id, monitor_id, position) VALUES ($1,$2,$3)`, [page!.id, monitorId, index]);
    }
    const loaded = await loadStatusPage(page!.id, user.id);
    return c.json({ statusPage: serialize(loaded) }, 201);
  })
  .get("/:id", async (c) => {
    const user = c.get("user");
    const loaded = await loadStatusPage(c.req.param("id"), user.id);
    return c.json({ statusPage: serialize(loaded) });
  })
  .patch("/:id", async (c) => {
    const user = c.get("user");
    const existing = await queryOne(`SELECT id FROM status_pages WHERE id = $1 AND user_id = $2`, [c.req.param("id"), user.id]);
    if (!existing) throw new HttpError(404, "Status page not found", "not_found");
    const body = parse(patchSchema, await c.req.json());
    if (body.monitorIds) await assertMonitorsOwned(body.monitorIds, user.id);

    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries({ title: "title", description: "description", slug: "slug", published: "published" })) {
      if (key in body) {
        values.push((body as Record<string, unknown>)[key] ?? null);
        fields.push(`${column} = $${values.length}`);
      }
    }
    if (body.slug) {
      const taken = await queryOne(`SELECT id FROM status_pages WHERE slug = $1 AND id <> $2`, [body.slug, c.req.param("id")]);
      if (taken) throw new HttpError(409, "This slug is already taken", "slug_taken");
    }
    if (fields.length) {
      values.push(c.req.param("id"));
      await query(`UPDATE status_pages SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
    }
    if (body.monitorIds) {
      await query(`DELETE FROM status_page_monitors WHERE status_page_id = $1`, [c.req.param("id")]);
      for (const [index, monitorId] of body.monitorIds.entries()) {
        await query(`INSERT INTO status_page_monitors (status_page_id, monitor_id, position) VALUES ($1,$2,$3)`, [c.req.param("id"), monitorId, index]);
      }
    }
    const loaded = await loadStatusPage(c.req.param("id"), user.id);
    return c.json({ statusPage: serialize(loaded) });
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const deleted = await queryOne(`DELETE FROM status_pages WHERE id = $1 AND user_id = $2 RETURNING id`, [c.req.param("id"), user.id]);
    if (!deleted) throw new HttpError(404, "Status page not found", "not_found");
    return c.json({ ok: true });
  });

function serialize(loaded: Awaited<ReturnType<typeof loadStatusPage>>) {
  return {
    id: loaded.page.id,
    slug: loaded.page.slug,
    title: loaded.page.title,
    description: loaded.page.description,
    published: loaded.page.published,
    createdAt: loaded.page.created_at,
    publicUrl: `/status/${loaded.page.slug}`,
    monitors: loaded.monitors.map((m) => ({
      monitorId: m.monitor_id,
      name: m.name,
      url: m.url,
      status: m.active ? m.status : "paused",
    })),
  };
}
