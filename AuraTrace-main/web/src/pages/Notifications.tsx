import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Mail, Send } from "lucide-react";
import { api } from "@/lib/api";
import type { NotificationLog, NotificationSettings } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/lib/toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, Input, Switch } from "@/components/ui/form";
import { EmptyState, TableSkeleton } from "@/components/ui/feedback";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useAuth } from "@/lib/auth";

export function NotificationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsQuery = useQuery({
    queryKey: ["notification-settings"],
    queryFn: () => api<{ notificationSettings: NotificationSettings }>("/api/settings"),
  });

  const logsQuery = useQuery({
    queryKey: ["notification-logs"],
    queryFn: () => api<{ logs: NotificationLog[] }>("/api/settings/notifications"),
    refetchInterval: 30_000,
  });

  const [form, setForm] = useState<NotificationSettings>({
    emailEnabled: true,
    notifyDown: true,
    notifyRecovery: true,
    recipientEmail: null,
  });

  useEffect(() => {
    if (settingsQuery.data) setForm(settingsQuery.data.notificationSettings);
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: () => api("/api/settings", { method: "PUT", body: form }),
    onSuccess: () => {
      toast("success", "Notification settings saved.");
      void queryClient.invalidateQueries({ queryKey: ["notification-settings"] });
    },
    onError: (err: Error) => toast("error", err.message),
  });

  const test = useMutation({
    mutationFn: () => api<{ sent: boolean }>("/api/settings/notifications/test", { method: "POST" }),
    onSuccess: ({ sent }) => {
      toast(sent ? "success" : "info", sent ? "Test email sent." : "Test recorded — check delivery logs below for the reason.");
      void queryClient.invalidateQueries({ queryKey: ["notification-logs"] });
    },
    onError: (err: Error) => toast("error", err.message),
  });

  const logs = logsQuery.data?.logs ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Notifications</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Configure email alerts for downtime and recovery events, and review delivery history.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader title="Email alerts" description="Sent when a monitor goes down or recovers." />
          <div className="divide-y divide-slate-100 px-5 dark:divide-slate-800/80">
            <Switch
              checked={form.emailEnabled}
              onChange={(v) => setForm((f) => ({ ...f, emailEnabled: v }))}
              label="Enable email notifications"
              description="Master switch for all alert emails."
            />
            <Switch
              checked={form.notifyDown}
              onChange={(v) => setForm((f) => ({ ...f, notifyDown: v }))}
              label="Notify on downtime"
              description="After the failure threshold is confirmed."
              disabled={!form.emailEnabled}
            />
            <Switch
              checked={form.notifyRecovery}
              onChange={(v) => setForm((f) => ({ ...f, notifyRecovery: v }))}
              label="Notify on recovery"
              description="When a down monitor becomes healthy again."
              disabled={!form.emailEnabled}
            />
          </div>
          <div className="space-y-4 border-t border-slate-100 p-5 dark:border-slate-800/80">
            <Field label="Notification recipient" hint={`Defaults to your account email (${user?.email}).`} required>
              <Input
                type="email"
                value={form.recipientEmail ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, recipientEmail: e.target.value || null }))}
                placeholder={user?.email ?? "you@company.com"}
              />
            </Field>
            <div className="flex gap-2">
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Save settings
              </Button>
              <Button variant="secondary" icon={<Send className="h-4 w-4" />} loading={test.isPending} onClick={() => test.mutate()}>
                Send test
              </Button>
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              SMTP credentials are configured on the server via environment variables and are never exposed to the browser.
            </p>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Delivery log" description="Recent notification attempts and their outcome." />
          {logsQuery.isLoading ? (
            <TableSkeleton rows={5} cols={5} />
          ) : logs.length === 0 ? (
            <EmptyState
              icon={<BellRing className="h-6 w-6" />}
              title="No notifications yet"
              description="Alert emails you receive (or that fail to send) will be listed here for debugging."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Event</Th>
                  <Th>Monitor</Th>
                  <Th>Recipient</Th>
                  <Th>Status</Th>
                  <Th>Time</Th>
                  <Th className="hidden lg:table-cell">Details</Th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <Tr key={log.id}>
                    <Td>
                      <Badge tone={log.eventType === "down" ? "danger" : log.eventType === "recovery" ? "success" : "brand"}>
                        {log.eventType}
                      </Badge>
                    </Td>
                    <Td className="text-xs font-medium">{log.monitorName ?? "—"}</Td>
                    <Td className="max-w-[12rem] truncate text-xs">{log.recipient ?? "—"}</Td>
                    <Td>
                      <Badge tone={log.status === "sent" ? "success" : log.status === "failed" ? "danger" : "slate"}>{log.status}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{formatDate(log.createdAt)}</Td>
                    <Td className="hidden max-w-[16rem] truncate text-xs text-slate-500 lg:table-cell dark:text-slate-400">
                      {log.error ?? log.incidentTitle ?? "—"}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
