import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import type { Check, Incident } from "@/lib/types";
import { formatDate, formatDuration, formatRelative, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Select, Input } from "@/components/ui/form";
import { EmptyState, TableSkeleton } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/Modal";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";

type StatusFilter = "all" | "ongoing" | "resolved";

export function IncidentsPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = (searchParams.get("status") as StatusFilter) || "all";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(new Date(to).setHours(23, 59, 59, 999)).toISOString());
  const queryString = params.toString();

  const { data, isLoading } = useQuery({
    queryKey: ["incidents", status, from, to],
    queryFn: () => api<{ incidents: Incident[] }>(`/api/incidents${queryString ? `?${queryString}` : ""}`),
  });

  const detail = useQuery({
    queryKey: ["incident", id],
    queryFn: () => api<{ incident: Incident; checks: Check[] }>(`/api/incidents/${id}`),
    enabled: !!id,
  });

  const setStatus = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    setSearchParams(next);
  };

  const incidents = data?.incidents ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Incidents</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Detected outages and their recovery status.</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Filter incidents">
            <option value="all">All incidents</option>
            <option value="ongoing">Ongoing</option>
            <option value="resolved">Resolved</option>
          </Select>
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From date" />
            <span className="text-xs text-slate-400">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To date" />
          </div>
          {(from || to) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              Clear dates
            </Button>
          )}
        </div>

        {isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : incidents.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6 text-emerald-500" />}
            title="No incidents"
            description={
              status === "ongoing"
                ? "No ongoing outages — all monitored services are healthy."
                : "When a monitor fails its checks, an incident will be recorded here automatically."
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Monitor</Th>
                <Th>State</Th>
                <Th>Started</Th>
                <Th>Recovered</Th>
                <Th>Duration</Th>
                <Th className="hidden lg:table-cell">Error</Th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <Tr key={incident.id} onClick={() => navigate(`/incidents/${incident.id}`)}>
                  <Td>
                    <p className="font-semibold text-slate-900 dark:text-white">{incident.monitorName}</p>
                    <p className="mt-0.5 max-w-[20rem] truncate text-xs text-slate-500 dark:text-slate-400">{incident.title}</p>
                  </Td>
                  <Td>
                    <Badge tone={incident.status === "ongoing" ? "danger" : "success"}>
                      {incident.status === "ongoing" ? (
                        <span className={cn("h-1.5 w-1.5 rounded-full bg-rose-500 status-pulse")} />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      {incident.status === "ongoing" ? "Ongoing" : "Resolved"}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{formatDate(incident.startedAt)}</Td>
                  <Td className="whitespace-nowrap text-xs">{incident.recoveredAt ? formatDate(incident.recoveredAt) : "—"}</Td>
                  <Td className="text-xs font-medium tabular-nums">
                    {incident.status === "ongoing"
                      ? formatDuration((Date.now() - new Date(incident.startedAt).getTime()) / 1000)
                      : formatDuration(incident.durationSeconds)}
                  </Td>
                  <Td className="hidden max-w-[16rem] truncate text-xs text-slate-500 lg:table-cell dark:text-slate-400">
                    {incident.failureReason ?? "—"}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!id}
        onClose={() => navigate("/incidents")}
        title={detail.data?.incident.title ?? "Incident"}
        description={detail.data?.incident.monitorName ?? undefined}
        size="lg"
      >
        {detail.isLoading ? (
          <div className="skeleton h-48 rounded-lg" />
        ) : detail.data ? (
          <IncidentDetail incident={detail.data.incident} checks={detail.data.checks} />
        ) : (
          <EmptyState title="Incident not found" description="It may have been deleted." />
        )}
      </Modal>
    </div>
  );
}

function IncidentDetail({ incident, checks }: { incident: Incident; checks: Check[] }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoBlock label="State" value={incident.status === "ongoing" ? "Ongoing" : "Resolved"} />
        <InfoBlock label="Monitor" value={incident.monitorName ?? "—"} link={incident.monitorId ? `/monitors/${incident.monitorId}` : undefined} />
        <InfoBlock label="Started" value={formatDate(incident.startedAt)} />
        <InfoBlock label={incident.status === "ongoing" ? "Duration (so far)" : "Recovered"} value={
          incident.status === "ongoing"
            ? formatDuration((Date.now() - new Date(incident.startedAt).getTime()) / 1000)
            : `${formatDate(incident.recoveredAt)} · ${formatDuration(incident.durationSeconds)}`
        } />
      </div>

      {incident.failureReason && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <span className="font-semibold">Failure reason:</span> {incident.failureReason}
        </div>
      )}

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Monitoring history around the incident</h4>
        {checks.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No check data recorded for this period.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <Table>
              <thead className="sticky top-0">
                <tr>
                  <Th>Time</Th>
                  <Th>Result</Th>
                  <Th>Status</Th>
                  <Th>Response</Th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <Tr key={check.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDate(check.checkedAt)}</Td>
                    <Td>
                      <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", check.success ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                        {check.success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                        {check.success ? "Success" : "Failed"}
                      </span>
                    </Td>
                    <Td className="text-xs tabular-nums">{check.statusCode ? `HTTP ${check.statusCode}` : "—"}</Td>
                    <Td className="text-xs tabular-nums">{check.responseTimeMs}ms</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Link to={`/monitors/${incident.monitorId}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
          Open monitor <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function InfoBlock({ label, value, link }: { label: string; value: string; link?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      {link ? (
        <Link to={link} className="mt-1 block text-sm font-semibold text-slate-800 hover:text-brand-600 dark:text-slate-100">
          {value}
        </Link>
      ) : (
        <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</p>
      )}
    </div>
  );
}
