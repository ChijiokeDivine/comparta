// app/components/navLinks.ts
//
// Single source of truth for the PUBLIC marketing navigation (desktop
// dropdowns + mobile drawer). Every `href` below must point at a route that
// actually exists in this app — the previous version of the nav shipped
// `href="#"` placeholders, which is a dead end for anyone browsing the site
// before signing up.
//
// The destinations are the real authenticated product areas. A signed-out
// visitor clicking one is bounced to /login by middleware.ts and returned
// to the page after signing in, which is the correct behavior for a
// product-led nav. Items with no shipped equivalent yet are marked
// `comingSoon` and render as non-interactive rows instead of fake links.

import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BookOpen,
  Calculator,
  Contact,
  CreditCard,
  FileText,
  Landmark,
  PiggyBank,
  Repeat,
  Settings,
  TrendingUp,
  Users,
  Webhook,
} from "lucide-react";

export interface MarketingNavItem {
  label: string;
  /** Omitted only for `comingSoon` items. */
  href?: string;
  icon: LucideIcon;
  comingSoon?: boolean;
}

export interface MarketingNavSection {
  key: "personal" | "business" | "developer";
  label: string;
  columns: 1 | 2 | 3;
  items: MarketingNavItem[];
}

export const MARKETING_NAV: MarketingNavSection[] = [
  {
    key: "personal",
    label: "Personal",
    columns: 3,
    items: [
      { label: "Wallet & transfers", href: "/wallet", icon: ArrowLeftRight },
      { label: "Savings", href: "/savings", icon: PiggyBank },
      { label: "Payment links", href: "/payment-links", icon: CreditCard },
      { label: "Contacts", href: "/contacts", icon: Contact },
    ],
  },
  {
    key: "business",
    label: "Business",
    columns: 3,
    items: [
      { label: "Invoicing", href: "/invoices", icon: FileText },
      { label: "Payroll", href: "/payroll", icon: Users },
      { label: "Buckets", href: "/buckets", icon: Landmark },
      { label: "Allocation rules", href: "/allocation-rules", icon: Calculator },
      { label: "Recurring transfers", href: "/recurring", icon: Repeat },
      { label: "Insights", href: "/insights", icon: TrendingUp },
    ],
  },
  {
    key: "developer",
    label: "Developer",
    columns: 1,
    items: [
      { label: "API documentation", icon: BookOpen, comingSoon: true },
      { label: "Webhooks & events", icon: Webhook, comingSoon: true },
      { label: "API keys & team", href: "/settings", icon: Settings },
    ],
  },
];
