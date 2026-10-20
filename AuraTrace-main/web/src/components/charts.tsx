import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";

type Point = {
  time: string;
  avgResponseTimeMs: number | null;
  maxResponseTimeMs?: number | null;
  checks?: number;
};

function chartTheme() {
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return {
    dark,
    grid: dark ? "#1e293b" : "#e2e8f0",
    line: dark ? "#818cf8" : "#4f46e5",
    fill: dark ? "rgba(99,102,241,0.18)" : "rgba(99,102,241,0.10)",
    text: dark ? "#94a3b8" : "#64748b",
    tooltipBg: dark ? "#0f172a" : "#ffffff",
    tooltipBorder: dark ? "#334155" : "#e2e8f0",
    tooltipText: dark ? "#e2e8f0" : "#0f172a",
  };
}

function formatX(time: string, rangeHours: number): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "";
  if (rangeHours <= 24) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ResponseTimeChart({
  data,
  rangeHours = 24,
  height = 260,
  showMax = true,
}: {
  data: Point[];
  rangeHours?: number;
  height?: number;
  showMax?: boolean;
}) {
  const colors = chartTheme();
  const chartData = data.map((d) => ({
    ...d,
    avg: d.avgResponseTimeMs,
    max: d.maxResponseTimeMs ?? null,
    label: formatX(d.time, rangeHours),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="rtFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.line} stopOpacity={0.22} />
            <stop offset="100%" stopColor={colors.line} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: colors.text, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: colors.grid }}
          minTickGap={28}
        />
        <YAxis
          tick={{ fill: colors.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`}`}
          width={58}
        />
        <RechartsTooltip
          contentStyle={{
            background: colors.tooltipBg,
            border: `1px solid ${colors.tooltipBorder}`,
            borderRadius: 10,
            color: colors.tooltipText,
            fontSize: 12,
          }}
          labelStyle={{ color: colors.text, fontSize: 11 }}
          formatter={(value: unknown, name: string) => {
            if (typeof value === "number") {
              return [value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`, name === "avg" ? "Avg response" : "Max response"];
            }
            return ["—", name];
          }}
        />
        <Area type="monotone" dataKey="avg" stroke="none" fill="url(#rtFill)" connectNulls />
        <Line
          type="monotone"
          dataKey="avg"
          stroke={colors.line}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          connectNulls
        />
        {showMax && (
          <Line type="monotone" dataKey="max" stroke={colors.text} strokeWidth={1} strokeDasharray="4 4" dot={false} connectNulls />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function AvailabilityBars({
  buckets,
  height = "h-2.5",
  showLabels = true,
}: {
  buckets: { time: string; uptime: number | null; checks: number }[];
  height?: string;
  showLabels?: boolean;
}) {
  if (buckets.length === 0) {
    return <div className={`w-full rounded bg-slate-100 dark:bg-slate-800 ${height}`} />;
  }
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  return (
    <div>
      <div className="flex w-full items-stretch gap-[2px]">
        {buckets.map((bucket, i) => {
          const color =
            bucket.uptime === null
              ? "bg-slate-200 dark:bg-slate-800"
              : bucket.uptime >= 99.5
                ? "bg-emerald-500"
                : bucket.uptime >= 90
                  ? "bg-amber-400"
                  : "bg-rose-500";
          const label =
            bucket.uptime === null
              ? "No monitoring data"
              : `${new Date(bucket.time).toLocaleString()} — ${bucket.uptime.toFixed(1)}% uptime (${bucket.checks} checks)`;
          return <div key={i} title={label} className={`flex-1 rounded-[3px] ${color} ${height}`} />;
        })}
      </div>
      {showLabels && (
        <div className="mt-1.5 flex justify-between text-[10px] font-medium text-slate-400 dark:text-slate-500">
          <span>{new Date(first.time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })}</span>
          <span>{new Date(last.time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })}</span>
        </div>
      )}
    </div>
  );
}

export function UptimeLegend() {
  const items = [
    { color: "bg-emerald-500", label: "Operational" },
    { color: "bg-amber-400", label: "Degraded" },
    { color: "bg-rose-500", label: "Down" },
    { color: "bg-slate-200 dark:bg-slate-800", label: "No data" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          <span className={`h-2 w-3.5 rounded-[3px] ${item.color}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
