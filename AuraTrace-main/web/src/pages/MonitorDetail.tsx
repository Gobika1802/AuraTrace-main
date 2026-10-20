import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Gauge,
  Pause,
  Pencil,
  Play,
  Timer,
  Trash2,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Check, Incident, Monitor, MonitorFormData, UptimeStats } from "@/lib/types";
import { formatDate, formatDuration, formatMs, formatRelative, formatUptime, cn } from "@/lib/utils";
import { useToast } from "@/lib/toast";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, PageSkeleton, Tooltip } from "@/components/ui/feedback";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { AvailabilityBars, ResponseTimeChart, UptimeLegend } from "@/components/charts";
import { AddMonitorModal } from "@/pages/Overview";

const RANGES = [
  { key: "24h", label: "Last 24 hours" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

export function MonitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [range, setRange] = useState<RangeKey>("24h");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const monitorQuery = useQuery({
    queryKey: ["monitor", id],
    queryFn: () => api<{ monitor: Monitor }>(`/api/monitors/${id}`),
    enabled: !!id,
  });

  const uptimeQuery = useQuery({
    queryKey: ["monitor-uptime", id, range],
    queryFn: () => api<UptimeStats>(`/api/monitors/${id}/uptime?range=${range}`),
    enabled: !!id,
  });

  const checksQuery = useQuery({
    queryKey: ["monitor-checks", id, range],
    queryFn: () => api<{ checks: Check[] }>(`/api/monitors/${id}/checks?range=${range}&limit=100`),
    enabled: !!id,
  });

  const incidentsQuery = useQuery({
    queryKey: ["monitor-incidents", id],
    queryFn: () => api<{ incidents: Incident[] }>(`/api/monitors/${id}/incidents`),
    enabled: !!id,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["monitor", id] });
    void queryClient.invalidateQueries({ queryKey: ["monitor-uptime", id] });
    void queryClient.invalidateQueries({ queryKey: ["monitor-incidents", id] });
    void queryClient.invalidateQueries({ queryKey: ["monitors"] });
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
  };

  const onError = (err: Error) => toast("error", err.message);

  const toggle = useMutation({
    mutationFn: (action: "pause" | "resume") => api(`/api/monitors/${id}/${action}`, { method: "POST" }),
    onSuccess: (_d, action) => {
      toast("success", action === "pause" ? "Monitoring paused." : "Monitoring resumed.");
      invalidate();
    },
    onError,
  });

  const update = useMutation({
    mutationFn: (body: Partial<MonitorFormData>) => api(`/api/monitors/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      toast("success", "Monitor updated.");
      setEditOpen(false);
      invalidate();
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/monitors/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast("success", "Monitor deleted.");
      navigate("/monitors");
    },
    onError,
  });

  if (monitorQuery.isLoading) return <PageSkeleton />;
  if (monitorQuery.error || !monitorQuery.data) {
    return (
      <Card>
        <EmptyState
          title="Monitor not found"
          description="This monitor does not exist or you do not have access to it."
          action={<Button variant="secondary" onClick={() => navigate("/monitors")}>Back to monitors</Button>}
        />
      </Card>
    );
  }

  const monitor = monitorQuery.data.monitor;
  const stats = uptimeQuery.data?.stats;
  const checks = checksQuery.data?.checks ?? [];
  const incidents = incidentsQuery.data?.incidents ?? [];
  const rangeHours = RANGES.find((r) => r.key === range)!.key === "24h" ? 24 : range === "7d" ? 168 : 720;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/monitors"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to monitors
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{monitor.name}</h2>
            <StatusBadge status={monitor.status} />
          </div>
          <a
            href={monitor.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
          >
            {monitor.url} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={monitor.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} loading={toggle.isPending} onClick={() => toggle.mutate(monitor.active ? "pause" : "resume")}>
            {monitor.active ? "Pause" : "Resume"}
          </Button>
          <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button variant="danger-ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Current response"
          value={formatMs(monitor.lastResponseTimeMs)}
          tone="brand"
          sub={monitor.lastStatusCode ? `HTTP ${monitor.lastStatusCode}` : "No response recorded"}
          icon={<Timer className="h-4 w-4" />}
        />
        <StatCard
          label={`Uptime (${range === "24h" ? "24h" : range === "7d" ? "7d" : "30d"})`}
          value={formatUptime(stats?.uptime)}
          tone={stats?.uptime !== null && stats?.uptime !== undefined && stats.uptime >= 99.5 ? "success" : stats?.hasData ? "warning" : "default"}
          sub={stats?.hasData ? `${stats.totalChecks} checks · successful ÷ total` : "No data yet"}
          icon={
            <Tooltip label="Successful checks ÷ total checks in this range. Missing data is not counted as uptime.">
              <Clock className="h-4 w-4" />
            </Tooltip>
          }
        />
        <StatCard
          label="Last successful check"
          value={formatRelative(monitor.lastSuccessAt)}
          sub={formatDate(monitor.lastSuccessAt)}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <StatCard
          label="Incidents"
          value={stats?.incidentCount ?? incidents.length}
          tone={(stats?.incidentCount ?? 0) > 0 ? "danger" : "default"}
          sub={stats?.hasData ? `${stats.downtimeLabel} downtime` : "No downtime recorded"}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      {monitor.lastError && monitor.status === "down" && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <span className="font-semibold">Last error:</span> {monitor.lastError}
        </div>
      )}

      <Card>
        <CardHeader
          title="Response time"
          description={`Average and maximum response time · ${RANGES.find((r) => r.key === range)?.label}`}
          actions={
            <Select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className="w-40" aria-label="Select time range">
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </Select>
          }
        />
        <CardBody>
          {uptimeQuery.isLoading ? (
            <div className="skeleton h-[260px] rounded-lg" />
          ) : (uptimeQuery.data?.series.length ?? 0) === 0 ? (
            <EmptyState
              title="No monitoring data for this period"
              description="Once checks complete, response-time history will appear here."
              className="py-10"
            />
          ) : (
            <ResponseTimeChart data={uptimeQuery.data!.series} rangeHours={rangeHours} height={280} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Availability timeline" description="Uptime per bucket across the selected range" />
        <CardBody className="space-y-3">
          {uptimeQuery.isLoading ? (
            <div className="skeleton h-10 rounded-lg" />
          ) : (uptimeQuery.data?.timeline.length ?? 0) === 0 ? (
            <EmptyState title="No availability data" description="Timeline will fill in as checks are recorded." className="py-8" />
          ) : (
            <>
              <AvailabilityBars buckets={uptimeQuery.data!.timeline} height="h-8" />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <UptimeLegend />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {stats?.hasData
                    ? `Avg ${formatMs(stats.avgResponseTimeMs)} · Min ${formatMs(stats.minResponseTimeMs)} · Max ${formatMs(stats.maxResponseTimeMs)}`
                    : "No checks recorded in this period."}
                </p>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recent checks" description="Latest recorded check results (up to 100)" />
          {checksQuery.isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton h-8 rounded" />
              ))}
            </div>
          ) : checks.length === 0 ? (
            <EmptyState title="No checks yet" description="Checks appear here as the scheduler runs." className="py-10" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Result</Th>
                  <Th>Status</Th>
                  <Th>Response</Th>
                  <Th className="hidden lg:table-cell">Error</Th>
                </tr>
              </thead>
              <tbody>
                {checks.slice(0, 25).map((check) => (
                  <Tr key={check.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDate(check.checkedAt)}</Td>
                    <Td>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 text-xs font-semibold",
                          check.success ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {check.success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                        {check.success ? "Success" : "Failed"}
                      </span>
                    </Td>
                    <Td className="text-xs tabular-nums">{check.statusCode ? `HTTP ${check.statusCode}` : "—"}</Td>
                    <Td className="text-xs font-medium tabular-nums">{formatMs(check.responseTimeMs)}</Td>
                    <Td className="hidden max-w-[18rem] truncate text-xs text-slate-500 lg:table-cell dark:text-slate-400">
                      {check.error ?? "—"}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Configuration" />
            <CardBody className="space-y-3 text-sm">
              <ConfigRow label="Type" value={monitor.type.toUpperCase()} />
              <ConfigRow label="Check interval" value={`Every ${monitor.intervalSeconds >= 60 ? `${monitor.intervalSeconds / 60} min` : `${monitor.intervalSeconds}s`}`} />
              <ConfigRow label="Timeout" value={`${monitor.timeoutMs} ms`} />
              <ConfigRow label="Expected status" value={monitor.expectedStatus ? `HTTP ${monitor.expectedStatus}` : "Any 2xx/3xx"} />
              <ConfigRow label="Failure threshold" value={`${monitor.failureThreshold} consecutive failures`} />
              <ConfigRow label="Recovery threshold" value={`${monitor.recoveryThreshold} consecutive successes`} />
              <ConfigRow label="Created" value={formatDate(monitor.createdAt)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Incidents" description="Outages recorded for this monitor" />
            <CardBody className="p-0">
              {incidents.length === 0 ? (
                <EmptyState title="No incidents" description="This monitor has not gone down." className="py-8" />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {incidents.slice(0, 8).map((incident) => (
                    <li key={incident.id}>
                      <Link
                        to={`/incidents/${incident.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{formatDate(incident.startedAt)}</p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {incident.status === "ongoing"
                              ? "Ongoing"
                              : `Duration ${formatDuration(incident.durationSeconds)}`}
                          </p>
                        </div>
                        <Badge tone={incident.status === "ongoing" ? "danger" : "success"}>
                          {incident.status === "ongoing" ? "Ongoing" : "Resolved"}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <AddMonitorModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={monitor}
        submitting={update.isPending}
        error={update.error instanceof Error ? update.error.message : null}
        onSubmit={(formData) => update.mutate(formData)}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        danger
        title="Delete monitor?"
        confirmLabel="Delete"
        message={
          <>
            <strong>{monitor.name}</strong>, its check history, incidents and analytics will be permanently deleted.
          </>
        }
      />
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}
