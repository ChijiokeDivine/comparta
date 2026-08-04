"use client";

import Link from "next/link";
import { WalletIcon, InvoicesIcon, PaymentLinksIcon, ContactsIcon } from "../../_components/icons";

interface QuickAction {
  href: string;
  label: string;
  icon: typeof WalletIcon;
}

const ACTIONS: QuickAction[] = [
  { href: "/wallet/transfer", label: "New transfer", icon: WalletIcon },
  { href: "/invoices/new", label: "New invoice", icon: InvoicesIcon },
  { href: "/payment-links/new", label: "New payment link", icon: PaymentLinksIcon },
  { href: "/contacts/new", label: "New payee", icon: ContactsIcon },
];

export default function QuickActions({ disabled }: { disabled: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        return disabled ? (
          <div
            key={action.href}
            title="Available once your organization's KYB is approved"
            aria-disabled="true"
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#E5E9F2] bg-white px-3 py-4 text-center opacity-50 cursor-not-allowed"
          >
            <span className="w-9 h-9 rounded-full bg-[#F2F4F8] flex items-center justify-center">
              <Icon className="w-4 h-4 text-[#7C8CA6]" />
            </span>
            <span className="text-xs font-semibold text-[#3E4A6B]">{action.label}</span>
          </div>
        ) : (
          <Link
            key={action.href}
            href={action.href}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#E5E9F2] bg-white px-3 py-4 text-center hover:border-[#2A5CE6] hover:shadow-sm transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5CE6]"
          >
            <span className="w-9 h-9 rounded-full bg-[#EEF2FF] flex items-center justify-center">
              <Icon className="w-4 h-4 text-[#2A5CE6]" />
            </span>
            <span className="text-xs font-semibold text-[#0B1E3F]">{action.label}</span>
          </Link>
        );
      })}
    </div>
  );
}