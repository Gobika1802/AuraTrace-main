import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Gauge,
  Plus,
  Timer,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Monitor, MonitorFormData, OverviewData } from "@/lib/types";
import { formatDuration, formatRelative, formatUptime, formatMs, cn } from "@/lib/utils";
import { useToast } from "@/lib/toast";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { TableSkeleton, EmptyState, PageSkeleton } from "@/components/ui/feedback";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { Modal } from "@/components/ui/Modal";
import { MonitorForm } from "@/components/MonitorForm";
import { AvailabilityBars, ResponseTimeChart, UptimeLegend } from "@/components/charts";

export function OverviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["overview"],
    queryFn: () => api<OverviewData>("/api/overview"),
  });

  const createMonitor = useMutation({
    mutationFn: (body: MonitorFormData) => api<{ monitor: Monitor }>("/api/monitors", { method: "POST", body }),
    onSuccess: ({ monitor }) => {
      toast("success", `Monitor "${monitor.name}" added. First check runs shortly.`);
      setAddOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
    onError: (err: Error) => toast("error", err.message),
  });

  if (isLoading) return <PageSkeleton />;
  if (!data) return null;

  const { metrics, monitors, responseTrend, availability, recentIncidents } = data;

  if (!metrics.hasAnyMonitor) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <Card>
          <EmptyState
            icon={<Gauge className="h-6 w-6 text-brand-500" />}
            title="Welcome to AuraTrace"
            description="Add your first website or API endpoint to start tracking uptime, response times and incidents. Checks run automatically in the background — no browser tab required."
            action={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)} size="lg">
                Add your first monitor
              </Button>
            }
          />
        </Card>
        <AddMonitorModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          submitting={createMonitor.isPending}
          error={createMonitor.error instanceof Error ? createMonitor.error.message : null}
          onSubmit={(data) => createMonitor.mutate(data)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">System overview</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Health of all monitored endpoints in the last 24 hours.</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
          Add Monitor
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Total monitors"
          value={metrics.totalMonitors}
          sub={`${metrics.paused} paused`}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Up"
          value={metrics.up}
          tone="success"
          sub="Responding normally"
          icon={<ArrowUpRight className="h-4 w-4" />}
        />
        <StatCard
          label="Down"
          value={metrics.down}
          tone={metrics.down > 0 ? "danger" : "default"}
          sub={metrics.down > 0 ? "Needs attention" : "All clear"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <StatCard
          label="Uptime (24h)"
          value={formatUptime(metrics.overallUptime24h)}
          tone={metrics.overallUptime24h !== null && metrics.overallUptime24h >= 99.5 ? "success" : "warning"}
          sub="Average across monitors"
          icon={<Gauge className="h-4 w-4" />}
        />
        <StatCard
          label="Avg response"
          value={formatMs(metrics.avgResponseTimeMs)}
          tone="brand"
          sub="Current response times"
          icon={<Timer className="h-4 w-4" />}
        />
        <StatCard
          label="Active incidents"
          value={metrics.activeIncidents}
          tone={metrics.activeIncidents > 0 ? "danger" : "default"}
          sub={metrics.activeIncidents > 0 ? "Ongoing right now" : "No ongoing outages"}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Response time"
            description="Average response time across all monitors (30-minute buckets, last 24h)"
            actions={
              <Link to="/monitors" className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
                View monitors →
              </Link>
            }
          />
          <CardBody>
            {responseTrend.length === 0 ? (
              <EmptyState
                title="No checks yet"
                description="Response time data will appear once the first checks complete."
                className="py-10"
              />
            ) : (
              <ResponseTimeChart data={responseTrend} rangeHours={24} height={280} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent incidents" description="Latest outages and recoveries" />
          <CardBody className="p-0">
            {recentIncidents.length === 0 ? (
              <EmptyState title="No incidents" description="Downtime events will appear here." className="py-10" />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {recentIncidents.map((incident) => (
                  <li key={incident.id}>
                    <Link
                      to={`/incidents/${incident.id}`}
                      className="flex items-start gap-3 px-5 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          incident.status === "ongoing" ? "bg-rose-500 status-pulse" : "bg-emerald-500",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{incident.monitorName}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {formatRelative(incident.startedAt)} ·{" "}
                          {incident.status === "ongoing"
                            ? "ongoing"
                            : `resolved in ${formatDuration(incident.durationSeconds)}`}
                        </p>
                      </div>
                      <StatusBadge status={incident.status === "ongoing" ? "down" : "up"} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Monitor status"
          description="Current health of every monitored endpoint"
          actions={
            <Link to="/monitors" className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
              Manage all →
            </Link>
          }
        />
        {isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Website</Th>
                  <Th>Status</Th>
                  <Th>Response</Th>
                  <Th>Uptime (24h)</Th>
                  <Th>Last checked</Th>
                  <Th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {monitors.map((monitor) => (
                  <Tr key={monitor.id} onClick={() => navigate(`/monitors/${monitor.id}`)}>
                    <Td>
                      <p className="font-semibold text-slate-900 dark:text-white">{monitor.name}</p>
                      <p className="mt-0.5 max-w-[22rem] truncate text-xs text-slate-500 dark:text-slate-400">{monitor.url}</p>
                    </Td>
                    <Td>
                      <StatusBadge status={monitor.status} />
                    </Td>
                    <Td className="font-medium tabular-nums">{formatMs(monitor.lastResponseTimeMs)}</Td>
                    <Td className="font-medium tabular-nums">{formatUptime(monitor.uptime24h)}</Td>
                    <Td className="text-xs text-slate-500 dark:text-slate-400">{formatRelative(monitor.lastCheckedAt)}</Td>
                    <Td>
                      <ArrowUpRight className="h-4 w-4 text-slate-400" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="border-t border-slate-100 px-5 py-3 dark:border-slate-800/80">
              <UptimeLegend />
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Availability" description="Per-monitor uptime over the last 24 hours (hourly buckets)" />
        <CardBody className="space-y-4">
          {monitors.map((monitor) => (
            <div key={monitor.id} className="grid gap-2 sm:grid-cols-[12rem_1fr_5rem] sm:items-center">
              <Link
                to={`/monitors/${monitor.id}`}
                className="truncate text-sm font-semibold text-slate-800 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-400"
              >
                {monitor.name}
              </Link>
              <AvailabilityBars buckets={availability[monitor.id] ?? []} showLabels={false} />
              <span className="text-right text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                {formatUptime(monitor.uptime24h)}
              </span>
            </div>
          ))}
          <div className="pt-2">
            <UptimeLegend />
          </div>
        </CardBody>
      </Card>

      <AddMonitorModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        submitting={createMonitor.isPending}
        error={createMonitor.error instanceof Error ? createMonitor.error.message : null}
        onSubmit={(formData) => createMonitor.mutate(formData)}
      />
    </div>
  );
}

export function AddMonitorModal({
  open,
  onClose,
  onSubmit,
  submitting,
  error,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: MonitorFormData) => void;
  submitting?: boolean;
  error?: string | null;
  initial?: Monitor | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit monitor" : "Add monitor"}
      description={initial ? "Update configuration for this endpoint." : "Watch a public website or HTTP endpoint."}
      size="lg"
    >
      <MonitorForm initial={initial} submitting={submitting} submitError={error} onSubmit={onSubmit} onCancel={onClose} />
    </Modal>
  );
}
