import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "../env.js";

export type SsrfVerdict = {
  ok: true;
  url: URL;
  hostname: string;
  port: number;
  addresses: { address: string; family: number }[];
};

export class SsrfError extends Error {
  constructor(
    message: string,
    readonly code: string = "blocked",
  ) {
    super(message);
    this.name = "SsrfError";
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    num = (num << 8) | octet;
  }
  return num >>> 0;
}

const IPV4_BLOCK_RANGES: [string, string, string][] = [
  ["0.0.0.0", "0.255.255.255", "this-network"],
  ["10.0.0.0", "10.255.255.255", "private"],
  ["100.64.0.0", "100.127.255.255", "carrier-grade NAT"],
  ["127.0.0.0", "127.255.255.255", "loopback"],
  ["169.254.0.0", "169.254.255.255", "link-local / cloud metadata"],
  ["172.16.0.0", "172.31.255.255", "private"],
  ["192.0.0.0", "192.0.0.255", "IETF protocol assignments"],
  ["192.0.2.0", "192.0.2.255", "documentation"],
  ["192.88.99.0", "192.88.99.255", "6to4 relay anycast"],
  ["192.168.0.0", "192.168.255.255", "private"],
  ["198.18.0.0", "198.19.255.255", "benchmarking"],
  ["198.51.100.0", "198.51.100.255", "documentation"],
  ["203.0.113.0", "203.0.113.255", "documentation"],
  ["224.0.0.0", "239.255.255.255", "multicast"],
  ["240.0.0.0", "255.255.255.254", "reserved"],
  ["255.255.255.255", "255.255.255.255", "broadcast"],
];

export function classifyIPv4(ip: string): string | null {
  const num = ipv4ToInt(ip);
  if (num === null) return "invalid IPv4 address";
  for (const [start, end, label] of IPV4_BLOCK_RANGES) {
    const s = ipv4ToInt(start)!;
    const e = ipv4ToInt(end)!;
    if (num >= s && num <= e) return label;
  }
  return null;
}

export function classifyIPv6(ip: string): string | null {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.includes("%")) return "scoped IPv6 address";
  if (normalized.startsWith("::ffff:")) {
    const inner = normalized.slice(7);
    if (isIP(inner) === 4) return classifyIPv4(inner);
    return "invalid IPv4-mapped address";
  }
  if (normalized.startsWith("64:ff9b:")) {
    const tail = normalized.split(":").slice(4).join(":");
    if (isIP(tail) === 4) return classifyIPv4(tail) ?? "NAT64 prefix";
  }
  if (normalized === "::" || normalized === "::1") return normalized === "::1" ? "loopback" : "unspecified";
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return "unique local address";
  if (/^fe[89ab]/.test(normalized)) return "link-local address";
  if (normalized.startsWith("ff")) return "multicast address";
  if (normalized.startsWith("2001:db8") || normalized.startsWith("2001:0db8")) return "documentation address";
  if (normalized.startsWith("2001:0000:") || normalized.startsWith("2001:0:")) return "Teredo tunnel address";
  if (normalized.startsWith("2002:")) {
    const parts = normalized.split(":");
    const b = Number.parseInt(parts[2] ?? "0", 16);
    const embedded = `${Number.parseInt(parts[1] ?? "0", 16)}.${b >> 8}.${b & 0xff}.${Number.parseInt(parts[3] ?? "0", 16) >> 8}`;
    const v4 = ipv4ToInt(embedded);
    if (v4 !== null && classifyIPv4(embedded)) return "6to4 embedded private address";
  }
  return null;
}

export function classifyIp(ip: string): string | null {
  const family = isIP(ip);
  if (family === 4) return classifyIPv4(ip);
  if (family === 6) return classifyIPv6(ip);
  return "not a valid IP address";
}

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".in-addr.arpa",
  ".ip6.arpa",
  ".localdomain",
];
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

export function assertSafeHostname(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfError(`Access to "${hostname}" is not allowed`, "blocked-hostname");
  }
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (host.endsWith(suffix)) {
      throw new SsrfError(`Access to "${hostname}" is not allowed`, "blocked-hostname");
    }
  }
  if (!host.includes(".") && isIP(host) === 0) {
    throw new SsrfError("Only fully-qualified domain names can be monitored", "invalid-hostname");
  }
}

export function parseAndValidateMonitorUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("Invalid URL", "invalid-url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("Only http:// and https:// URLs are supported", "invalid-protocol");
  }
  if (url.username || url.password) {
    throw new SsrfError("URLs with embedded credentials are not allowed", "credentials");
  }
  if (!url.hostname) {
    throw new SsrfError("URL must include a hostname", "invalid-url");
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!env.allowedPorts.includes(port)) {
    throw new SsrfError(
      `Port ${port} is not allowed. Allowed ports: ${env.allowedPorts.join(", ")}`,
      "blocked-port",
    );
  }
  assertSafeHostname(url.hostname);
  if (isIP(url.hostname) !== 0) {
    const reason = classifyIp(url.hostname);
    if (reason) throw new SsrfError(`Access to this address is not allowed (${reason})`, "blocked-ip");
  }
  return url;
}

export async function resolveAndValidate(hostname: string): Promise<SsrfVerdict["addresses"]> {
  if (isIP(hostname) !== 0) {
    return [{ address: hostname, family: isIP(hostname) }];
  }
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(`Could not resolve hostname "${hostname}"`, "dns");
  }
  if (!addresses.length) {
    throw new SsrfError(`Could not resolve hostname "${hostname}"`, "dns");
  }
  for (const entry of addresses) {
    const reason = classifyIp(entry.address);
    if (reason) {
      throw new SsrfError(
        `Hostname "${hostname}" resolves to a restricted address (${reason})`,
        "blocked-ip",
      );
    }
  }
  return addresses;
}

/**
 * Full validation: URL syntax + DNS resolution with all resulting addresses checked.
 * Returns the validated URL, hostname, port and resolved addresses (for IP pinning).
 */
export async function validateMonitorUrl(rawUrl: string): Promise<SsrfVerdict> {
  const url = parseAndValidateMonitorUrl(rawUrl);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const addresses = await resolveAndValidate(url.hostname);
  return { ok: true, url, hostname: url.hostname, port, addresses };
}
