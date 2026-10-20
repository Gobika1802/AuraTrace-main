import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { ToastProvider } from "@/lib/toast";
import { AppLayout } from "@/components/Layout";
import { PageSkeleton } from "@/components/ui/feedback";
import { LoginPage, RegisterPage } from "@/pages/Auth";
import { OverviewPage } from "@/pages/Overview";
import { MonitorsPage } from "@/pages/Monitors";
import { MonitorDetailPage } from "@/pages/MonitorDetail";
import { IncidentsPage } from "@/pages/Incidents";
import { StatusPagesPage } from "@/pages/StatusPages";
import { NotificationsPage } from "@/pages/Notifications";
import { SettingsPage } from "@/pages/Settings";
import { PublicStatusPage } from "@/pages/PublicStatus";
import { NotFoundPage } from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-[#0a0f1c]">
        <div className="w-full max-w-3xl px-6">
          <PageSkeleton />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout>{children}</AppLayout>;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route
                  path="/login"
                  element={
                    <GuestOnly>
                      <LoginPage />
                    </GuestOnly>
                  }
                />
                <Route
                  path="/register"
                  element={
                    <GuestOnly>
                      <RegisterPage />
                    </GuestOnly>
                  }
                />
                <Route path="/status/:slug" element={<PublicStatusPage />} />
                <Route
                  path="/"
                  element={
                    <Protected>
                      <OverviewPage />
                    </Protected>
                  }
                />
                <Route
                  path="/monitors"
                  element={
                    <Protected>
                      <MonitorsPage />
                    </Protected>
                  }
                />
                <Route
                  path="/monitors/:id"
                  element={
                    <Protected>
                      <MonitorDetailPage />
                    </Protected>
                  }
                />
                <Route
                  path="/incidents"
                  element={
                    <Protected>
                      <IncidentsPage />
                    </Protected>
                  }
                />
                <Route
                  path="/incidents/:id"
                  element={
                    <Protected>
                      <IncidentsPage />
                    </Protected>
                  }
                />
                <Route
                  path="/status-pages"
                  element={
                    <Protected>
                      <StatusPagesPage />
                    </Protected>
                  }
                />
                <Route
                  path="/notifications"
                  element={
                    <Protected>
                      <NotificationsPage />
                    </Protected>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <Protected>
                      <SettingsPage />
                    </Protected>
                  }
                />
                <Route
                  path="*"
                  element={
                    <Protected>
                      <NotFoundPage />
                    </Protected>
                  }
                />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
