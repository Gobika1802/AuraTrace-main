import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns";
import { SsrfError, validateMonitorUrl } from "./ssrf.js";

export type CheckResult = {
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  error: string | null;
  errorType: "http_status" | "timeout" | "connection" | "dns" | "tls" | "blocked" | "internal" | null;
  finalUrl: string;
  redirects: number;
};

export type CheckOptions = {
  url: string;
  timeoutMs: number;
  expectedStatus: number | null;
  maxRedirects?: number;
};

const MAX_RESPONSE_BYTES = 64 * 1024;

function singleLookup(hostname: string, address: string, family: number) {
  return (
    _hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address?: string | number, family?: number) => void,
  ) => {
    if (typeof options === "function") {
      callback = options as typeof callback;
    }
    if (family === 6 && !address.includes(":")) {
      callback(Object.assign(new Error("Address family mismatch"), { code: "EAFNOSUPPORT" }));
      return;
    }
    callback(null, address, family);
  };
}

function performRequest(
  target: URL,
  pinned: { address: string; family: number },
  timeoutMs: number,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "GET",
        setHost: false,
        headers: {
          Host: target.host,
          "User-Agent": "AuraTrace-Monitor/1.0 (+https://auratrace.local)",
          Accept: "*/*",
          "Accept-Encoding": "identity",
          Connection: "close",
        },
        lookup: dnsLookup as never,
        servername: isHttps ? target.hostname : undefined,
        timeout: timeoutMs,
      } as https.RequestOptions,
    );

    // Pin the connection to the pre-validated IP to prevent DNS rebinding.
    (req as unknown as { lookup: unknown }).lookup = singleLookup(
      target.hostname,
      pinned.address,
      pinned.family,
    );

    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    };

    req.on("socket", (socket) => {
      socket.setTimeout(timeoutMs, () => {
        fail(Object.assign(new Error(`Request timed out after ${timeoutMs}ms`), { code: "ETIMEDOUT" }));
      });
    });
    req.on("timeout", () => {
      fail(Object.assign(new Error(`Request timed out after ${timeoutMs}ms`), { code: "ETIMEDOUT" }));
    });
    req.on("error", fail);
    req.on("response", (res) => {
      if (settled) return;
      settled = true;
      res.resume();
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) res.destroy();
      });
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers }));
      res.on("error", () => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers }));
      // Resolve as soon as headers arrive; body content is irrelevant for health.
      resolve({ statusCode: res.statusCode ?? 0, headers: res.headers });
    });

    req.end();
  });
}

function classifyError(err: unknown): { message: string; type: CheckResult["errorType"] } {
  if (err instanceof SsrfError) {
    return { message: err.message, type: err.code === "dns" ? "dns" : "blocked" };
  }
  const e = err as NodeJS.ErrnoException;
  const code = e?.code || "";
  const message = e?.message || String(err);
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || /timed? ?out/i.test(message)) {
    return { message, type: "timeout" };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_FAIL") {
    return { message: `DNS resolution failed: ${message}`, type: "dns" };
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "EPIPE" || code === "ECONNABORTED") {
    return { message, type: "connection" };
  }
  if (
    code.startsWith("ERR_TLS") ||
    code === "CERT_HAS_EXPIRED" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "ERR_SSL"
  ) {
    return { message: `TLS error: ${message}`, type: "tls" };
  }
  if (code === "EPROTO" || /certificate|ssl|tls/i.test(message)) {
    return { message: `TLS error: ${message}`, type: "tls" };
  }
  return { message: message || "Unknown error", type: "internal" };
}

function isSuccessStatus(statusCode: number, expected: number | null): boolean {
  if (expected !== null) return statusCode === expected;
  return statusCode >= 200 && statusCode < 400;
}

/**
 * Executes a single monitored HTTP check with SSRF-safe URL resolution,
 * IP pinning, redirect revalidation, timeouts and result classification.
 */
export async function runCheck(options: CheckOptions): Promise<CheckResult> {
  const startedAt = process.hrtime.bigint();
  const maxRedirects = options.maxRedirects ?? 3;
  let currentUrl = options.url;
  let redirects = 0;

  try {
    for (;;) {
      const verdict = await validateMonitorUrl(currentUrl);
      const primary = verdict.addresses[0];
      const response = await performRequest(verdict.url, primary, options.timeoutMs);
      const responseTimeMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      const location = response.headers.location;
      if (location && response.statusCode >= 300 && response.statusCode < 400) {
        if (redirects >= maxRedirects) {
          return {
            success: false,
            statusCode: response.statusCode,
            responseTimeMs: Math.round(responseTimeMs),
            error: `Too many redirects (limit ${maxRedirects})`,
            errorType: "connection",
            finalUrl: currentUrl,
            redirects,
          };
        }
        let next: URL;
        try {
          next = new URL(location, currentUrl);
        } catch {
          return {
            success: false,
            statusCode: response.statusCode,
            responseTimeMs: Math.round(responseTimeMs),
            error: `Redirected to an invalid URL: ${location}`,
            errorType: "connection",
            finalUrl: currentUrl,
            redirects,
          };
        }
        currentUrl = next.toString();
        redirects += 1;
        continue;
      }

      const ok = isSuccessStatus(response.statusCode, options.expectedStatus);
      return {
        success: ok,
        statusCode: response.statusCode,
        responseTimeMs: Math.round(responseTimeMs),
        error: ok
          ? null
          : options.expectedStatus !== null
            ? `Expected HTTP ${options.expectedStatus} but received HTTP ${response.statusCode}`
            : `Unexpected HTTP status ${response.statusCode}`,
        errorType: ok ? null : "http_status",
        finalUrl: currentUrl,
        redirects,
      };
    }
  } catch (err) {
    const responseTimeMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    const { message, type } = classifyError(err);
    return {
      success: false,
      statusCode: null,
      responseTimeMs,
      error: message,
      errorType: type,
      finalUrl: currentUrl,
      redirects,
    };
  }
}
