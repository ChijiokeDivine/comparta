// app/(app)/_components/AppShell.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect, useMemo } from "react";
import { signOut, useSession } from "next-auth/react";
import type { KybStatus, UserRole } from "@/app/generated/prisma/client";
import { NAV_ITEMS, type NavItem, type NavChild } from "./nav";
import { KybPill } from "./Kyb";
import CommandPalette from "./CommandPalette";
import { ChevronDownIcon, SettingsIcon } from "./icons";
import {
  Menu as MenuIcon,
  X as CloseIcon,
  Search as SearchIcon,
  Eye as EyeIcon,
  EyeOff as EyeOffIcon,
} from "lucide-react";
import { useHideBalances } from "./HideBalancesProvider";


const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

// Figures out which top-level nav group should start expanded, based on
// whichever group's href (or a child's href) matches the current route.
// Used as a lazy useState initializer so there's no closed->open flash
// on first paint.
function getInitialActiveGroup(pathname: string | null): string | null {
  for (const item of NAV_ITEMS) {
    const children = item.children ?? [];
    const parentActive = item.href ? isActive(pathname, item.href) : false;
    const anyChildActive = children.some((c) => isActive(pathname, c.href));
    if (parentActive || anyChildActive) return item.label;
  }
  return null;
}

export default function AppShell({
  orgName,
  kybStatus,
  children,
}: {
  orgName: string;
  kybStatus: KybStatus;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { hideBalances, toggleHideBalances } = useHideBalances();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Single source of truth for which sidebar group is expanded. Only one
  // id can be active at a time — opening a new group implicitly closes
  // whatever was open before. Shared between the desktop sidebar and the
  // mobile drawer since they render the same NAV_ITEMS.
  const [activeDropdown, setActiveDropdown] = useState<string | null>(() =>
    getInitialActiveGroup(pathname)
  );

  const toggleDropdown = (id: string) => {
    setActiveDropdown((prev) => (prev === id ? null : id));
  };

  const openDropdown = (id: string) => {
    setActiveDropdown(id);
  };

  const closeDropdowns = () => {
    setActiveDropdown(null);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const rawUserName = session?.user?.name ?? session?.user?.email ?? "there";
  const userEmail = session?.user?.email ?? "";
  const role = session?.user?.role ?? "MEMBER";
  const initials = getInitials(session?.user?.name, session?.user?.email);

  const { displayName, greeting } = useMemo(() => {
    const name = formatDisplayName(rawUserName);
    const hour = now.getHours();
    let g: string;
    if (hour >= 5 && hour < 12) g = "Good morning";
    else if (hour >= 12 && hour < 18) g = "Good afternoon";
    else if (hour >= 18 && hour < 22) g = "Good evening";
    else g = "Welcome";
    return { displayName: name, greeting: g };
  }, [rawUserName, now]);

  return (
    <div className="min-h-screen flex bg-[#F7F8FB]">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0  border-r border-[#E5E9F2] bg-white">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <Link href="/dashboard" className="flex items-center">
            <img src="/logo.png" alt="Comparta" height={50} width={110} />
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto scrollbar-hide px-3 py-5 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavSection
              key={item.label}
              item={item}
              pathname={pathname}
              userRole={role}
              dropdownId={item.label}
              activeDropdown={activeDropdown}
              toggleDropdown={toggleDropdown}
              openDropdown={openDropdown}
            />
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-[#E5E9F2]">
          <Link
            href="/settings"
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive(pathname, "/settings")
                ? "bg-[#EEF2FF] text-[#2A5CE6]"
                : "text-[#3E4A6B] hover:bg-[#F2F4F8]"
            }`}
          >
            <SettingsIcon className="w-5 h-5" />
            Settings
          </Link>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-white flex flex-col">
            <div className="h-16 flex items-center justify-between px-5">
              <img src="/logo.png" alt="Comparta" height={32} width={97} />
              <button
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close menu"
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#F2F4F8]"
              >
                <CloseIcon className="w-5 h-5 text-[#0B1E3F]" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto scrollbar-hide px-3 py-2 space-y-0.5">
              {NAV_ITEMS.map((item) => (
                <NavSection
                  key={item.label}
                  item={item}
                  pathname={pathname}
                  userRole={role}
                  onClickChild={() => setMobileNavOpen(false)}
                  dropdownId={item.label}
                  activeDropdown={activeDropdown}
                  toggleDropdown={toggleDropdown}
                  openDropdown={openDropdown}
                />
              ))}
              <Link
                href="/settings"
                onClick={() => setMobileNavOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive(pathname, "/settings")
                    ? "bg-[#EEF2FF] text-[#2A5CE6]"
                    : "text-[#3E4A6B] hover:bg-[#F2F4F8]"
                }`}
              >
                <SettingsIcon className="w-5 h-5" />
                Settings
              </Link>
            </nav>
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        <header className="h-16 shrink-0 border-b border-[#E5E9F2] bg-white flex items-center justify-between px-4 sm:px-6 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="md:hidden w-9 h-9 -ml-1 flex items-center justify-center rounded-full hover:bg-[#F2F4F8]"
            >
              <MenuIcon className="w-5 h-5 text-[#0B1E3F]" />
            </button>
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-[#0B1E3F] leading-none mb-1 md:block hidden">
                {greeting}, {displayName}
              </span>
             
            </div>
            {/* <span className="hidden sm:inline-flex">
              <KybPill status={kybStatus} />
            </span> */}
            
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden md:flex items-center gap-3 w-full max-w-md mx-auto h-10 px-3.5 rounded-lg border border-[#E5E9F2] bg-white transition-colors group focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E5E9F2]"
          >
            <SearchIcon className="w-4 h-4 text-[#7C8CA6] shrink-0" />
            <span className="flex-1 text-left text-sm text-[#7C8CA6] truncate">
              Search pages, actions, payments…
            </span>
            <kbd className="hidden lg:inline-flex items-center gap-1 text-[10px] text-[#7C8CA6] font-medium">
              <span className="rounded border border-[#E5E9F2] bg-[#F7F8FB] px-1.5 py-0.5">
                ⌘
              </span>
              <span className="rounded border border-[#E5E9F2] bg-[#F7F8FB] px-1.5 py-0.5">
                K
              </span>
            </kbd>
          </button>

          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search"
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#F2F4F8]"
            >
              <SearchIcon className="w-5 h-5 text-[#0B1E3F]" />
            </button>
            <button
              type="button"
              onClick={toggleHideBalances}
              aria-label={hideBalances ? "Show balances" : "Hide balances"}
              title={hideBalances ? "Show balances" : "Hide balances"}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-[#F7F8FB] hover:bg-[#F2F4F8] transition-colors text-[#3E4A6B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5CE6] p-1 cursor-pointer"
            >
              {hideBalances ? (
                <EyeOffIcon className="w-5 h-5" />
              ) : (
                <EyeIcon className="w-5 h-5" />
              )}
            </button>
            <UserMenu
              userName={rawUserName}
              userEmail={userEmail}
              role={role}
              initials={initials}
              isOpen={activeDropdown === "user-menu"}
              onToggle={() => toggleDropdown("user-menu")}
              onClose={closeDropdowns}
            />
          </div>
        </header>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="sm:hidden mb-4">
              {/* <KybPill status={kybStatus} /> */}
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function isManager(role: UserRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

function NavSection({
  item,
  pathname,
  userRole,
  onClickChild,
  dropdownId,
  activeDropdown,
  toggleDropdown,
  openDropdown,
}: {
  item: NavItem;
  pathname: string | null;
  userRole: UserRole;
  onClickChild?: () => void;
  dropdownId: string;
  activeDropdown: string | null;
  toggleDropdown: (id: string) => void;
  openDropdown: (id: string) => void;
}) {
  const children = useMemo(
    () =>
      (item.children ?? []).filter((c) => !c.managerOnly || isManager(userRole)),
    [item.children, userRole]
  );

  const hasChildren = children.length > 0;

  // If managerOnly is set and user isn't a manager, skip the whole group
  // unless it has children that are visible (which shouldn't really happen
  // since children inherit, but this guards against a bad nav config).
  const canViewGroup = !item.managerOnly || isManager(userRole);
  if (!canViewGroup && children.length === 0) return null;

  const parentHref = item.href;
  const parentActive = parentHref ? isActive(pathname, parentHref) : false;
  const anyChildActive = children.some((c) => isActive(pathname, c.href));

  // Open state is derived from the single shared `activeDropdown` id owned
  // by AppShell — not local state — so opening one group always closes
  // whichever other group was open.
  const open = activeDropdown === dropdownId;

  // Auto-expand this group (and thus collapse any other open group, since
  // openDropdown replaces the shared id) whenever navigation lands on a
  // route inside it — e.g. via browser back/forward or the cmd-k palette.
  useEffect(() => {
    if (parentActive || anyChildActive) openDropdown(dropdownId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentActive, anyChildActive, dropdownId]);

  if (!hasChildren) {
    // Plain leaf item — no children, no chevron, no toggle.
    return (
      <SidebarLink
        item={item}
        active={parentActive}
        href={parentHref ?? "#"}
      />
    );
  }

  const groupAccent =
    parentActive || anyChildActive
      ? "bg-[#EEF2FF] text-[#2A5CE6]"
      : "text-[#3E4A6B] hover:bg-[#F2F4F8]";

  const parentClasses = `group w-full flex items-center gap-3 rounded-xl px-3 py-3 my-1 text-sm font-medium transition-colors ${groupAccent}`;

  const chevronButton = (
    <button
      type="button"
      aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleDropdown(dropdownId);
      }}
      className="w-6 h-6 -mr-1 flex items-center justify-center rounded-md text-[#7C8CA6] hover:text-[#0B1E3F] hover:bg-white/70 transition-colors"
    >
      <ChevronDownIcon
        className={`w-4 h-4 transition-transform duration-200 ${
          open ? "rotate-180" : ""
        }`}
      />
    </button>
  );

  return (
    <div className="space-y-0.5">
      {parentHref ? (
        <Link href={parentHref} className={parentClasses}>
          <item.icon className="w-5 h-5 shrink-0" />
          <span className="flex-1 text-left truncate">{item.label}</span>
          {chevronButton}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => toggleDropdown(dropdownId)}
          className={parentClasses}
        >
          <item.icon className="w-5 h-5 shrink-0" />
          <span className="flex-1 text-left truncate">{item.label}</span>
          {chevronButton}
        </button>
      )}

      {open && (
        <div className="pl-3 space-y-0.5">
          {children.map((child) => (
            <SidebarChildLink
              key={child.href}
              child={child}
              active={isActive(pathname, child.href)}
              onClick={onClickChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarLink({
  item,
  active,
  onClick,
  href,
}: {
  item: { label: string; icon: NavItem["icon"] };
  active: boolean;
  onClick?: () => void;
  href: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-3 py-3 my-1 text-sm font-medium transition-colors ${
        active ? "bg-[#EEF2FF] text-[#2A5CE6]" : "text-[#3E4A6B] hover:bg-[#F2F4F8]"
      }`}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SidebarChildLink({
  child,
  active,
  onClick,
}: {
  child: NavChild;
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = child.icon;
  return (
    <Link
      href={child.href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors ${
        active
          ? "bg-[#EEF2FF] text-[#2A5CE6]"
          : "text-[#5A6886] hover:bg-[#F2F4F8] hover:text-[#0B1E3F]"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{child.label}</span>
    </Link>
  );
}

function UserMenu({
  userName,
  userEmail,
  role,
  initials,
  isOpen,
  onToggle,
  onClose,
}: {
  userName: string;
  userEmail: string;
  role: UserRole;
  initials: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    if (isOpen) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [isOpen, onClose]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-[#F2F4F8] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5CE6] cursor-pointer bg-[#F7F8FB]"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <span className="w-8 h-8 rounded-full bg-[#0B1E3F] text-white text-xs font-semibold flex items-center justify-center">
          {initials}
        </span>
        <ChevronDownIcon className={`w-4 h-4 text-[#7C8CA6] transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl border border-[#E5E9F2] shadow-lg py-2 z-50">
          <div className="px-4 py-2.5 border-b border-[#F2F4F8]">
            <p className="text-sm font-semibold text-[#0B1E3F] truncate">{userName}</p>
            {userEmail && <p className="text-xs text-[#7C8CA6] truncate">{userEmail}</p>}
            <span className="mt-2 inline-block rounded-full bg-[#F2F4F8] text-[#3E4A6B] text-[11px] font-semibold px-2 py-0.5">
              {ROLE_LABEL[role]}
            </span>
          </div>
          <Link
            href="/settings"
            className="block px-4 py-2.5 text-sm text-[#3E4A6B] hover:bg-[#F2F4F8]"
            onClick={onClose}
          >
            Account settings
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function formatDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "there";

  const localPart = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
  const parts = localPart.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0] ?? localPart;

  const MAX_LEN = 14;
  if (first.length > MAX_LEN) {
    return first.slice(0, MAX_LEN - 1).trimEnd() + "…";
  }
  return first;
}

function getInitials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email || "";
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}