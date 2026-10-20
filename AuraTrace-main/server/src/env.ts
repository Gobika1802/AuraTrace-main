import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

function loadEnvFile(): void {
  const candidates = [process.env.ENV_FILE, path.join(rootDir, ".env")].filter(Boolean) as string[];
  for (const file of candidates) {
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      /* missing or unreadable env file is fine */
    }
  }
}

loadEnvFile();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  port: num("PORT", 3001),
  appUrl: process.env.APP_URL || "http://localhost:5173",
  nodeEnv: process.env.NODE_ENV || "development",
  get isProduction() {
    return this.nodeEnv === "production";
  },
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  workerEnabled: bool("WORKER_ENABLED", true),
  schedulerTickSeconds: num("SCHEDULER_TICK_SECONDS", 10),
  checkConcurrency: num("CHECK_CONCURRENCY", 10),
  allowedPorts: (process.env.ALLOWED_PORTS || "80,443,8080,8443")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535),
  smtpUrl: process.env.SMTP_URL || "",
  emailFrom: process.env.EMAIL_FROM || "AuraTrace <no-reply@auratrace.local>",
  allowFileEmail: bool("ALLOW_FILE_EMAIL", false),
  sessionDays: num("SESSION_DAYS", 30),
};
