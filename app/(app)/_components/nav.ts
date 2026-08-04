// app/(app)/_components/nav.ts
//
// Single source of truth for the authenticated nav, ordered by feature
// priority per the build spec. `managerOnly` marks items whose underlying
// pages will expose mutation actions restricted to OWNER/ADMIN
// (canManageBucket.ts) — the pages themselves render read-only for MEMBER,
// so items stay visible in the nav (per-page gating happens when those
// pages are built) rather than being hidden outright.

import type { ComponentType } from "react";
import {
  DashboardIcon,
  WalletIcon,
  BucketsIcon,
  ContactsIcon,
  InvoicesIcon,
  PaymentLinksIcon,
  PayrollIcon,
  SavingsIcon,
  RecurringIcon,
  InsightsIcon,
} from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  managerOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/wallet", label: "Wallet", icon: WalletIcon },
  { href: "/buckets", label: "Buckets", icon: BucketsIcon, managerOnly: true },
  { href: "/contacts", label: "Contacts", icon: ContactsIcon },
  { href: "/invoices", label: "Invoices", icon: InvoicesIcon },
  { href: "/payment-links", label: "Payment Links", icon: PaymentLinksIcon },
  { href: "/payroll", label: "Payroll", icon: PayrollIcon, managerOnly: true },
  { href: "/savings", label: "Savings", icon: SavingsIcon, managerOnly: true },
  { href: "/recurring", label: "Recurring Transfers", icon: RecurringIcon },
  { href: "/insights", label: "Insights", icon: InsightsIcon },
];