// app/(app)/dashboard/_components/QuickActions.tsx
"use client";

import Link from "next/link";
import { 
  Wallet as WalletIcon, 
  FileText as InvoicesIcon, 
  Link2 as PaymentLinksIcon, 
  Contact as ContactsIcon 
} from "lucide-react";


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
    <div className="flex flex-wrap gap-3">
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        return disabled ? (
          <div
            key={action.href}
            title="Available once your organization's KYB is approved"
            aria-disabled="true"
            className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[#E5E9F2] bg-white px-4 py-3 text-left opacity-50 cursor-not-allowed w-fit"
          >
            <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-[#7C8CA6]" />
            </span>
            <span className="text-xs font-semibold text-[#3E4A6B]">{action.label}</span>
          </div>

        ) : (
        <Link
          key={action.href}
          href={action.href}
          className="flex flex-row items-center justify-center rounded-3xl border border-[#E5E9F2] bg-white pl-1 pr-5 py-1 text-left hover:border-[#FFFFFF] transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5CE6] w-fit "
        >
          <span className="w-9 h-9 rounded-full flex items-center justify-center">
            <Icon className="w-3 h-3 text-[#2A5CE6]" />
          </span>
          <span className="text-xs font-semibold text-[#0B1E3F]">{action.label}</span>
        </Link>


        );
      })}
    </div>
  );
}