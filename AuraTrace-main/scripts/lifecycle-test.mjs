/**
 * AuraTrace end-to-end lifecycle test.
 * Verifies: auth, SSRF rejection, monitoring -> UP, failure -> DOWN + single
 * incident + single down notification, recovery -> resolved + recovery
 * notification, paused monitors not checked, cross-user isolation,
 * duplicate prevention, and public status page sanitization.
 *
 * Usage: node scripts/lifecycle-test.mjs   (API must be running on :3001)
 */
const BASE = process.env.API_URL || "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function client() {
  let cookie = null;
  return async (path, options = {}) => {
    const { body, ...rest } = options;
    const res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(options.headers || {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) {
      if (c.startsWith("auratrace_session=")) cookie = c.split(";")[0];
    }
    let parsed = null;
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed };
  };
}

async function waitFor(fn, timeoutMs, everyMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(everyMs);
  }
  return null;
}

const stamp = Date.now();
const api = client();
const other = client();

console.log("\n== 1. Authentication ==");
{
  const reg = await api("/auth/register", {
    method: "POST",
    body: { name: "Test User", email: `lifecycle-${stamp}@auratrace.dev`, password: "password123" },
  });
  check("register creates session", reg.status === 201 && reg.body?.user?.id, `status=${reg.status}`);

  const me = await api("/auth/me");
  check("session cookie authenticates", me.status === 200 && me.body?.user?.email?.includes("lifecycle-"));

  const badLogin = await api("/auth/login", { method: "POST", body: { email: `lifecycle-${stamp}@auratrace.dev`, password: "wrongpass1" } });
  check("wrong password rejected", badLogin.status === 401);

  const noAuth = await fetch(`${BASE}/api/monitors`);
  check("protected routes require auth", noAuth.status === 401);
}

console.log("\n== 2. SSRF / URL safety ==");
{
  const unsafe = [
    ["http://localhost:3001", "localhost hostname"],
    ["http://127.0.0.1", "loopback IP"],
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata IP"],
    ["http://192.168.1.10", "private range"],
    ["http://10.0.0.5/health", "private range 10/8"],
    ["ftp://example.com", "unsupported protocol"],
  ];
  for (const [url, label] of unsafe) {
    const res = await api("/api/monitors", {
      method: "POST",
      body: { name: `unsafe-${stamp}`, url, intervalSeconds: 60 },
    });
    check(`rejects ${label}`, res.status === 400, `status=${res.status} msg=${res.body?.error || ""}`);
  }
}

console.log("\n== 3. Monitor creation ==");
const healthy = await api("/api/monitors", {
  method: "POST",
  body: {
    name: `Healthy site ${stamp}`,
    url: "https://example.com",
    intervalSeconds: 10,
    timeoutMs: 15000,
    failureThreshold: 2,
    recoveryThreshold: 1,
  },
});
check("creates healthy monitor", healthy.status === 201 && healthy.body?.monitor?.id, `status=${healthy.status}`);
const healthyId = healthy.body?.monitor?.id;

const broken = await api("/api/monitors", {
  method: "POST",
  body: {
    name: `Broken site ${stamp}`,
    url: "https://nonexistent-domain-xyz-12345.invalid",
    intervalSeconds: 10,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
  },
});
check("creates failing monitor", broken.status === 201 && broken.body?.monitor?.id);
const brokenId = broken.body?.monitor?.id;

const dup = await api("/api/monitors", {
  method: "POST",
  body: { name: `Duplicate ${stamp}`, url: "https://example.com", intervalSeconds: 60 },
});
check("rejects duplicate URL", dup.status === 409, `status=${dup.status}`);

const invalid = await api("/api/monitors", {
  method: "POST",
  body: { name: "Bad interval", url: "https://example.org", intervalSeconds: 2 },
});
check("validates interval bounds", invalid.status === 400);

console.log("\n== 4. Healthy monitor becomes UP ==");
{
  const up = await waitFor(async () => {
    const res = await api(`/api/monitors/${healthyId}`);
    return res.body?.monitor?.status === "up" ? res.body.monitor : null;
  }, 30000);
  check("healthy website marked UP", !!up, up ? `response=${up.lastResponseTimeMs}ms code=${up.lastStatusCode}` : "timeout");
}

console.log("\n== 5. Failing monitor becomes DOWN with one incident ==");
{
  const down = await waitFor(async () => {
    const res = await api(`/api/monitors/${brokenId}`);
    return res.body?.monitor?.status === "down" ? res.body.monitor : null;
  }, 60000, 3000);
  check("unavailable website marked DOWN", !!down, down?.lastError || "timeout waiting for down");
  check("failure reason recorded", !!down?.lastError, down?.lastError || "");

  // Let a few more failing checks pass — incident count must stay at 1.
  await sleep(25000);
  const incidents = await api(`/api/monitors/${brokenId}/incidents`);
  check("exactly one incident per outage", incidents.body?.incidents?.length === 1, `count=${incidents.body?.incidents?.length}`);
  check("incident is ongoing", incidents.body?.incidents?.[0]?.status === "ongoing");

  const logs = await api("/api/settings/notifications");
  const downLogs = (logs.body?.logs || []).filter((l) => l.eventType === "down" && l.monitorName?.includes("Broken"));
  check("one down notification logged", downLogs.length === 1, `count=${downLogs.length} status=${downLogs[0]?.status}`);
  check("notification delivery recorded", downLogs[0]?.status === "sent" || downLogs[0]?.status === "skipped", downLogs[0]?.error || downLogs[0]?.status);
}

console.log("\n== 6. Recovery closes the incident ==");
{
  const patched = await api(`/api/monitors/${brokenId}`, {
    method: "PATCH",
    body: { name: `Recovered site ${stamp}`, url: "https://example.org", failureThreshold: 2, recoveryThreshold: 1 },
  });
  check("monitor url updated", patched.status === 200);

  const resolved = await waitFor(async () => {
    const res = await api(`/api/monitors/${brokenId}/incidents`);
    const inc = res.body?.incidents?.[0];
    return inc?.status === "resolved" ? inc : null;
  }, 60000, 3000);
  check("recovery resolves the incident", !!resolved, resolved ? `duration=${resolved.durationSeconds}s` : "timeout");
  check("incident has recovery time", !!resolved?.recoveredAt);
  check("incident has duration", (resolved?.durationSeconds ?? 0) > 0);

  const up = await waitFor(async () => {
    const res = await api(`/api/monitors/${brokenId}`);
    return res.body?.monitor?.status === "up" ? res.body.monitor : null;
  }, 30000);
  check("recovered monitor marked UP", !!up);

  const logs = await api("/api/settings/notifications");
  const recoveryLogs = (logs.body?.logs || []).filter((l) => l.eventType === "recovery");
  check("exactly one recovery notification", recoveryLogs.length === 1, `count=${recoveryLogs.length}`);
}

console.log("\n== 7. Paused monitors are not checked ==");
{
  await api(`/api/monitors/${healthyId}/pause`, { method: "POST" });
  await sleep(1000);
  const before = await api(`/api/monitors/${healthyId}/checks?range=24h&limit=500`);
  const beforeCount = before.body?.checks?.length ?? 0;
  await sleep(15000);
  const after = await api(`/api/monitors/${healthyId}/checks?range=24h&limit=500`);
  const afterCount = after.body?.checks?.length ?? 0;
  check("paused monitor gets no new checks", afterCount === beforeCount, `${beforeCount} -> ${afterCount}`);
  const mon = await api(`/api/monitors/${healthyId}`);
  check("paused monitor status shows paused", mon.body?.monitor?.status === "paused");
  await api(`/api/monitors/${healthyId}/resume`, { method: "POST" });
}

console.log("\n== 8. Uptime & analytics ==");
{
  const uptime = await api(`/api/monitors/${healthyId}/uptime?range=24h`);
  check("uptime endpoint returns stats", uptime.status === 200 && typeof uptime.body?.stats?.uptime === "number", `uptime=${uptime.body?.stats?.uptime}`);
  check("uptime series has data", (uptime.body?.series?.length ?? 0) > 0);
  check("availability timeline present", (uptime.body?.timeline?.length ?? 0) > 0);

  const overview = await api("/api/overview");
  check("overview returns metrics", overview.status === 200 && overview.body?.metrics?.totalMonitors >= 2, `total=${overview.body?.metrics?.totalMonitors}`);
}

console.log("\n== 9. Status pages ==");
{
  const page = await api("/api/status-pages", {
    method: "POST",
    body: { title: `Status ${stamp}`, description: "Public health", monitorIds: [healthyId], slug: `auratrace-test-${stamp}` },
  });
  check("creates status page", page.status === 201 && page.body?.statusPage?.slug, `status=${page.status}`);

  const pub = await fetch(`${BASE}/api/public/status/auratrace-test-${stamp}`);
  const pubBody = await pub.json();
  check("public endpoint is unauthenticated", pub.status === 200);
  check("public page lists selected service", pubBody?.statusPage?.services?.length === 1);
  const serialized = JSON.stringify(pubBody);
  check("public page hides monitor URL/config", !serialized.includes("intervalSeconds") && !serialized.includes("timeoutMs"));
  check("public page hides user email", !serialized.includes(`lifecycle-${stamp}`));
}

console.log("\n== 10. Cross-user isolation ==");
{
  const reg = await other("/auth/register", {
    method: "POST",
    body: { name: "Other User", email: `other-${stamp}@auratrace.dev`, password: "password123" },
  });
  check("second user registers", reg.status === 201);

  const list = await other("/api/monitors");
  check("other user sees no monitors", (list.body?.monitors?.length ?? 0) === 0, `count=${list.body?.monitors?.length}`);

  const detail = await other(`/api/monitors/${healthyId}`);
  check("other user cannot read monitor", detail.status === 404);

  const patch = await other(`/api/monitors/${healthyId}`, { method: "PATCH", body: { name: "hacked" } });
  check("other user cannot edit monitor", patch.status === 404);

  const del = await other(`/api/monitors/${healthyId}`, { method: "DELETE" });
  check("other user cannot delete monitor", del.status === 404);

  const inc = await other("/api/incidents");
  check("other user sees no incidents", (inc.body?.incidents?.length ?? 0) === 0);
}

console.log("\n== 11. Timeout detection ==");
{
  const slow = await api("/api/monitors", {
    method: "POST",
    body: {
      name: `Slow endpoint ${stamp}`,
      url: "https://httpbingo.org/delay/5",
      intervalSeconds: 10,
      timeoutMs: 2000,
      failureThreshold: 1,
      recoveryThreshold: 1,
    },
  });
  check("creates slow monitor", slow.status === 201 && slow.body?.monitor?.id, `status=${slow.status}`);
  const slowId = slow.body?.monitor?.id;
  if (slowId) {
    const timedOut = await waitFor(async () => {
      const res = await api(`/api/monitors/${slowId}/checks?range=24h&limit=5`);
      return res.body?.checks?.[0]?.errorType === "timeout" ? res.body.checks[0] : null;
  }, 30000, 2000);
    check("slow response triggers timeout", !!timedOut, timedOut ? `${timedOut.responseTimeMs}ms` : "no timeout check observed");
    await api(`/api/monitors/${slowId}`, { method: "DELETE" });
  }
}

console.log("\n== 12. Cleanup ==");
{
  const del = await api(`/api/monitors/${brokenId}`, { method: "DELETE" });
  check("deletes monitor", del.status === 200);
  const gone = await api(`/api/monitors/${brokenId}`);
  check("deleted monitor returns 404", gone.status === 404);
}

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
