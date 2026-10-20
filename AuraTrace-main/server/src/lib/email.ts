import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { env } from "../env.js";
import { query } from "../db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type DeliveryOutcome = {
  status: "sent" | "failed" | "skipped";
  error: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:20px 28px;border-bottom:1px solid #e2e8f0;">
                <span style="font-size:16px;font-weight:700;letter-spacing:-0.02em;color:#0f172a;">Aura<span style="color:#4f46e5;">Trace</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;">
                <p style="margin:0;font-size:12px;color:#94a3b8;">You receive this email because uptime alerts are enabled for your AuraTrace account.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function pill(label: string, color: string, bg: string): string {
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.04em;color:${color};background:${bg};text-transform:uppercase;">${escapeHtml(label)}</span>`;
}

function detailsRows(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
    ${rows
      .map(
        ([k, v]) => `<tr>
          <td style="padding:10px 14px;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;width:160px;">${escapeHtml(k)}</td>
          <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;">${escapeHtml(v)}</td>
        </tr>`,
      )
      .join("")}
  </table>`;
}

export function renderDownEmail(input: {
  monitorName: string;
  url: string;
  detectedAt: Date;
  reason: string | null;
  monitorUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `[Down] ${input.monitorName} is not responding`;
  const body = `
    <div style="margin-bottom:16px;">${pill("Down", "#991b1b", "#fee2e2")}</div>
    <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;">${escapeHtml(input.monitorName)} is down</h1>
    <p style="margin:0;font-size:14px;color:#475569;">AuraTrace detected that your monitored endpoint is no longer responding as expected.</p>
    ${detailsRows([
      ["Monitor", input.monitorName],
      ["URL", input.url],
      ["Detected", input.detectedAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")],
      ["Reason", input.reason || "Consecutive failed checks"],
    ])}
    <a href="${escapeHtml(input.monitorUrl)}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">View monitor</a>
  `;
  return { subject, html: layout(subject, body), text: `${input.monitorName} is down.\nURL: ${input.url}\nDetected: ${input.detectedAt.toISOString()}\nReason: ${input.reason || "Consecutive failed checks"}\n${input.monitorUrl}` };
}

export function renderRecoveryEmail(input: {
  monitorName: string;
  url: string;
  recoveredAt: Date;
  duration: string;
  monitorUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `[Recovered] ${input.monitorName} is back online`;
  const body = `
    <div style="margin-bottom:16px;">${pill("Recovered", "#065f46", "#d1fae5")}</div>
    <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;">${escapeHtml(input.monitorName)} is back online</h1>
    <p style="margin:0;font-size:14px;color:#475569;">Service has recovered and subsequent checks are succeeding again.</p>
    ${detailsRows([
      ["Monitor", input.monitorName],
      ["URL", input.url],
      ["Recovered", input.recoveredAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")],
      ["Downtime", input.duration],
    ])}
    <a href="${escapeHtml(input.monitorUrl)}" style="display:inline-block;padding:10px 18px;background:#059669;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">View monitor</a>
  `;
  return { subject, html: layout(subject, body), text: `${input.monitorName} recovered.\nURL: ${input.url}\nRecovered: ${input.recoveredAt.toISOString()}\nDowntime: ${input.duration}\n${input.monitorUrl}` };
}

async function deliver(payload: EmailPayload): Promise<DeliveryOutcome> {
  if (env.smtpUrl) {
    try {
      const transport = nodemailer.createTransport(env.smtpUrl, { connectionTimeout: 10_000, greetingTimeout: 10_000 });
      await transport.sendMail({ from: env.emailFrom, to: payload.to, subject: payload.subject, html: payload.html, text: payload.text });
      return { status: "sent", error: null };
    } catch (err) {
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (env.allowFileEmail && !env.isProduction) {
    try {
      const dir = path.resolve(__dirname, "../../.emails");
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${payload.to.replace(/[^a-z0-9@._-]/gi, "_")}.html`);
      await fs.writeFile(file, payload.html, "utf8");
      console.log(`[email] wrote ${payload.subject} -> ${file}`);
      return { status: "sent", error: null };
    } catch (err) {
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { status: "skipped", error: "No email transport configured (SMTP_URL is empty)" };
}

export type NotificationEvent = {
  userId: string;
  monitorId: string;
  incidentId: string | null;
  eventType: "down" | "recovery" | "test";
  monitorName: string;
  url: string;
  recipient: string | null;
  reason?: string | null;
  detectedAt?: Date;
  recoveredAt?: Date;
  duration?: string | null;
};

/**
 * Sends a notification and records the delivery attempt.
 * Returns true when an email was actually dispatched (dedupe-safe: the unique
 * index on (incident_id, event_type) guarantees one attempt per incident event).
 */
export async function sendNotification(event: NotificationEvent): Promise<boolean> {
  if (!event.recipient) {
    await query(
      `INSERT INTO notification_logs (user_id, monitor_id, incident_id, event_type, channel, status, recipient, error)
       VALUES ($1,$2,$3,$4,'email','skipped',NULL,$5)
       ON CONFLICT (incident_id, event_type) WHERE incident_id IS NOT NULL DO NOTHING`,
      [event.userId, event.monitorId, event.incidentId, event.eventType, "No notification recipient configured"],
    );
    return false;
  }

  const monitorUrl = `${env.appUrl.replace(/\/$/, "")}/monitors/${event.monitorId}`;
  const rendered =
    event.eventType === "down"
      ? renderDownEmail({
          monitorName: event.monitorName,
          url: event.url,
          detectedAt: event.detectedAt ?? new Date(),
          reason: event.reason ?? null,
          monitorUrl,
        })
      : renderRecoveryEmail({
          monitorName: event.monitorName,
          url: event.url,
          recoveredAt: event.recoveredAt ?? new Date(),
          duration: event.duration || "unknown",
          monitorUrl,
        });

  const outcome = await deliver({ to: event.recipient, subject: rendered.subject, html: rendered.html, text: rendered.text });

  const inserted = await query(
    `INSERT INTO notification_logs (user_id, monitor_id, incident_id, event_type, channel, status, recipient, error)
     VALUES ($1,$2,$3,$4,'email',$5,$6,$7)
     ON CONFLICT (incident_id, event_type) WHERE incident_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [event.userId, event.monitorId, event.incidentId, event.eventType, outcome.status, event.recipient, outcome.error],
  );
  if (inserted.length === 0) {
    console.log(`[notify] duplicate ${event.eventType} notification suppressed for incident ${event.incidentId}`);
    return false;
  }
  return outcome.status === "sent";
}
