import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import type { PublicStatusPage } from "@/lib/types";
import { cn, formatRelative, formatUptime, statusColors, STATUS_LABELS } from "@/lib/utils";
import { Spinner } from "@/components/ui/feedback";

export function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["public-status", slug],
    queryFn: () => apiPublic<PublicStatusPage>(`/api/public/status/${slug}`),
    enabled: !!slug,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-[#0a0f1c]">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center dark:bg-[#0a0f1c]">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow dark:bg-slate-900">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
        </div>
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">Status page not found</h1>
        <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
          This page does not exist or is no longer published.
        </p>
        <Link to="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
          Go to AuraTrace
        </Link>
      </div>
    );
  }

  const overallTone =
    data.overall === "operational" ? "up" : data.overall === "down" ? "down" : data.overall === "paused" ? "paused" : "pending";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0a0f1c]">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-black text-white">A</span>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{data.title}</h1>
            </div>
            {data.description && <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{data.description}</p>}
          </div>
          <button
            onClick={() => refetch()}
            aria-label="Refresh status"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-white hover:text-slate-600 dark:hover:bg-slate-900 dark:hover:text-slate-200"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </button>
        </div>

        <div
          className={cn(
            "mt-8 flex items-center gap-3 rounded-2xl border p-5",
            data.overall === "operational"
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
              : data.overall === "down"
                ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40"
                : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
          )}
        >
          {data.overall === "operational" ? (
            <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <div>
            <p
              className={cn(
                "text-sm font-bold",
                data.overall === "operational"
                  ? "text-emerald-800 dark:text-emerald-300"
                  : "text-amber-800 dark:text-amber-300",
              )}
            >
              {STATUS_LABELS[overallTone] ?? data.overall}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Last updated {formatRelative(data.updatedAt)}</p>
          </div>
        </div>

        {data.incidents.length > 0 && (
          <div className="mt-6 space-y-3">
            {data.incidents.map((incident, i) => (
              <div key={i} className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm dark:border-rose-900 dark:bg-slate-900">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500 status-pulse" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">{incident.title}</h2>
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{incident.message}</p>
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Investigating since {formatRelative(incident.startedAt)}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Services</h2>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {data.services.map((service, i) => {
              const colors = statusColors(service.status);
              return (
                <li key={i} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{service.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {service.uptime24h !== null ? `${formatUptime(service.uptime24h)} uptime (24h)` : "Awaiting data"}
                      {service.uptime7d !== null && ` · ${formatUptime(service.uptime7d)} (7d)`}
                    </p>
                  </div>
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", colors.badge)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", colors.dot)} />
                    {STATUS_LABELS[service.status] ?? service.status}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="mt-10 text-center text-xs text-slate-400 dark:text-slate-600">
          Powered by <span className="font-semibold text-slate-500 dark:text-slate-500">AuraTrace</span>
        </p>
      </div>
    </div>
  );
}

async function apiPublic<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error("Not found");
  return data as T;
}
