import { env } from "./env.js";
import { startScheduler } from "./engine/scheduler.js";
import { pool } from "./db/pool.js";

/**
 * Standalone monitoring worker.
 * Run with WORKER_ENABLED=false on the API process and `npm run worker -w server`
 * to keep monitoring completely independent of the web tier.
 */
console.log("[worker] AuraTrace monitoring worker starting");
startScheduler();

const shutdown = async () => {
  console.log("[worker] shutting down");
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

setInterval(() => {
  /* keep the process alive */
}, 1 << 30);
