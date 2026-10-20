import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { env } from "./env.js";
import { HttpError } from "./lib/apiError.js";
import { authRoutes } from "./routes/auth.js";
import { monitorRoutes } from "./routes/monitors.js";
import { incidentRoutes } from "./routes/incidents.js";
import { overviewRoutes } from "./routes/overview.js";
import { statusPageRoutes } from "./routes/statusPages.js";
import { settingsRoutes } from "./routes/settings.js";
import { publicRoutes } from "./routes/public.js";
import { startScheduler } from "./engine/scheduler.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return env.corsOrigins[0] ?? "*";
      return env.corsOrigins.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 600,
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, service: "auratrace-api", time: new Date().toISOString() }));

app.route("/auth", authRoutes);
app.route("/api/monitors", monitorRoutes);
app.route("/api/incidents", incidentRoutes);
app.route("/api/overview", overviewRoutes);
app.route("/api/status-pages", statusPageRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/public", publicRoutes);

// Serve the built frontend in production for a single-service deployment.
const webDist = "../web/dist";
if (fs.existsSync(path.resolve(process.cwd(), webDist, "index.html"))) {
  app.use("*", serveStatic({ root: webDist }));
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api") || c.req.path.startsWith("/auth")) {
      return c.json({ error: "Not found" }, 404);
    }
    try {
      return await serveStatic({ path: "./index.html", root: webDist })(c, next);
    } catch {
      return next();
    }
  });
}

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, code: err.code, details: err.details }, err.status as ContentfulStatusCode);
  }
  if (err?.name === "SyntaxError" && "status" in err) {
    return c.json({ error: "Invalid JSON body", code: "invalid_json" }, 400);
  }
  console.error("[api] unhandled error:", err);
  return c.json({ error: "Internal server error", code: "internal" }, 500);
});

app.notFound((c) => c.json({ error: "Not found", code: "not_found" }, 404));

if (env.workerEnabled) {
  startScheduler();
}

serve({ fetch: app.fetch, port: env.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[api] AuraTrace API listening on http://localhost:${info.port} (worker: ${env.workerEnabled ? "embedded" : "external"})`);
});

export default app;
