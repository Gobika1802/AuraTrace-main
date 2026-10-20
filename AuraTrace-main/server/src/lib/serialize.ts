export type MonitorRow = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  type: string;
  interval_seconds: number;
  timeout_ms: number;
  expected_status: number | null;
  failure_threshold: number;
  recovery_threshold: number;
  active: boolean;
  status: "pending" | "up" | "down";
  last_checked_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_response_time_ms: number | null;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export function serializeMonitor(row: MonitorRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    type: row.type,
    intervalSeconds: row.interval_seconds,
    timeoutMs: row.timeout_ms,
    expectedStatus: row.expected_status,
    failureThreshold: row.failure_threshold,
    recoveryThreshold: row.recovery_threshold,
    active: row.active,
    status: row.active ? row.status : "paused",
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastResponseTimeMs: row.last_response_time_ms,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type IncidentRow = {
  id: string;
  monitor_id: string;
  user_id: string;
  title: string;
  started_at: string;
  recovered_at: string | null;
  duration_seconds: number | null;
  status: "ongoing" | "resolved";
  failure_reason: string | null;
  monitor_name?: string;
  monitor_url?: string;
};

export function serializeIncident(row: IncidentRow) {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    monitorName: row.monitor_name ?? null,
    monitorUrl: row.monitor_url ?? null,
    title: row.title,
    startedAt: row.started_at,
    recoveredAt: row.recovered_at,
    durationSeconds: row.duration_seconds,
    status: row.status,
    failureReason: row.failure_reason,
  };
}
