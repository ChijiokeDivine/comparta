// app/(app)/dashboard/_components/QuickActions.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Wallet as WalletIcon,
  FileText as InvoicesIcon,
  Link2 as PaymentLinksIcon,
  Contact as ContactsIcon,
  ArrowDownLeft as DepositIcon,
  Plus as CreateWalletIcon,
} from "lucide-react";
import DepositModal from "@/app/components/DepositModal";

interface QuickAction {
  href?: string;
  label: string;
  icon: typeof WalletIcon;
  action?: "deposit" | "create-wallet";
  hideOnMobile?: boolean;
}

const BASE_ACTIONS: QuickAction[] = [
  { href: "/wallet/transfer", label: "New transfer", icon: WalletIcon },
  { href: "/invoices/new", label: "New invoice", icon: InvoicesIcon, hideOnMobile: true },
  { href: "/payment-links/new", label: "New payment link", icon: PaymentLinksIcon },
  { href: "/contacts/new", label: "New payee", icon: ContactsIcon },
];

interface QuickActionsProps {
  disabled: boolean;
  wallet?: { arcAddress: string; chain?: string | null } | null;
  appUserId: string;
  onrampEnabled: boolean;
}

export default function QuickActions({
  disabled,
  wallet,
  appUserId,
  onrampEnabled,
}: QuickActionsProps) {
  const router = useRouter();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // The first action is "New deposit" once a wallet exists, and
  // "Create wallet" before that. Everything else stays the same.
  const actions: QuickAction[] = wallet
    ? [{ label: "New deposit", icon: DepositIcon, action: "deposit" }, ...BASE_ACTIONS]
    : [
        { label: creatingWallet ? "Creating wallet…" : "Create wallet", icon: CreateWalletIcon, action: "create-wallet" },
        ...BASE_ACTIONS,
      ];

  async function handleCreateWallet() {
    if (creatingWallet) return;
    setCreateError(null);
    setCreatingWallet(true);
    try {
      const res = await fetch("/api/wallet", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(data.error ?? "Could not create wallet");
        return;
      }
      // Re-render the server component with the new wallet prop.
      router.refresh();
    } catch {
      setCreateError("Could not create wallet");
    } finally {
      setCreatingWallet(false);
    }
  }

  return (
    <>
      <div className="flex flex-nowrap md:flex-wrap gap-3 overflow-x-auto md:overflow-visible snap-x snap-mandatory pb-1 md:pb-0 mx-2 md:mx-0 px-4 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none]">
        {actions.map((action, idx) => {
          const Icon = action.icon;
          const isActive = idx === 0 && hoveredIdx === null;
          const isHighlighted = hoveredIdx === idx || isActive;

          const onClick =
            action.action === "deposit"
              ? () => setDepositOpen(true)
              : action.action === "create-wallet"
                ? handleCreateWallet
                : undefined;

          const inner = (
            <>
              <span className="w-9 h-9 rounded-full flex items-center justify-center">
                <Icon
                  className={`w-3 h-3 ${isHighlighted ? "text-white" : "text-[#333333]"}`}
                />
              </span>
              <span
                className={`text-xs font-semibold ${isHighlighted ? "text-white" : "text-[#0B1E3F]"}`}
              >
                {action.label}
              </span>
            </>
          );

          const baseClass = `flex flex-row items-center justify-center rounded-3xl border pl-1 pr-5 py-0 md:py-0 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5CE6] w-fit shrink-0 snap-start ${
            action.hideOnMobile ? "hidden md:flex" : ""
          } ${
            isHighlighted
              ? "bg-[#2A5CE6] border-[#2A5CE6]"
              : "bg-white border-[#E5E9F2]"
          }`;

          if (disabled) {
            return (
              <div
                key={action.label}
                title="Temporarily unavailable"
                aria-disabled="true"
                className={`flex flex-row items-center justify-start gap-3 rounded-2xl border border-[#E5E9F2] bg-white px-4 py-3 text-left opacity-50 cursor-not-allowed w-fit shrink-0 snap-start ${
                  action.hideOnMobile ? "hidden md:flex" : ""
                }`}
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

          if (action.action) {
            return (
              <button
                key={action.label}
                type="button"
                onClick={onClick}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className={baseClass}
                disabled={action.action === "create-wallet" ? creatingWallet : !wallet}
                title={
                  action.action === "deposit" && !wallet
                    ? "Create a wallet first"
                    : undefined
                }
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

      {createError && (
        <p className="mt-2 px-4 text-xs text-red-600">{createError}</p>
      )}

      <DepositModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        address={wallet?.arcAddress ?? ""}
        chain={wallet?.chain ?? undefined}
        appUserId={appUserId}
        onrampEnabled={onrampEnabled}
        onDepositSettled={() => router.refresh()}
      />
    </>
  );
}
