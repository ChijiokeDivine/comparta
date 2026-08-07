// app/(app)/dashboard/_components/QuickActions.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Wallet as WalletIcon,
  FileText as InvoicesIcon,
  Link2 as PaymentLinksIcon,
  Contact as ContactsIcon,
  ArrowDownLeft as DepositIcon,
} from "lucide-react";
import DepositModal from "./DepositModal";

interface QuickAction {
  href?: string;
  label: string;
  icon: typeof WalletIcon;
  action?: "deposit";
}

const ACTIONS: QuickAction[] = [
  { label: "New deposit", icon: DepositIcon, action: "deposit" },
  { href: "/wallet/transfer", label: "New transfer", icon: WalletIcon },
  { href: "/invoices/new", label: "New invoice", icon: InvoicesIcon },
  { href: "/payment-links/new", label: "New payment link", icon: PaymentLinksIcon },
  { href: "/contacts/new", label: "New payee", icon: ContactsIcon },
];

interface QuickActionsProps {
  disabled: boolean;
  wallet?: { arcAddress: string; chain?: string } | null;
}

export default function QuickActions({ disabled, wallet }: QuickActionsProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {ACTIONS.map((action, idx) => {
          const Icon = action.icon;
          const isActive = idx === 0 && hoveredIdx === null;
          const isHighlighted = hoveredIdx === idx || isActive;

          const onClick =
            action.action === "deposit"
              ? () => setDepositOpen(true)
              : undefined;

          const inner = (
            <>
              <span className="w-9 h-9 rounded-full flex items-center justify-center">
                <Icon
                  className={`w-3 h-3 ${isHighlighted ? "text-white" : "text-[#2A5CE6]"}`}
                />
              </span>
              <span
                className={`text-xs font-semibold ${isHighlighted ? "text-white" : "text-[#0B1E3F]"}`}
              >
                {action.label}
              </span>
            </>
          );

          const baseClass = `flex flex-row items-center justify-center rounded-3xl border pl-1 pr-5 py-1 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5CE6] w-fit ${
            isHighlighted
              ? "bg-[#2A5CE6] border-[#2A5CE6]"
              : "bg-white border-[#E5E9F2]"
          }`;

          if (disabled) {
            return (
              <div
                key={action.label}
                title="Available once your organization's KYB is approved"
                aria-disabled="true"
                className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[#E5E9F2] bg-white px-4 py-3 text-left opacity-50 cursor-not-allowed w-fit"
              >
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-[#7C8CA6]" />
                </span>
                <span className="text-xs font-semibold text-[#3E4A6B]">
                  {action.label}
                </span>
              </div>
            );
          }

          if (action.action === "deposit") {
            return (
              <button
                key={action.label}
                type="button"
                onClick={onClick}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className={baseClass}
                disabled={!wallet}
                title={!wallet ? "No wallet provisioned yet" : undefined}
              >
                {inner}
              </button>
            );
          }

          return (
            <Link
              key={action.href!}
              href={action.href!}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={baseClass}
            >
              {inner}
            </Link>
          );
        })}
      </div>

      <DepositModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        address={wallet?.arcAddress ?? ""}
        chain={wallet?.chain}
      />
    </>
  );
}
