import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Copy, ExternalLink, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Monitor, StatusPage as StatusPageType } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/lib/toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { EmptyState, TableSkeleton } from "@/components/ui/feedback";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";

export function StatusPagesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<StatusPageType | null>(null);
  const [deleting, setDeleting] = useState<StatusPageType | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["status-pages"],
    queryFn: () => api<{ statusPages: StatusPageType[] }>("/api/status-pages"),
  });

  const { data: monitorsData } = useQuery({
    queryKey: ["monitors"],
    queryFn: () => api<{ monitors: Monitor[] }>("/api/monitors"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/status-pages/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast("success", "Status page deleted.");
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ["status-pages"] });
    },
    onError: (err: Error) => toast("error", err.message),
  });

  const pages = data?.statusPages ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Status Pages</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Publish a public page showing live service health — without exposing private configuration.
          </p>
        </div>
        <Button
          icon={<Plus className="h-4 w-4" />}
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          New status page
        </Button>
      </div>

      {isLoading ? (
        <TableSkeleton rows={3} cols={4} />
      ) : pages.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="No status pages yet"
            description="Create a branded public status page and share it with your customers via a public URL."
            action={
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                Create status page
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pages.map((page) => (
            <Card key={page.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{page.title}</h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {page.monitorCount} monitor{page.monitorCount === 1 ? "" : "s"} · created {formatDate(page.createdAt)}
                  </p>
                </div>
                <Badge tone={page.published ? "success" : "slate"}>
                  {page.published ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  {page.published ? "Published" : "Draft"}
                </Badge>
              </div>

              {page.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{page.description}</p>}

              <div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                <code className="flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
                  {window.location.origin}{page.publicUrl}
                </code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(`${window.location.origin}${page.publicUrl}`);
                    toast("success", "Link copied to clipboard.");
                  }}
                  aria-label="Copy public URL"
                  className="rounded p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800/80">
                <a
                  href={page.publicUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"
                >
                  View page <ExternalLink className="h-3 w-3" />
                </a>
                <div className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const full = await api<{ statusPage: StatusPageType }>(`/api/status-pages/${page.id}`);
                        setEditing(full.statusPage);
                        setEditorOpen(true);
                      } catch (err) {
                        toast("error", err instanceof Error ? err.message : "Failed to load status page");
                      }
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 dark:text-rose-400" onClick={() => setDeleting(page)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <StatusPageEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        initial={editing}
        monitors={monitorsData?.monitors ?? []}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        loading={remove.isPending}
        danger
        title="Delete status page?"
        confirmLabel="Delete"
        message={<>The public page <strong>{deleting?.title}</strong> will stop working immediately.</>}
      />
    </div>
  );
}

function StatusPageEditor({
  open,
  onClose,
  initial,
  monitors,
}: {
  open: boolean;
  onClose: () => void;
  initial: StatusPageType | null;
  monitors: Monitor[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [published, setPublished] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(initial?.title ?? "");
      setDescription(initial?.description ?? "");
      setSlug(initial?.slug ?? "");
      setPublished(initial?.published ?? true);
      setSelected(initial?.monitors?.map((m) => m.monitorId) ?? []);
      setError(null);
    }
  }, [open, initial]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        description: description || null,
        slug: slug || undefined,
        monitorIds: selected,
        published,
      };
      return initial
        ? api(`/api/status-pages/${initial.id}`, { method: "PATCH", body })
        : api("/api/status-pages", { method: "POST", body });
    },
    onSuccess: () => {
      toast("success", initial ? "Status page updated." : "Status page created.");
      void queryClient.invalidateQueries({ queryKey: ["status-pages"] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleMonitor = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit status page" : "New status page"}
      description="Choose which monitors to publish. Only selected monitor names and health are exposed."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!title.trim() || selected.length === 0}
            onClick={() => save.mutate()}
          >
            {initial ? "Save changes" : "Create status page"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </div>
        )}
        <Field label="Page title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme Service Status" />
        </Field>
        <Field label="Description" hint="Optional message shown at the top of the page.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Current availability of Acme services." />
        </Field>
        <Field label="Public URL slug" hint={`Leave empty to auto-generate. Public address: ${window.location.origin}/status/${slug || "…"}`}>
          <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="acme-status" />
        </Field>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Monitors to display <span className="text-rose-500">*</span>
          </p>
          {monitors.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              Add a monitor first, then you can publish it on a status page.
            </p>
          ) : (
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-800">
              {monitors.map((monitor) => (
                <label
                  key={monitor.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(monitor.id)}
                    onChange={() => toggleMonitor(monitor.id)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200">{monitor.name}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{monitor.url}</span>
                  </span>
                  <StatusBadge status={monitor.status} />
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 pt-1 dark:border-slate-800">
          <Switch
            checked={published}
            onChange={setPublished}
            label="Published"
            description="Published pages are accessible to anyone with the link."
          />
        </div>
      </div>
    </Modal>
  );
}
