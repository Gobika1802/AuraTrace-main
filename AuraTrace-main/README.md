# AuraTrace

A modern, production-grade **website & API uptime monitoring platform**. AuraTrace periodically checks your HTTP endpoints from a background worker, detects downtime with configurable failure confirmation, records incidents, sends email alerts, measures response times, and publishes optional public status pages.

Built as a TypeScript monorepo:

| Layer      | Technology                                                             |
| ---------- | ---------------------------------------------------------------------- |
| Frontend   | React 18, Vite, TypeScript, Tailwind CSS 4, Recharts, TanStack Query   |
| Backend    | Node.js, Hono, TypeScript, REST API, Zod validation                     |
| Database   | PostgreSQL (migrations tracked in `schema_migrations`)                  |
| Scheduler  | In-process worker or standalone monitoring worker (`FOR UPDATE SKIP LOCKED`) |
| Email      | Nodemailer over SMTP (env-configured), HTML templates, delivery logs   |

---

## Features

- **Authentication** — register / login / logout with scrypt password hashing and httpOnly cookie sessions; every private resource is scoped to its owner.
- **Overview dashboard** — total/up/down monitors, overall uptime, average response time, active incidents, response-time trend chart, per-monitor 24h availability bars, recent incidents.
- **Monitor management** — add, edit, pause/resume, delete (with confirmation), search, filter by status, sort by status/uptime/response.
- **Real monitoring engine** — server-side scheduler checks each active monitor on its configured interval with concurrency limits and timeouts. Monitoring continues while you are logged out.
- **Smart failure handling** — configurable consecutive-failure threshold before declaring DOWN (no flapping on a single blip); configurable recovery threshold before closing an incident; exactly **one incident and one notification per outage**.
- **SSRF protection** — blocks localhost, private/loopback/link-local/metadata ranges, cloud metadata endpoints, credential-embedded URLs and disallowed ports. DNS is re-resolved and every resulting address revalidated on **every check**, connections are pinned to the validated IP, and redirects are revalidated hop-by-hop.
- **Incidents** — full history with start/recovery time, duration, error reason, filters (ongoing/resolved/date range) and per-incident check history.
- **Email notifications** — downtime and recovery alerts with professional HTML templates; delivery status and errors recorded in a notification log; SMTP credentials stay server-side.
- **Analytics** — 24h/7d/30d uptime, avg/min/max response time, incident count and downtime duration, computed from real stored checks. Missing data is shown as "No data", never as fake uptime.
- **Public status pages** — pick monitors to publish, set title/description/slug; public endpoint exposes only names, statuses and aggregated uptime — never URLs, configuration, errors or account data.
- **Dark & light themes** — class-based dark mode with system preference detection and no flash of wrong theme.

---

## Project structure

```
AuraTrace/
├── server/                  # Hono API + monitoring engine
│   └── src/
│       ├── index.ts         # API entry (optionally embeds the worker, serves web/dist)
│       ├── worker.ts        # Standalone monitoring worker entry
│       ├── db/
│       │   ├── pool.ts      # Postgres pool + query helpers
│       │   ├── migrate.ts   # Migration runner
│       │   └── migrations/  # SQL migrations
│       ├── engine/          # Scheduler + check/incident state machine
│       ├── lib/             # SSRF, HTTP checker, email, auth, rate limiting
│       ├── middleware/      # Session auth middleware
│       └── routes/          # auth, monitors, incidents, overview, status pages, settings, public
├── web/                     # React SPA
│   └── src/
│       ├── components/      # UI kit, layout, charts, monitor form
│       ├── pages/           # Overview, Monitors, Detail, Incidents, Status Pages, …
│       └── lib/             # API client, auth/theme/toast providers, utils
├── scripts/
│   └── lifecycle-test.mjs   # End-to-end monitoring lifecycle test
├── .env.example
└── package.json             # Workspace root scripts
```

---

## Quick start (development)

### Prerequisites

- Node.js ≥ 20
- PostgreSQL ≥ 14 (or Supabase/Neon — any Postgres connection string works)

### 1. Install

```bash
npm install
```

### 2. Configure the environment

```bash
cp .env.example .env
# edit .env — at minimum set DATABASE_URL
```

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | — (required) |
| `PORT` | API port | `3001` |
| `APP_URL` | Public web origin (used in email links) | `http://localhost:5173` |
| `CORS_ORIGINS` | Comma-separated allowed origins (dev) | `http://localhost:5173` |
| `NODE_ENV` | `development` / `production` | `development` |
| `WORKER_ENABLED` | Run the monitor inside the API process | `true` |
| `SCHEDULER_TICK_SECONDS` | Scheduler wake-up interval | `10` |
| `CHECK_CONCURRENCY` | Max simultaneous HTTP checks | `10` |
| `ALLOWED_PORTS` | Ports monitors may target | `80,443,8080,8443` |
| `SMTP_URL` | e.g. `smtp://user:pass@smtp.example.com:587` (empty = no outbound mail) | empty |
| `EMAIL_FROM` | From header for alert emails | `AuraTrace <no-reply@…>` |
| `ALLOW_FILE_EMAIL` | Dev only: write emails to `server/.emails/` instead of sending | `false` |

> **Secrets never reach the browser.** SMTP credentials and the database URL live only in server-side environment variables.

### 3. Create the database and run migrations

```bash
createdb auratrace          # or use any existing database
npm run migrate
```

### 4. Run everything

```bash
npm run dev          # API (:3001, embedded worker) + web (:5173, proxying /api and /auth)
```

Open **http://localhost:5173**, create an account, and add your first monitor (e.g. `https://example.com`). Within a few seconds the first check is recorded and the monitor turns **Operational**.

Useful individual commands:

```bash
npm run dev:server           # API only
npm run dev:web              # web only
npm run migrate -w server    # migrations
npm run worker -w server     # standalone monitoring worker
```

---

## Running the monitoring worker separately

The scheduler can run embedded in the API process (default) or as its own service:

```bash
# terminal 1
WORKER_ENABLED=false npm run dev:server
# terminal 2
npm run worker -w server
```

Multiple workers are safe: due monitors are claimed with `FOR UPDATE SKIP LOCKED`, so each monitor is checked exactly once per interval even with several replicas.

---

## Production deployment

### Build

```bash
npm install
npm run build        # builds web/dist and server/dist
```

### Option A — single service (simplest)

The API serves the built SPA from `web/dist` and handles all `/api` + `/auth` routes:

```bash
NODE_ENV=production \
DATABASE_URL=postgres://user:pass@host:5432/auratrace \
APP_URL=https://status.yourcompany.com \
SMTP_URL=smtp://user:pass@smtp.example.com:587 \
npm start            # runs server/dist/index.js (worker embedded)
```

Point your reverse proxy (Caddy/Nginx/Cloudflare) at `PORT`. Enable TLS at the proxy.

### Option B — API + worker split

```bash
# API instances
WORKER_ENABLED=false NODE_ENV=production npm start
# Worker instances (1+)
npm run start:worker -w server
```

### Option C — separate frontend host

Deploy `web/dist` to any static host (Vercel/Netlify/S3) and the API elsewhere. Set `CORS_ORIGINS=https://app.yourcompany.com` on the API and update the fetch base if you introduce one (same-origin by default).

### Email deliverability

- Set `SMTP_URL` to your provider (Postmark, SES, Mailgun, Resend SMTP endpoints, or any generic SMTP).
- Set `EMAIL_FROM` to a verified sender.
- With SMTP unset, alerts are recorded as `skipped` in the notification log (dev file mode writes them to `server/.emails/`).

---

## Security model

- **Passwords**: scrypt with per-user salt and timing-safe comparison.
- **Sessions**: 32-byte random token stored only as a SHA-256 hash in the DB, httpOnly + SameSite=Lax cookie (Secure in production).
- **Authorization**: every query filters by the session's `user_id`; foreign keys cascade on user deletion.
- **Validation**: Zod schemas on every write endpoint; server-side bounds on intervals, timeouts and status codes.
- **Rate limiting**: in-memory fixed-window limiter on auth (10/min/IP) and monitor creation (30/min/user).
- **SSRF**: see *Features* above — syntax checks at creation, full DNS + IP revalidation on every outbound check, IP-pinned sockets, redirect revalidation, port allowlist.
- **Public status pages**: only explicitly selected monitors, only aggregated health — no URLs, configs, errors or account info.
- **CORS**: explicit origin allowlist with credentials; same-origin in production builds.

---

## How monitoring works

1. Every tick (default 10s) the scheduler claims monitors whose `interval_seconds` have elapsed (`FOR UPDATE SKIP LOCKED`).
2. Each check resolves DNS, validates every resolved IP, pins the connection to the validated address, applies the configured timeout, and classifies the result (`http_status`, `timeout`, `dns`, `connection`, `tls`, `blocked`).
3. Success criteria: the configured `expectedStatus` if set, otherwise any 2xx/3xx.
4. Results are stored in `monitor_checks`; `consecutive_failures` / `consecutive_successes` counters drive the state machine:
   - `failure_threshold` consecutive failures → monitor **DOWN** + incident created + down notification (once).
   - `recovery_threshold` consecutive successes while DOWN → monitor **UP** + incident closed with duration + recovery notification (once).
5. A unique index on `(incident_id, event_type)` guarantees at-most-once notifications even across worker restarts.

### Uptime calculation

`uptime = successful checks / total checks × 100` over the selected window, computed from stored checks. Windows with no checks report **No data** (never counted as 100% uptime). Downtime duration is the sum of incident durations overlapping the window.

---

## Testing

An end-to-end lifecycle test exercises the real API + engine + database:

```bash
# with the stack running (npm run dev)
npm run test:lifecycle
```

It verifies (46 assertions): registration/sessions, SSRF rejections (localhost, private IPs, metadata endpoint, bad protocols), monitor CRUD + validation + duplicate prevention, healthy → UP, failing → DOWN with a single incident and a single down notification, recovery closing the incident with duration and a single recovery notification, paused monitors receiving no checks, uptime analytics, public status page sanitization, cross-user isolation, and deletion.

Manual test ideas for the UI: add a monitor with a 10s interval and watch checks stream in; pause it and confirm the "last checked" time freezes; open a second browser profile with another account and confirm zero shared data.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Could not resolve host` on migrate | Check `DATABASE_URL` and that Postgres is running. |
| Alerts show `skipped` in the delivery log | Set `SMTP_URL` (and `EMAIL_FROM`), or enable `ALLOW_FILE_EMAIL=true` in dev. |
| Monitor stuck `pending` | Ensure `WORKER_ENABLED=true` or the worker process is running; check API logs for `[engine]` lines. |
| Monitor fails with `blocked` | The hostname resolved to a restricted address — expected for internal targets; only public endpoints can be monitored. |
| Port already in use | Change `PORT` or stop the process bound to 3001. |
