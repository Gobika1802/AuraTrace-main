import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/form";
import type { Monitor, MonitorFormData } from "@/lib/types";

const INTERVAL_OPTIONS = [
  { value: 30, label: "Every 30 seconds" },
  { value: 60, label: "Every 1 minute" },
  { value: 300, label: "Every 5 minutes" },
  { value: 600, label: "Every 10 minutes" },
  { value: 900, label: "Every 15 minutes" },
  { value: 1800, label: "Every 30 minutes" },
  { value: 3600, label: "Every hour" },
];

const defaults: MonitorFormData = {
  name: "",
  url: "",
  type: "http",
  intervalSeconds: 60,
  timeoutMs: 10000,
  expectedStatus: null,
  failureThreshold: 3,
  recoveryThreshold: 2,
};

export function MonitorForm({
  initial,
  submitting,
  submitError,
  onSubmit,
  onCancel,
}: {
  initial?: Monitor | null;
  submitting?: boolean;
  submitError?: string | null;
  onSubmit: (data: MonitorFormData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<MonitorFormData>(defaults);
  const [errors, setErrors] = useState<Partial<Record<keyof MonitorFormData, string>>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        name: initial.name,
        url: initial.url,
        type: "http",
        intervalSeconds: initial.intervalSeconds,
        timeoutMs: initial.timeoutMs,
        expectedStatus: initial.expectedStatus,
        failureThreshold: initial.failureThreshold,
        recoveryThreshold: initial.recoveryThreshold,
      });
      setShowAdvanced(true);
    } else {
      setForm(defaults);
      setErrors({});
    }
  }, [initial]);

  const set = <K extends keyof MonitorFormData>(key: K, value: MonitorFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof MonitorFormData, string>> = {};
    if (!form.name.trim()) next.name = "Name is required";
    if (!form.url.trim()) next.url = "URL is required";
    else {
      try {
        const parsed = new URL(form.url);
        if (!["http:", "https:"].includes(parsed.protocol)) next.url = "URL must start with http:// or https://";
      } catch {
        next.url = "Enter a valid URL, e.g. https://example.com";
      }
    }
    if (form.timeoutMs < 1000 || form.timeoutMs > 120000) next.timeoutMs = "Timeout must be between 1,000 and 120,000 ms";
    if (form.intervalSeconds < 10) next.intervalSeconds = "Interval must be at least 10 seconds";
    if (form.expectedStatus !== null && (form.expectedStatus < 100 || form.expectedStatus > 599)) {
      next.expectedStatus = "Status code must be between 100 and 599";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({
      ...form,
      name: form.name.trim(),
      url: form.url.trim(),
      expectedStatus: form.expectedStatus,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {submitError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
          {submitError}
        </div>
      )}

      <Field label="Monitor name" required error={errors.name} htmlFor="monitor-name">
        <Input
          id="monitor-name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Marketing site"
          invalid={!!errors.name}
          autoFocus
        />
      </Field>

      <Field
        label="URL"
        required
        error={errors.url}
        hint="Only public http/https endpoints can be monitored. Private and internal addresses are blocked."
        htmlFor="monitor-url"
      >
        <Input
          id="monitor-url"
          value={form.url}
          onChange={(e) => set("url", e.target.value)}
          placeholder="https://example.com"
          inputMode="url"
          invalid={!!errors.url}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Monitor type" required>
          <Select value={form.type} onChange={(e) => set("type", e.target.value as "http")} disabled>
            <option value="http">HTTP / HTTPS</option>
          </Select>
        </Field>
        <Field label="Check interval" required error={errors.intervalSeconds}>
          <Select
            value={form.intervalSeconds}
            onChange={(e) => set("intervalSeconds", Number(e.target.value))}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Request timeout (ms)" error={errors.timeoutMs} hint="1,000–120,000">
          <Input
            type="number"
            min={1000}
            max={120000}
            step={500}
            value={form.timeoutMs}
            onChange={(e) => set("timeoutMs", Number(e.target.value))}
            invalid={!!errors.timeoutMs}
          />
        </Field>
        <Field
          label="Expected HTTP status"
          error={errors.expectedStatus}
          hint="Optional. Default: any 2xx/3xx response."
        >
          <Input
            type="number"
            min={100}
            max={599}
            placeholder="e.g. 200"
            value={form.expectedStatus ?? ""}
            onChange={(e) => set("expectedStatus", e.target.value === "" ? null : Number(e.target.value))}
            invalid={!!errors.expectedStatus}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-xs font-semibold text-brand-600 transition hover:text-brand-700 dark:text-brand-400"
      >
        {showAdvanced ? "− Hide advanced settings" : "+ Advanced settings"}
      </button>

      {showAdvanced && (
        <div className="grid gap-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/40 sm:grid-cols-2">
          <Field
            label="Failure threshold"
            hint="Failures before a DOWN incident"
            error={errors.failureThreshold}
          >
            <Input
              type="number"
              min={1}
              max={10}
              value={form.failureThreshold}
              onChange={(e) => set("failureThreshold", Number(e.target.value))}
            />
          </Field>
          <Field
            label="Recovery threshold"
            hint="Successes before RECOVERED"
            error={errors.recoveryThreshold}
          >
            <Input
              type="number"
              min={1}
              max={10}
              value={form.recoveryThreshold}
              onChange={(e) => set("recoveryThreshold", Number(e.target.value))}
            />
          </Field>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {initial ? "Save changes" : "Add monitor"}
        </Button>
      </div>
    </form>
  );
}
