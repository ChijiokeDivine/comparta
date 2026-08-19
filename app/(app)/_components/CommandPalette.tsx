// app/(app)/_components/CommandPalette.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import {
  Search as SearchIcon,
  ArrowUpRight as ArrowUpRightIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import {
  LayoutDashboard as DashboardIcon,
  Wallet as WalletIcon,
  Layers as BucketsIcon,
  NotebookTabs as ContactsIcon,
  FileSpreadsheet as InvoicesIcon,
  Link2 as PaymentLinksIcon,
  HandCoins as PayrollIcon,
  PiggyBank as SavingsIcon,
  PieChart as AllocationIcon,
  Repeat as RecurringIcon,
  TrendingUp as InsightsIcon,
  SquarePlus as PlusSquareIcon,
  Settings as SettingsIcon,
  History as HistoryIcon,
  Send as SendIcon,
  FileText as FileIcon,
  Users as UsersIcon,
} from "lucide-react";

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  group: string;
  Icon: ComponentType<{ className?: string }>;
  keywords: string[];
}

const SEARCH_INDEX: SearchItem[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    subtitle: "Overview, balances, KPIs, activity",
    href: "/dashboard",
    group: "Pages",
    Icon: DashboardIcon,
    keywords: ["home", "overview", "summary", "kpi", "balance"],
  },
  {
    id: "wallet",
    title: "Wallet",
    subtitle: "Balances, deposits, on-chain wallet",
    href: "/wallet",
    group: "Pages",
    Icon: WalletIcon,
    keywords: ["wallet", "balance", "deposit", "onchain", "usdc"],
  },
  {
    id: "wallet-transfer",
    title: "New transfer",
    subtitle: "Send USDC to a contact or address",
    href: "/wallet/transfer",
    group: "Quick actions",
    Icon: SendIcon,
    keywords: ["transfer", "send", "pay", "payment", "withdraw"],
  },
  {
    id: "wallet-transfers",
    title: "Transfer history",
    subtitle: "All incoming & outgoing transfers",
    href: "/wallet/transfers",
    group: "Pages",
    Icon: HistoryIcon,
    keywords: ["history", "transfers", "activity", "transactions"],
  },
  {
    id: "buckets",
    title: "Buckets",
    subtitle: "Organize funds into sub-accounts",
    href: "/buckets",
    group: "Pages",
    Icon: BucketsIcon,
    keywords: ["buckets", "accounts", "subaccounts", "ledger"],
  },
  {
    id: "buckets-new",
    title: "New bucket",
    subtitle: "Create a new sub-account",
    href: "/buckets/new",
    group: "Quick actions",
    Icon: PlusSquareIcon,
    keywords: ["new", "create", "bucket", "account"],
  },
  {
    id: "contacts",
    title: "Contacts / Payees",
    subtitle: "Saved recipients and counterparties",
    href: "/contacts",
    group: "Pages",
    Icon: UsersIcon,
    keywords: ["contacts", "payee", "recipients", "vendors"],
  },
  {
    id: "contacts-new",
    title: "New payee",
    subtitle: "Add a new saved recipient",
    href: "/contacts/new",
    group: "Quick actions",
    Icon: PlusSquareIcon,
    keywords: ["new", "add", "payee", "contact", "recipient"],
  },
  {
    id: "invoices",
    title: "Invoices",
    subtitle: "Send receivables & track payment",
    href: "/invoices",
    group: "Pages",
    Icon: InvoicesIcon,
    keywords: ["invoice", "bill", "receivable", "payment request"],
  },
  {
    id: "invoices-new",
    title: "New invoice",
    subtitle: "Bill a customer or counterparty",
    href: "/invoices/new",
    group: "Quick actions",
    Icon: PlusSquareIcon,
    keywords: ["new", "create", "invoice", "bill", "receivable"],
  },
  {
    id: "payment-links",
    title: "Payment Links",
    subtitle: "One-off and reusable checkout links",
    href: "/payment-links",
    group: "Pages",
    Icon: PaymentLinksIcon,
    keywords: ["payment", "payments", "links", "checkout", "cashier"],
  },
  {
    id: "payment-links-new",
    title: "New payment link",
    subtitle: "Create a shareable checkout URL",
    href: "/payment-links/new",
    group: "Quick actions",
    Icon: PlusSquareIcon,
    keywords: ["new", "create", "payment", "checkout", "link"],
  },
  {
    id: "payroll",
    title: "Payroll",
    subtitle: "Runs, payees, approvals & history",
    href: "/payroll",
    group: "Pages",
    Icon: PayrollIcon,
    keywords: ["payroll", "salary", "pay", "payees", "payout"],
  },
  {
    id: "payroll-payees",
    title: "Payroll payees",
    subtitle: "Manage salaried team members",
    href: "/payroll/payees",
    group: "Pages",
    Icon: UsersIcon,
    keywords: ["payees", "employees", "staff", "salary", "team"],
  },
  {
    id: "payroll-run-new",
    title: "New payroll run",
    subtitle: "Start a new payout batch",
    href: "/payroll/runs/new",
    group: "Quick actions",
    Icon: PlusSquareIcon,
    keywords: ["new", "payroll", "run", "payout", "salary"],
  },
  {
    id: "savings",
    title: "Savings / Yield",
    subtitle: "Earn yield on idle USDC",
    href: "/savings",
    group: "Pages",
    Icon: SavingsIcon,
    keywords: ["savings", "yield", "interest", "earn", "apy"],
  },
  {
    id: "savings-rules",
    title: "Savings rules",
    subtitle: "Auto-sweep rules & round-ups",
    href: "/savings/rules",
    group: "Pages",
    Icon: AllocationIcon,
    keywords: ["rules", "sweep", "auto", "round", "savings"],
  },
  {
    id: "savings-rule-new",
    title: "New savings rule",
    subtitle: "Automate saving into a bucket",
    href: "/savings/rules/new",
    group: "Quick actions",
    Icon: PlusSquareIcon,
    keywords: ["new", "create", "savings", "rule", "sweep"],
  },
  {
    id: "allocation-rules",
    title: "Allocation rules",
    subtitle: "Split payments across buckets",
    href: "/allocation-rules",
    group: "Pages",
    Icon: AllocationIcon,
    keywords: ["allocation", "split", "rules", "percent", "distribution"],
  },
  {
    id: "allocation-rules-new",
    title: "New allocation rule",
    subtitle: "Auto-split payments into buckets",
    href: "/allocation-rules/new",
    group: "Quick actions",
    Icon: PlusSquareIcon,
    keywords: ["new", "create", "allocation", "split", "rule"],
  },
  {
    id: "recurring",
    title: "Recurring transfers",
    subtitle: "Scheduled disbursements",
    href: "/recurring",
    group: "Pages",
    Icon: RecurringIcon,
    keywords: ["recurring", "scheduled", "cron", "repeat", "auto"],
  },
  {
    id: "insights",
    title: "Insights",
    subtitle: "Spending, cashflow, categories",
    href: "/insights",
    group: "Pages",
    Icon: InsightsIcon,
    keywords: ["insights", "analytics", "reports", "cashflow", "spending"],
  },
  {
    id: "settings",
    title: "Settings",
    subtitle: "Account, org, security & KYB",
    href: "/settings",
    group: "Pages",
    Icon: SettingsIcon,
    keywords: ["settings", "preferences", "account", "kyb", "security"],
  },
];

function score(query: string, item: SearchItem): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  let score = 0;
  const title = item.title.toLowerCase();
  const subtitle = item.subtitle.toLowerCase();
  const keywords = item.keywords.map((k) => k.toLowerCase());

  if (title === q) return 1000;
  if (title.startsWith(q)) score += 80;
  if (title.includes(q)) score += 40;

  for (const kw of keywords) {
    if (kw === q) score += 100;
    else if (kw.startsWith(q)) score += 30;
    else if (kw.includes(q)) score += 15;
  }

  if (subtitle.includes(q)) score += 10;

  const tokens = q.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (title.includes(t)) score += 12;
    if (keywords.some((k) => k.includes(t))) score += 8;
  }

  return score;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim();
    const ranked = SEARCH_INDEX.map((item) => ({
      item,
      s: score(q, item),
    }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 10)
      .map((r) => r.item);

    return ranked;
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((v) => Math.min(v + 1, Math.max(0, results.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((v) => Math.max(0, v - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = results[active];
        if (target) {
          onClose();
          router.push(target.href);
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, active, onClose, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-transparent backdrop-blur-[5px]" />

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-2xl border border-[#E5E9F2] bg-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 border-b border-[#F2F4F8]">
          <SearchIcon className="w-5 h-5 text-[#7C8CA6] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, actions, payments…"
            className="flex-1 h-14 bg-transparent text-[#0B1E3F] placeholder:text-[#7C8CA6] text-sm focus:outline-none"
          />
          <div className="hidden sm:flex items-center gap-1 text-[11px] text-[#7C8CA6]">
            <kbd className="rounded border border-[#E5E9F2] bg-[#F7F8FB] px-1.5 py-0.5 font-medium">
              ESC
            </kbd>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[#7C8CA6]">
              {query.trim()
                ? `No results for "${query}"`
                : "Start typing to search pages & quick actions"}
            </div>
          ) : (
            grouped(results).map(([group, items]) => (
              <div key={group} className="mb-3 last:mb-1">
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide uppercase text-[#7C8CA6]">
                  {group}
                </p>
                <ul className="space-y-0.5">
                  {items.map((it, i) => {
                    const flatIndex = results.indexOf(it);
                    const isActive = flatIndex === active;
                    return (
                      <li key={it.id}>
                        <button
                          onMouseEnter={() => setActive(flatIndex)}
                          onClick={() => {
                            onClose();
                            router.push(it.href);
                          }}
                          className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                            isActive ? "bg-[#EEF2FF]" : "hover:bg-[#F7F8FB]"
                          } ${pathname === it.href ? "ring-1 ring-inset ring-[#E5E9F2]" : ""}`}
                        >
                          <span
                            className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${
                              isActive ? "bg-white text-[#2A5CE6]" : "bg-[#F7F8FB] text-[#3E4A6B]"
                            }`}
                          >
                            <it.Icon className="w-4.5 h-4.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[#0B1E3F] truncate">
                              {it.title}
                              {pathname === it.href && (
                                <span className="ml-2 text-[10px] font-medium text-[#7C8CA6] uppercase tracking-wide">
                                  Current
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-[#7C8CA6] truncate">
                              {it.subtitle}
                            </p>
                          </div>
                          <ArrowUpRightIcon className="w-4 h-4 shrink-0 text-[#7C8CA6]" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-[#F2F4F8] text-[11px] text-[#7C8CA6]">
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1">
              <kbd className="rounded border border-[#E5E9F2] bg-[#F7F8FB] px-1.5 py-0.5 font-medium">
                ↑↓
              </kbd>
              navigate
            </span>
            <span className="hidden sm:flex items-center gap-1">
              <kbd className="rounded border border-[#E5E9F2] bg-[#F7F8FB] px-1.5 py-0.5 font-medium">
                ↵
              </kbd>
              open
            </span>
          </div>
          <span className="hidden md:flex">
            Press{" "}
            <kbd className="rounded border border-[#E5E9F2] bg-[#F7F8FB] px-1.5 py-0.5 font-medium text-[10px] mx-1">
              ⌘
            </kbd>
            <kbd className="rounded border border-[#E5E9F2] bg-[#F7F8FB] px-1.5 py-0.5 font-medium text-[10px]">
              K
            </kbd>{" "}
            to open
          </span>
        </div>
      </div>
    </div>
  );
}

function grouped(items: SearchItem[]): [string, SearchItem[]][] {
  const order = ["Quick actions", "Pages"];
  const map = new Map<string, SearchItem[]>();
  for (const it of items) {
    if (!map.has(it.group)) map.set(it.group, []);
    map.get(it.group)!.push(it);
  }
  return order
    .filter((g) => map.has(g))
    .concat(Array.from(map.keys()).filter((g) => !order.includes(g)))
    .map((g) => [g, map.get(g)!]);
}
