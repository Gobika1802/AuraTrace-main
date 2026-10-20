import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useMatch } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  ChevronsLeft,
  Gauge,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Search,
  Settings,
  Sun,
  UserCog,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Incident } from "@/lib/types";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/Menu";

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: Gauge, exact: true },
  { to: "/monitors", label: "Monitors", icon: Activity },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle },
  { to: "/status-pages", label: "Status Pages", icon: Building2 },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, to: string, exact?: boolean): boolean {
  if (exact) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {NAV_ITEMS.map((item) => {
        const active = isActive(location.pathname, item.to, item.exact);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
              collapsed && "justify-center px-2",
              active
                ? "bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100",
            )}
          >
            <Icon className={cn("h-4.5 w-4.5 shrink-0", active ? "text-brand-600 dark:text-brand-400" : "")} />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function UserBlock({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="border-t border-slate-200 p-3 dark:border-slate-800">
      <Menu
        align="start"
        trigger={({ toggle }) => (
          <button
            onClick={toggle}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800/70",
              collapsed && "justify-center",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
              {initials}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{user.name}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</span>
              </span>
            )}
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>{user.email}</MenuLabel>
            <MenuItem
              onClick={() => {
                close();
                navigate("/settings");
              }}
            >
              <UserCog className="h-4 w-4" /> Account settings
            </MenuItem>
            <MenuItem
              danger
              onClick={async () => {
                close();
                await logout();
                navigate("/login");
              }}
            >
              <LogOut className="h-4 w-4" /> Log out
            </MenuItem>
          </>
        )}
      </Menu>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {theme === "dark" ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
    </button>
  );
}

function IncidentBell() {
  const { data } = useQuery({
    queryKey: ["incidents", "ongoing", "bell"],
    queryFn: () => api<{ incidents: Incident[] }>("/api/incidents?status=ongoing"),
    refetchInterval: 60_000,
  });
  const count = data?.incidents.length ?? 0;
  return (
    <Link
      to="/incidents?status=ongoing"
      aria-label={`${count} ongoing incidents`}
      className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      <Bell className="h-4.5 w-4.5" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}

function usePageMeta(): { title: string; parent?: { label: string; to: string } } {
  const location = useLocation();
  const monitorMatch = useMatch("/monitors/:id");
  return useMemo(() => {
    if (monitorMatch) return { title: "Monitor details", parent: { label: "Monitors", to: "/monitors" } };
    if (location.pathname === "/") return { title: "Overview" };
    if (location.pathname.startsWith("/monitors")) return { title: "Monitors" };
    if (location.pathname.startsWith("/incidents")) return { title: "Incidents" };
    if (location.pathname.startsWith("/status-pages")) return { title: "Status Pages" };
    if (location.pathname.startsWith("/notifications")) return { title: "Notifications" };
    if (location.pathname.startsWith("/settings")) return { title: "Settings" };
    return { title: "AuraTrace" };
  }, [location.pathname, monitorMatch]);
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("auratrace-sidebar") === "collapsed");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const meta = usePageMeta();

  useEffect(() => {
    localStorage.setItem("auratrace-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-[#0a0f1c]">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 dark:border-slate-800 dark:bg-slate-950/60 lg:flex",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className={cn("flex h-14 items-center border-b border-slate-200 dark:border-slate-800", collapsed ? "justify-center px-2" : "px-4")}>
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-black text-white">A</span>
            {!collapsed && <span className="text-[17px] font-extrabold tracking-tight text-slate-900 dark:text-white">AuraTrace</span>}
          </Link>
        </div>
        <SidebarNav collapsed={collapsed} />
        <div className={cn("border-t border-slate-200 py-2 dark:border-slate-800", collapsed && "flex justify-center")}>
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <ChevronsLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </button>
        </div>
        <UserBlock collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col bg-white shadow-2xl dark:bg-slate-950">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-black text-white">A</span>
                <span className="text-[17px] font-extrabold tracking-tight text-slate-900 dark:text-white">AuraTrace</span>
              </div>
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
            <UserBlock collapsed={false} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
              <Link to="/" className="transition hover:text-slate-600 dark:hover:text-slate-300">
                AuraTrace
              </Link>
              {meta.parent && (
                <>
                  <span>/</span>
                  <Link to={meta.parent.to} className="transition hover:text-slate-600 dark:hover:text-slate-300">
                    {meta.parent.label}
                  </Link>
                </>
              )}
            </div>
            <h1 className="truncate text-[15px] font-semibold leading-tight text-slate-900 dark:text-white">{meta.title}</h1>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/monitors?q=${encodeURIComponent(search.trim())}`);
              }}
              className="relative hidden md:block"
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search monitors…"
                aria-label="Search monitors"
                className="h-9 w-52 rounded-lg border-0 bg-slate-100 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 transition focus:w-64 focus:bg-white focus:ring-2 focus:ring-brand-500/50 dark:bg-slate-900 dark:text-slate-200 dark:focus:bg-slate-900"
              />
            </form>
            <ThemeToggle />
            <IncidentBell />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
