import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowUpDown, MoreHorizontal, Pause, Pencil, Play, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Monitor, MonitorFormData } from "@/lib/types";
import { cn, formatMs, formatRelative, formatUptime } from "@/lib/utils";
import { useToast } from "@/lib/toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState, TableSkeleton } from "@/components/ui/feedback";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { ConfirmDialog } from "@/components/ui/Modal";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { AddMonitorModal } from "@/pages/Overview";

type StatusFilter = "all" | "up" | "down" | "paused";
type SortKey = "name" | "status" | "uptime" | "response";

const STATUS_ORDER: Record<string, number> = { down: 0, pending: 1, up: 2, paused: 3 };

export function MonitorsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [deleting, setDeleting] = useState<Monitor | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["monitors"],
    queryFn: () => api<{ monitors: Monitor[] }>("/api/monitors"),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["monitors"] });
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
  };

  const onError = (err: Error) => toast("error", err.message);

  const createMonitor = useMutation({
    mutationFn: (body: MonitorFormData) => api<{ monitor: Monitor }>("/api/monitors", { method: "POST", body }),
    onSuccess: ({ monitor }) => {
      toast("success", `Monitor "${monitor.name}" added.`);
      setAddOpen(false);
      invalidate();
    },
    onError,
  });

  const updateMonitor = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<MonitorFormData> }) =>
      api<{ monitor: Monitor }>(`/api/monitors/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      toast("success", "Monitor updated.");
      setEditing(null);
      invalidate();
    },
    onError,
  });

  const pauseMonitor = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" }) =>
      api(`/api/monitors/${id}/${action}`, { method: "POST" }),
    onSuccess: (_data, vars) => {
      toast("success", vars.action === "pause" ? "Monitoring paused." : "Monitoring resumed.");
      invalidate();
    },
    onError,
  });

  const deleteMonitor = useMutation({
    mutationFn: (id: string) => api(`/api/monitors/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast("success", "Monitor deleted.");
      setDeleting(null);
      invalidate();
      navigate("/monitors");
    },
    onError,
  });

  const monitors = useMemo(() => {
    let list = data?.monitors ?? [];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((m) => m.name.toLowerCase().includes(q) || m.url.toLowerCase().includes(q));
    if (statusFilter !== "all") list = list.filter((m) => m.status === statusFilter);
    return [...list].sort((a, b) => {
      switch (sort) {
        case "status":
          return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
        case "uptime":
          return (a.uptime24h ?? -1) - (b.uptime24h ?? -1);
        case "response":
          return (a.lastResponseTimeMs ?? Number.MAX_SAFE_INTEGER) - (b.lastResponseTimeMs ?? Number.MAX_SAFE_INTEGER);
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [data, query, statusFilter, sort]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Monitors</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {data ? `${data.monitors.length} monitored endpoint${data.monitors.length === 1 ? "" : "s"}` : "Loading…"}
          </p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
          Add Monitor
        </Button>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or URL…"
              className="pl-9"
              aria-label="Search monitors"
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="w-40"
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="up">Up</option>
            <option value="down">Down</option>
            <option value="paused">Paused</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-44" aria-label="Sort monitors">
            <option value="name">Sort: Name</option>
            <option value="status">Sort: Status</option>
            <option value="uptime">Sort: Uptime</option>
            <option value="response">Sort: Response time</option>
          </Select>
        </div>

        {isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : monitors.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title={data?.monitors.length ? "No monitors match your filters" : "No monitors yet"}
            description={
              data?.monitors.length
                ? "Try a different search term or status filter."
                : "Add a website or API endpoint to start tracking uptime and response times."
            }
            action={
              !data?.monitors.length ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
                  Add Monitor
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <Table className="hidden md:block">
              <thead>
                <tr>
                  <Th>
                    <span className="inline-flex items-center gap-1">
                      <ArrowUpDown className="h-3 w-3" /> Name
                    </span>
                  </Th>
                  <Th>Status</Th>
                  <Th>Response</Th>
                  <Th>Uptime (24h)</Th>
                  <Th>Interval</Th>
                  <Th>Last checked</Th>
                  <Th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {monitors.map((monitor) => (
                  <Tr key={monitor.id} onClick={() => navigate(`/monitors/${monitor.id}`)}>
                    <Td>
                      <p className="font-semibold text-slate-900 dark:text-white">{monitor.name}</p>
                      <p className="mt-0.5 max-w-[24rem] truncate text-xs text-slate-500 dark:text-slate-400">{monitor.url}</p>
                    </Td>
                    <Td>
                      <StatusBadge status={monitor.status} />
                    </Td>
                    <Td className="font-medium tabular-nums">
                      {formatMs(monitor.lastResponseTimeMs)}
                      {monitor.lastStatusCode !== null && (
                        <span className="ml-1.5 text-xs font-normal text-slate-400">HTTP {monitor.lastStatusCode}</span>
                      )}
                    </Td>
                    <Td className="font-medium tabular-nums">{formatUptime(monitor.uptime24h)}</Td>
                    <Td className="text-xs text-slate-500 dark:text-slate-400">every {formatInterval(monitor.intervalSeconds)}</Td>
                    <Td className="text-xs text-slate-500 dark:text-slate-400">{formatRelative(monitor.lastCheckedAt)}</Td>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <MonitorMenu
                        monitor={monitor}
                        onEdit={() => setEditing(monitor)}
                        onDelete={() => setDeleting(monitor)}
                        onToggle={() =>
                          pauseMonitor.mutate({ id: monitor.id, action: monitor.active ? "pause" : "resume" })
                        }
                        busy={pauseMonitor.isPending}
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>

            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800/80">
              {monitors.map((monitor) => (
                <li key={monitor.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button onClick={() => navigate(`/monitors/${monitor.id}`)} className="min-w-0 text-left">
                      <p className="truncate font-semibold text-slate-900 dark:text-white">{monitor.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{monitor.url}</p>
                    </button>
                    <MonitorMenu
                      monitor={monitor}
                      onEdit={() => setEditing(monitor)}
                      onDelete={() => setDeleting(monitor)}
                      onToggle={() => pauseMonitor.mutate({ id: monitor.id, action: monitor.active ? "pause" : "resume" })}
                      busy={pauseMonitor.isPending}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StatusBadge status={monitor.status} />
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {formatMs(monitor.lastResponseTimeMs)} · {formatUptime(monitor.uptime24h)} uptime
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <AddMonitorModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        submitting={createMonitor.isPending}
        error={createMonitor.error instanceof Error ? createMonitor.error.message : null}
        onSubmit={(formData) => createMonitor.mutate(formData)}
      />

      <AddMonitorModal
        open={!!editing}
        onClose={() => setEditing(null)}
        initial={editing}
        submitting={updateMonitor.isPending}
        error={updateMonitor.error instanceof Error ? updateMonitor.error.message : null}
        onSubmit={(formData) => editing && updateMonitor.mutate({ id: editing.id, body: formData })}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMonitor.mutate(deleting.id)}
        loading={deleteMonitor.isPending}
        danger
        title="Delete monitor?"
        confirmLabel="Delete"
        message={
          <>
            <strong>{deleting?.name}</strong> and its entire check history, incidents and analytics will be permanently
            deleted. This action cannot be undone.
          </>
        }
      />
    </div>
  );
}

function MonitorMenu({
  monitor,
  onEdit,
  onDelete,
  onToggle,
  busy,
}: {
  monitor: Monitor;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  busy?: boolean;
}) {
  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          aria-label={`Actions for ${monitor.name}`}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <MoreHorizontal className="h-4.5 w-4.5" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem
            onClick={() => {
              close();
              onToggle();
            }}
            disabled={busy}
          >
            {monitor.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {monitor.active ? "Pause monitoring" : "Resume monitoring"}
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              onEdit();
            }}
          >
            <Pencil className="h-4 w-4" /> Edit
          </MenuItem>
          <MenuItem
            danger
            onClick={() => {
              close();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}
