export type MonitorStatus = "up" | "down" | "paused" | "pending";

export type Monitor = {
  id: string;
  name: string;
  url: string;
  type: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: number | null;
  failureThreshold: number;
  recoveryThreshold: number;
  active: boolean;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastResponseTimeMs: number | null;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  uptime24h?: number | null;
  checks24h?: number;
};

export type Incident = {
  id: string;
  monitorId: string;
  monitorName: string | null;
  monitorUrl: string | null;
  title: string;
  startedAt: string;
  recoveredAt: string | null;
  durationSeconds: number | null;
  status: "ongoing" | "resolved";
  failureReason: string | null;
};

export type Check = {
  id: number;
  checkedAt: string;
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  error: string | null;
  errorType: string | null;
};

export type UptimeStats = {
  rangeHours: number;
  stats: {
    totalChecks: number;
    successfulChecks: number;
    uptime: number | null;
    avgResponseTimeMs: number | null;
    minResponseTimeMs: number | null;
    maxResponseTimeMs: number | null;
    firstCheckAt: string | null;
    lastCheckAt: string | null;
    incidentCount: number;
    downtimeSeconds: number;
    downtimeLabel: string;
    hasData: boolean;
  };
  series: { time: string; avgResponseTimeMs: number | null; maxResponseTimeMs: number | null; uptime: number | null; checks: number }[];
  timeline: { time: string; uptime: number | null; checks: number }[];
};

export type OverviewData = {
  metrics: {
    totalMonitors: number;
    up: number;
    down: number;
    paused: number;
    overallUptime24h: number | null;
    avgResponseTimeMs: number | null;
    activeIncidents: number;
    hasAnyMonitor: boolean;
  };
  monitors: Monitor[];
  responseTrend: { time: string; avgResponseTimeMs: number | null; maxResponseTimeMs: number | null; checks: number }[];
  availability: Record<string, { time: string; uptime: number; checks: number }[]>;
  recentIncidents: Incident[];
};

export type StatusPage = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  published: boolean;
  monitorCount?: number;
  createdAt: string;
  publicUrl: string;
  monitors?: { monitorId: string; name: string; url: string; status: MonitorStatus }[];
};

export type NotificationLog = {
  id: number;
  eventType: "down" | "recovery" | "test";
  channel: string;
  status: "sent" | "failed" | "skipped";
  recipient: string | null;
  error: string | null;
  createdAt: string;
  monitorName: string | null;
  incidentTitle: string | null;
};

export type NotificationSettings = {
  emailEnabled: boolean;
  notifyDown: boolean;
  notifyRecovery: boolean;
  recipientEmail: string | null;
};

export type PublicStatusPage = {
  title: string;
  description: string | null;
  overall: "operational" | "degraded" | "down" | "paused";
  updatedAt: string;
  services: { name: string; status: MonitorStatus; uptime24h: number | null; uptime7d: number | null }[];
  incidents: { title: string; startedAt: string; message: string }[];
};

export type MonitorFormData = {
  name: string;
  url: string;
  type: "http";
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: number | null;
  failureThreshold: number;
  recoveryThreshold: number;
};
