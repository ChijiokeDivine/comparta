// app/(app)/_components/nav.ts
//
// Single source of truth for the authenticated nav, ordered by feature
// priority per the build spec. Items with a `children` array render as
// collapsible groups in the sidebar; leaf items render as plain links.
//
// `managerOnly` marks items whose underlying pages expose mutation
// actions restricted to OWNER/ADMIN (canManageBucket.ts) — the pages
// themselves render read-only for MEMBER, so items stay visible in the
// nav (per-page gating happens when those pages are built).

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
  AllocationIcon,
  RecurringIcon,
  InsightsIcon,
  TransfersIcon,
  PlusIcon,
  HistoryIcon,
  MoveIcon,
  SendIcon,
  UserPlusIcon,
  UsersIcon,
  PlayIcon,
  ListIcon,
  FilePlusIcon,
  BucketPlusIcon,
  RulesIcon,
  SavingsBucketIcon,
  AlertIcon,
  TagIcon,
} from "./icons";

export interface NavChild {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  managerOnly?: boolean;
}

export interface NavItem {
  href?: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  managerOnly?: boolean;
  children?: NavChild[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },

  {
    href: "/wallet",
    label: "Wallet",
    icon: WalletIcon,
    children: [
      { href: "/wallet/transfer", label: "New transfer", icon: SendIcon },
      { href: "/wallet/move", label: "Move between buckets", icon: MoveIcon, managerOnly: true },
      { href: "/recurring", label: "Recurring transfers", icon: RecurringIcon },
      { href: "/wallet/transfers", label: "Transfer history", icon: HistoryIcon },
    ],

  },


  {
    href: "/buckets",
    label: "Buckets",
    icon: BucketsIcon,
    managerOnly: true,
    children: [
      { href: "/buckets/new", label: "New bucket", icon: BucketPlusIcon, managerOnly: true },
    ],
  },

  {
    href: "/contacts",
    label: "Contacts",
    icon: ContactsIcon,

  },

  {
    href: "/invoices",
    label: "Invoices",
    icon: InvoicesIcon,
    children: [
      { href: "/invoices/new", label: "New invoice", icon: FilePlusIcon },
    ],
  },

  {
    href: "/payment-links",
    label: "Payment Links",
    icon: PaymentLinksIcon,

  },

  {
    href: "/payroll",
    label: "Payroll",
    icon: PayrollIcon,
    managerOnly: true,
    children: [

      { href: "/payroll/payees", label: "Payees", icon: UsersIcon, managerOnly: true },
      { href: "/payroll/payees/new", label: "New payee", icon: UserPlusIcon, managerOnly: true },
      { href: "/payroll/runs/new", label: "Run payroll", icon: PlayIcon, managerOnly: true },
    ],
  },

  {
    href: "/savings",
    label: "Savings",
    icon: SavingsIcon,
    managerOnly: true,
    children: [
      { href: "/savings/rules", label: "Savings rules", icon: RulesIcon, managerOnly: true },
      { href: "/savings/rules/new", label: "New rule", icon: PlusIcon, managerOnly: true },
    ],
  },

  {
    href: "/allocation-rules",
    label: "Allocation Rules",
    icon: AllocationIcon,
    managerOnly: true,

  },

  // { href: "/recurring", label: "Recurring Transfers", icon: RecurringIcon },

  {
    href: "/insights",
    label: "Insights",
    icon: InsightsIcon,

  },
];
