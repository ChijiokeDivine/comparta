"use client";

import { useHideBalances, maskBalance } from "@/app/(app)/_components/HideBalancesProvider";

interface MaskedTotalBalanceProps {
  formatted: string;
}

export default function MaskedTotalBalance({ formatted }: MaskedTotalBalanceProps) {
  const { hideBalances } = useHideBalances();
  const display = maskBalance(`$${formatted}`, hideBalances, true);

  return (
    <p className="text-2xl md:text-4xl font-semibold text-[#0B1E3F] tabular-nums">
      {display}
    </p>
  );
}
