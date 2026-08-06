// app/(app)/_components/AppShell.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import type { KybStatus, UserRole } from "@/app/generated/prisma/client";
import { NAV_ITEMS } from "./nav";
import { KybPill } from "./Kyb";
import { 
  Menu as MenuIcon, 
  X as CloseIcon, 
  ChevronDown as ChevronDownIcon, 
  Settings as SettingsIcon 
} from "lucide-react";


const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const userName = session?.user?.name ?? session?.user?.email ?? "Account";
  const userEmail = session?.user?.email ?? "";
  const role = session?.user?.role ?? "MEMBER";
  const initials = getInitials(session?.user?.name, session?.user?.email);

  return (
    <div className="min-h-screen flex bg-[#F7F8FB]">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r border-[#E5E9F2] bg-white">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <Link href="/dashboard" className="flex items-center">
            <img src="/logo.png" alt="Comparta" height={50} width={110} />
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item.href)} />
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
            <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
              {NAV_ITEMS.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                  onClick={() => setMobileNavOpen(false)}
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
        <header className="h-16 shrink-0 border-b border-[#E5E9F2] bg-white flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="md:hidden w-9 h-9 -ml-1 flex items-center justify-center rounded-full hover:bg-[#F2F4F8]"
            >
              <MenuIcon className="w-5 h-5 text-[#0B1E3F]" />
            </button>
            <span className="font-semibold text-[#0B1E3F] truncate">{orgName}</span>
            {/* <span className="hidden sm:inline-flex">
              <KybPill status={kybStatus} />
            </span> */}
          </div>

          <UserMenu userName={userName} userEmail={userEmail} role={role} initials={initials} />
        </header>

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

function SidebarLink({
  item,
  active,
  onClick,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-3 py-3 my-2 text-sm font-medium transition-colors ${
        active ? "bg-[#EEF2FF] text-[#2A5CE6]" : "text-[#3E4A6B] hover:bg-[#F2F4F8]"
      }`}
    >
      <Icon className="w-5 h-5" />
      {item.label}
    </Link>
  );
}

function UserMenu({
  userName,
  userEmail,
  role,
  initials,
}: {
  userName: string;
  userEmail: string;
  role: UserRole;
  initials: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-[#F2F4F8] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5CE6]"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="w-8 h-8 rounded-full bg-[#0B1E3F] text-white text-xs font-semibold flex items-center justify-center">
          {initials}
        </span>
        <ChevronDownIcon className={`w-4 h-4 text-[#7C8CA6] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
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
            onClick={() => setOpen(false)}
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

function getInitials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email || "";
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}