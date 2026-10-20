import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { LogOut, UserCog } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/lib/toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/form";

export function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [profile, setProfile] = useState({ name: user?.name ?? "", email: user?.email ?? "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (user) setProfile({ name: user.name, email: user.email });
  }, [user]);

  const saveProfile = useMutation({
    mutationFn: () => api("/api/settings/profile", { method: "PUT", body: profile }),
    onSuccess: async () => {
      toast("success", "Profile updated.");
      setProfileError(null);
      await refresh();
    },
    onError: (err: Error) => setProfileError(err.message),
  });

  const changePassword = useMutation({
    mutationFn: () =>
      api("/api/settings/password", {
        method: "PUT",
        body: { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword },
      }),
    onSuccess: () => {
      toast("success", "Password changed.");
      setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
      setPasswordError(null);
    },
    onError: (err: Error) => setPasswordError(err.message),
  });

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.newPassword !== passwords.confirm) {
      setPasswordError("New passwords do not match.");
      return;
    }
    changePassword.mutate();
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Settings</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Manage your account and preferences.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Profile" description="Your name and sign-in email." />
          <form
            className="space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              saveProfile.mutate();
            }}
          >
            {profileError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
                {profileError}
              </div>
            )}
            <Field label="Full name" required>
              <Input value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
            </Field>
            <Field label="Email" required>
              <Input type="email" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
            </Field>
            <Button type="submit" loading={saveProfile.isPending} icon={<UserCog className="h-4 w-4" />}>
              Save profile
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Change password" description="You will stay signed in on this device." />
          <form className="space-y-4 p-5" onSubmit={submitPassword}>
            {passwordError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
                {passwordError}
              </div>
            )}
            <Field label="Current password" required>
              <Input
                type="password"
                autoComplete="current-password"
                value={passwords.currentPassword}
                onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
              />
            </Field>
            <Field label="New password" required hint="At least 8 characters with a letter and a number.">
              <Input
                type="password"
                autoComplete="new-password"
                value={passwords.newPassword}
                onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
              />
            </Field>
            <Field label="Confirm new password" required>
              <Input
                type="password"
                autoComplete="new-password"
                value={passwords.confirm}
                onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
              />
            </Field>
            <Button type="submit" loading={changePassword.isPending}>
              Update password
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Appearance" description="Theme applies to this browser only." />
          <div className="space-y-4 p-5">
            <Field label="Theme">
              <Select value={theme} onChange={(e) => setTheme(e.target.value as "light" | "dark")}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Session" description="Sign out of your AuraTrace account." />
          <div className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Signed in as {user?.email}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Monitoring continues on our servers even when you are signed out.
              </p>
            </div>
            <Button
              variant="danger-ghost"
              icon={<LogOut className="h-4 w-4" />}
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Log out
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
