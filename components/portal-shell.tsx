"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Inbox,
  LayoutGrid,
  Medal,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SiteHeader } from "./site-header";
import { Brand } from "./brand";

const icons = {
  dashboard: LayoutGrid,
  programs: FolderOpen,
  reports: FileText,
  triage: Inbox,
  leaderboard: Trophy,
  achievements: Medal,
  profile: UserRound,
  admin: ShieldCheck,
  organizations: Building2,
  settings: Settings,
};

export type NavigationItem = {
  icon: keyof typeof icons;
  href: string;
  label: string;
};

type Labels = {
  navigation: string;
  breadcrumb: string;
  dashboard: string;
  organization: string;
  allOrganizations: string;
  collapse: string;
  expand: string;
  open: string;
  close: string;
  account: string;
  profile: string;
  settings: string;
  notifications: string;
  programDetails: string;
  programSettings: string;
  reportDetails: string;
  skip: string;
};

export function PortalShell({
  children,
  signOut,
  items,
  organizations,
  user,
  labels,
  attention,
}: {
  children: ReactNode;
  signOut: ReactNode;
  items: NavigationItem[];
  organizations: { id: string; name: string }[];
  user: string;
  labels: Labels;
  attention: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const account = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const triage = pathname === "/reports" && search.get("view") === "inbox";
  const organization =
    organizations.find(({ id }) => id === search.get("organization"))?.id ?? "";
  const current = items.find(({ href, icon }) =>
    icon === "triage"
      ? triage
      : (icon !== "reports" || !triage) &&
        (pathname === href || pathname.startsWith(`${href}/`)),
  );
  const detail = pathname.startsWith("/programs/")
    ? pathname.endsWith("/notifications")
      ? labels.notifications
      : pathname.endsWith("/manage")
        ? labels.programSettings
        : labels.programDetails
    : pathname.startsWith("/reports/")
      ? labels.reportDetails
      : undefined;
  const initials = user
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeDrawer = (event: MediaQueryListEvent) => {
      if (event.matches) drawer.current?.close();
    };
    desktop.addEventListener("change", closeDrawer);
    return () => desktop.removeEventListener("change", closeDrawer);
  }, []);

  function navigation(compact: boolean, mobile = false) {
    return (
      <nav
        aria-label={labels.navigation}
        className="flex flex-1 flex-col gap-3 px-3 pb-4"
      >
        {!compact && organizations.length > 0 && (
          <label className="mb-2 flex min-w-0 flex-col gap-1.5 px-1 text-xs font-medium text-muted">
            {labels.organization}
            <select
              value={organization}
              className="w-full min-w-0 rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-foreground"
              onChange={(event) => {
                const value = event.currentTarget.value;
                drawer.current?.close();
                router.push(
                  value
                    ? `/programs?organization=${encodeURIComponent(value)}`
                    : "/programs",
                );
              }}
            >
              <option value="">{labels.allOrganizations}</option>
              {organizations.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <ul className="grid gap-1">
          {items.map(({ href, icon, label }) => {
            const Icon = icons[icon];
            const active = current?.href === href;
            return (
              <li key={href}>
                <Link
                  aria-current={active ? "page" : undefined}
                  aria-label={compact ? label : undefined}
                  title={compact ? label : undefined}
                  href={href}
                  onClick={mobile ? () => drawer.current?.close() : undefined}
                  className={`flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium hover:bg-subtle hover:no-underline ${compact ? "justify-center" : ""} ${active ? "bg-action/10 text-accent" : "text-secondary"}`}
                >
                  <Icon size={17} aria-hidden className="shrink-0" />
                  {!compact && label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <div
      className={`flex-1 lg:grid ${collapsed ? "lg:grid-cols-[68px_minmax(0,1fr)]" : "lg:grid-cols-[248px_minmax(0,1fr)]"}`}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:p-3"
      >
        {labels.skip}
      </a>
      <aside className="sticky top-0 hidden h-dvh min-h-0 flex-col overflow-y-auto border-r border-line bg-surface lg:flex">
        <div
          className={`flex shrink-0 items-center gap-2 ${collapsed ? "flex-col py-4" : "h-16 justify-between px-4"}`}
        >
          <Link
            href="/dashboard"
            aria-label="BountyDeck"
            className="hover:no-underline"
          >
            <Brand compact={collapsed} />
          </Link>
          <button
            type="button"
            aria-label={collapsed ? labels.expand : labels.collapse}
            aria-expanded={!collapsed}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-subtle"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} aria-hidden />
            ) : (
              <PanelLeftClose size={17} aria-hidden />
            )}
          </button>
        </div>
        {navigation(collapsed)}
      </aside>

      <dialog
        ref={drawer}
        aria-label={labels.navigation}
        className="navigation-drawer fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(20rem,90vw)] max-w-none overflow-y-auto border-r border-line bg-surface text-foreground lg:hidden"
        onClick={(event) => {
          if (event.target === event.currentTarget) drawer.current?.close();
        }}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <Brand />
          <button
            type="button"
            aria-label={labels.close}
            className="grid size-9 place-items-center rounded-md hover:bg-subtle"
            onClick={() => drawer.current?.close()}
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        {navigation(false, true)}
      </dialog>

      <div className="min-w-0">
        <SiteHeader className="sticky top-0 z-10 flex items-center gap-2 px-3 sm:gap-4 sm:px-6">
          <button
            type="button"
            aria-label={labels.open}
            className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-subtle lg:hidden"
            onClick={() => drawer.current?.showModal()}
          >
            <Menu size={20} aria-hidden />
          </button>
          <nav
            aria-label={labels.breadcrumb}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-sm sm:gap-2"
          >
            {detail ? (
              <>
                <Link
                  className="hidden shrink-0 text-muted sm:block"
                  href={current?.href ?? "/dashboard"}
                >
                  {current?.label ?? labels.dashboard}
                </Link>
                <ChevronRight
                  size={14}
                  aria-hidden
                  className="hidden shrink-0 text-muted sm:block"
                />
                <span className="truncate font-medium" aria-current="page">
                  {detail}
                </span>
              </>
            ) : (
              <span className="truncate font-medium" aria-current="page">
                {current?.label ?? labels.dashboard}
              </span>
            )}
          </nav>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <Link
              href="/reports?status=needs_information"
              aria-label={labels.notifications}
              title={labels.notifications}
              className="relative grid size-9 place-items-center rounded-md text-secondary hover:bg-subtle"
            >
              <Bell size={17} aria-hidden />
              {attention > 0 && (
                <span
                  aria-hidden
                  className="absolute top-1 right-1 size-2 rounded-full bg-action ring-2 ring-surface"
                />
              )}
            </Link>
            <details
              className="account-menu relative"
              ref={menu}
              onToggle={(event) => setAccountOpen(event.currentTarget.open)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && menu.current?.open) {
                  menu.current.open = false;
                  account.current?.focus();
                }
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  event.currentTarget.open = false;
              }}
            >
              <summary
                ref={account}
                role="button"
                aria-expanded={accountOpen}
                aria-label={labels.account}
                className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-1 hover:bg-subtle"
              >
                <span
                  aria-hidden
                  className="grid size-7 place-items-center rounded-full bg-action/12 text-xs font-semibold text-accent"
                >
                  {initials || <UserRound size={14} />}
                </span>
                <ChevronDown
                  size={13}
                  className="hidden text-muted sm:block"
                  aria-hidden
                />
              </summary>
              <div className="absolute top-full right-0 mt-2 grid w-48 gap-1 rounded-lg border border-line bg-surface p-1.5 text-sm shadow-md">
                {user && (
                  <p className="truncate border-b border-line px-2 py-1.5 text-xs text-muted">
                    {user}
                  </p>
                )}
                <Link
                  href="/profile"
                  className="rounded-md px-2 py-1.5 hover:bg-subtle"
                  onClick={() => {
                    if (menu.current) menu.current.open = false;
                  }}
                >
                  {labels.profile}
                </Link>
                <Link
                  href="/settings"
                  className="rounded-md px-2 py-1.5 hover:bg-subtle"
                  onClick={() => {
                    if (menu.current) menu.current.open = false;
                  }}
                >
                  {labels.settings}
                </Link>
                {signOut}
              </div>
            </details>
          </div>
        </SiteHeader>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-7xl min-w-0 px-4 py-7 sm:px-7 lg:px-9"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
