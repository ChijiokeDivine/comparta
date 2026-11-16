"use client";

// app/(app)/wallet/_components/DepositButton.tsx
//
// Opens the shared Add funds modal (crypto transfer) from the wallet page.
// Kept as a tiny client island so the wallet page can stay a server
// component.

import { useState } from "react";
import DepositModal from "@/app/components/DepositModal";

interface DepositButtonProps {
  address: string;
  className?: string;
}

export default function DepositButton({
  address,
  className = "",
}: DepositButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className || "btn-3d btn-3d--sm"}
        style={
          {
            "--btn-bg": "#2A5CE6",
            "--btn-bg-hover": "#2450d1",
            "--btn-edge": "#1A3FA8",
            "--btn-edge-hover": "#17358f",
            color: "#ffffff",
          } as React.CSSProperties
        }
      >
        Add funds
      </button>

      <DepositModal
        open={open}
        onClose={() => setOpen(false)}
        address={address}
      />
    </>
  );
}
