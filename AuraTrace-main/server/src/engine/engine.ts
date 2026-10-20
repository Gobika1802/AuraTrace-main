import { query, queryOne, withTransaction } from "../db/pool.js";
import { runCheck, type CheckResult } from "../lib/httpChecker.js";
import { sendNotification } from "../lib/email.js";
import { env } from "../env.js";
import { formatDuration } from "../lib/apiError.js";

export type DueMonitor = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  timeout_ms: number;
  interval_seconds: number;
  expected_status: number | null;
  failure_threshold: number;
  recovery_threshold: number;
  status: "pending" | "up" | "down";
  consecutive_failures: number;
  consecutive_successes: number;
  last_checked_at: string | null;
  active: boolean;
};

/**
 * Claims a batch of monitors that are due for checking.
 * FOR UPDATE SKIP LOCKED makes this safe for multiple concurrent workers.
 */
export async function claimDueMonitors(limit: number): Promise<DueMonitor[]> {
  return query<DueMonitor>(
    `WITH due AS (
       SELECT id FROM monitors
       WHERE active = TRUE
         AND (last_checked_at IS NULL OR last_checked_at + make_interval(secs => interval_seconds) <= now())
       ORDER BY last_checked_at NULLS FIRST
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE monitors m
     SET last_checked_at = now()
     FROM due
     WHERE m.id = due.id
     RETURNING m.id, m.user_id, m.name, m.url, m.timeout_ms, m.interval_seconds, m.expected_status,
               m.failure_threshold, m.recovery_threshold, m.status,
               m.consecutive_failures, m.consecutive_successes, m.last_checked_at, m.active`,
    [limit],
  );
}

export type CheckOutcome = {
  monitorId: string;
  result: CheckResult;
  incidentCreated: boolean;
  incidentResolved: boolean;
};

/**
 * Runs one check for a monitor, persists the result and applies
 * failure-confirmation / recovery-confirmation incident state machine.
 */
export async function checkMonitor(monitor: DueMonitor): Promise<CheckOutcome> {
  const result = await runCheck({
    url: monitor.url,
    timeoutMs: monitor.timeout_ms,
    expectedStatus: monitor.expected_status,
  });

  const checkedAt = new Date();
  let incidentCreated = false;
  let incidentResolved = false;

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO monitor_checks (monitor_id, checked_at, success, status_code, response_time_ms, error, error_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [monitor.id, checkedAt, result.success, result.statusCode, result.responseTimeMs, result.error, result.errorType],
    );

    if (result.success) {
      const { rows: updated } = await client.query(
        `UPDATE monitors
         SET consecutive_successes = consecutive_successes + 1,
             consecutive_failures = 0,
             last_success_at = $2,
             last_response_time_ms = $3,
             last_status_code = $4,
             last_error = NULL,
             status = CASE
               WHEN status = 'down' AND consecutive_successes + 1 >= recovery_threshold THEN 'up'
               WHEN status = 'pending' THEN 'up'
               ELSE status END,
             updated_at = now()
         WHERE id = $1
         RETURNING status, consecutive_successes, consecutive_failures, name, url, user_id`,
        [monitor.id, checkedAt, result.responseTimeMs, result.statusCode],
      );
      const updatedMonitor = updated[0];

      if (monitor.status === "down" && updatedMonitor?.status === "up") {
        const { rows: closed } = await client.query(
          `UPDATE incidents
           SET status = 'resolved',
               recovered_at = $2,
               duration_seconds = GREATEST(1, round(extract(epoch from ($2 - started_at)))),
               updated_at = now()
           WHERE monitor_id = $1 AND status = 'ongoing'
           RETURNING id, title, started_at, duration_seconds`,
          [monitor.id, checkedAt],
        );
        incidentResolved = closed.length > 0;
      }
    } else {
      const { rows: updated } = await client.query(
        `UPDATE monitors
         SET consecutive_failures = consecutive_failures + 1,
             consecutive_successes = 0,
             last_failure_at = $2,
             last_response_time_ms = $3,
             last_status_code = $4,
             last_error = $5,
             status = CASE WHEN consecutive_failures + 1 >= failure_threshold THEN 'down' ELSE status END,
             updated_at = now()
         WHERE id = $1
         RETURNING status, consecutive_failures, name, url, user_id`,
        [monitor.id, checkedAt, result.responseTimeMs, result.statusCode, result.error],
      );
      const updatedMonitor = updated[0];

      if (updatedMonitor?.status === "down" && monitor.status !== "down") {
        // Outage start = timestamp of the first failed check in this streak.
        const startedAt = new Date(checkedAt.getTime() - monitor.consecutive_failures * monitor.interval_seconds * 1000);
        const { rows: created } = await client.query(
          `INSERT INTO incidents (monitor_id, user_id, title, started_at, status, failure_reason)
           SELECT $1, $2, $3, $4, 'ongoing', $5
           WHERE NOT EXISTS (SELECT 1 FROM incidents WHERE monitor_id = $1 AND status = 'ongoing')
           RETURNING id`,
          [monitor.id, monitor.user_id, `${monitor.name} is down`, startedAt, result.error ?? "Checks failing"],
        );
        incidentCreated = created.length > 0;
      }
    }
  });

  // Notifications are sent outside the transaction; the unique index on
  // (incident_id, event_type) guarantees at-most-once per incident event.
  if (incidentCreated) {
    const incident = await queryOne<{ id: string }>(`SELECT id FROM incidents WHERE monitor_id = $1 AND status = 'ongoing' ORDER BY started_at DESC LIMIT 1`, [monitor.id]);
    const settings = await queryOne<{ email_enabled: boolean; notify_down: boolean; recipient_email: string | null; user_email: string }>(
      `SELECT s.email_enabled, s.notify_down, s.recipient_email, u.email AS user_email
       FROM notification_settings s JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1`,
      [monitor.user_id],
    );
    if (settings?.email_enabled && settings.notify_down) {
      await sendNotification({
        userId: monitor.user_id,
        monitorId: monitor.id,
        incidentId: incident?.id ?? null,
        eventType: "down",
        monitorName: monitor.name,
        url: monitor.url,
        recipient: settings.recipient_email ?? settings.user_email,
        reason: result.error,
        detectedAt: checkedAt,
      });
    } else {
      await query(
        `INSERT INTO notification_logs (user_id, monitor_id, incident_id, event_type, channel, status, recipient, error)
         VALUES ($1,$2,$3,'down','email','skipped',NULL,$4)
         ON CONFLICT (incident_id, event_type) WHERE incident_id IS NOT NULL DO NOTHING`,
        [monitor.user_id, monitor.id, incident?.id ?? null, "Down notifications are disabled for this account"],
      );
    }
  }

  if (incidentResolved) {
    const incident = await queryOne<{ id: string; duration_seconds: number }>(
      `SELECT id, duration_seconds FROM incidents WHERE monitor_id = $1 AND status = 'resolved' ORDER BY recovered_at DESC LIMIT 1`,
      [monitor.id],
    );
    const settings = await queryOne<{ email_enabled: boolean; notify_recovery: boolean; recipient_email: string | null; user_email: string }>(
      `SELECT s.email_enabled, s.notify_recovery, s.recipient_email, u.email AS user_email
       FROM notification_settings s JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1`,
      [monitor.user_id],
    );
    if (settings?.email_enabled && settings.notify_recovery) {
      await sendNotification({
        userId: monitor.user_id,
        monitorId: monitor.id,
        incidentId: incident?.id ?? null,
        eventType: "recovery",
        monitorName: monitor.name,
        url: monitor.url,
        recipient: settings.recipient_email ?? settings.user_email,
        recoveredAt: checkedAt,
        duration: incident?.duration_seconds ? formatDuration(Number(incident.duration_seconds)) : null,
      });
    }
  }

  return { monitorId: monitor.id, result, incidentCreated, incidentResolved };
}

/** Simple semaphore to cap concurrent outbound checks. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active -= 1;
    const run = queue.shift();
    if (run) run();
  };
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

export async function runDueChecksOnce(batchSize = 50): Promise<CheckOutcome[]> {
  const due = await claimDueMonitors(batchSize);
  const limit = createLimiter(Math.max(1, env.checkConcurrency));
  const outcomes = await Promise.all(due.map((monitor) => limit(() => runSingle(monitor))));
  return outcomes.filter((o): o is CheckOutcome => o !== null);
}

async function runSingle(monitor: DueMonitor): Promise<CheckOutcome | null> {
  try {
    return await checkMonitor(monitor);
  } catch (err) {
    console.error(`[engine] check failed unexpectedly for monitor ${monitor.id}:`, err);
    return null;
  }
}
