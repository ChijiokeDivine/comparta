"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  X,
  Copy,
  Check,
  Network,
  Clock3,
  CircleDollarSign,
} from "lucide-react";
import QRCodeStyling from "qr-code-styling";

interface DepositModalProps {
  open: boolean;
  onClose: () => void;
  address: string;
  chain?: string;
}

export default function DepositModal({
  open,
  onClose,
  address,
  chain = "ARC",
}: DepositModalProps) {
  const qrRef = useRef<HTMLDivElement | null>(null);
  const qrInstance = useRef<QRCodeStyling | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !qrRef.current || !address) return;

    if (!qrInstance.current) {
      qrInstance.current = new QRCodeStyling({
        width: 260,
        height: 260,
        data: address,
        margin: 0,
        qrOptions: {
          typeNumber: 0,
          mode: "Byte",
          errorCorrectionLevel: "Q",
        },
        imageOptions: {
          hideBackgroundDots: true,
          imageSize: 0.28,
          margin: 8,
          crossOrigin: "anonymous",
        },
        dotsOptions: {
          color: "#0B1E3F",
          type: "rounded",
        },
        backgroundOptions: {
          color: "#FFFFFF",
        },
        cornersSquareOptions: {
          color: "#0B1E3F",
          type: "extra-rounded",
        },
        cornersDotOptions: {
          color: "#2A5CE6",
          type: "dot",
        },
        image: "/small-logo.webp",
      });
    } else {
      qrInstance.current.update({ data: address });
    }

    qrRef.current.innerHTML = "";
    qrInstance.current.append(qrRef.current);
  }, [open, address]);

  if (!open) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // no-op
    }
  }

 

  // function truncateMiddle(addr: string, start = 8, end = 6) {
  //   if (addr.length <= start + end + 3) return addr;
  //   return `${addr.slice(0, start)}…${addr.slice(-end)}`;
  // }

  const displayChain =
    chain && chain.includes("_")
      ? chain.split("_").map((w) => w[0] + w.slice(1).toLowerCase()).join(" ")
      : chain;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-title"
    >
      <button
        aria-label="Close deposit modal"
        onClick={onClose}
        className="absolute inset-0 bg-[#0B1E3F]/50 backdrop-blur-[2px] animate-[fadeIn_.15s_ease]"
        tabIndex={-1}
      />

      <div className="relative w-full max-w-[720px] rounded-2xl bg-white shadow-[0_24px_80px_-20px_rgba(11,30,63,0.35)] animate-[popIn_.18s_ease] overflow-hidden">
        <div className="flex items-start justify-between px-6 pt-6 pb-2">
          <div>
           
            <h2
              id="deposit-title"
              className="text-xl font-semibold text-[#0B1E3F]"
            >
              Deposit USDC
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-[#7C8CA6] hover:bg-[#FAF9F6] hover:text-[#0B1E3F] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 pt-2">
            <div className="flex justify-center shrink-0 mx-auto sm:mx-0">
              <div className="relative p-4 rounded-xl border border-[#E5E9F2]">
                <div ref={qrRef} className="w-[260px] h-[260px]" />
              </div>
            </div>

            <div className="flex-1 min-w-0 w-full space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#7C8CA6] px-1">
                  Your deposit address
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-[#E5E9F2] bg-[#FAF9F6] px-3.5 py-3">
                  <CircleDollarSign
                    size={18}
                    className="shrink-0 text-[#2A5CE6]"
                  />
                  <code className="flex-1 text-sm font-mono text-[#0B1E3F] truncate">
                    {address}
                  </code>
                  <button
                    onClick={handleCopy}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                      copied
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-white text-[#0B1E3F] border border-[#E5E9F2] hover:border-[#0B1E3F] hover:bg-[#F7F8FB]"
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check size={13} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={13} /> Copy
                      </>
                    )}
                  </button>
                </div>
              
              </div>

              <div className="md:grid grid-cols-3 gap-2.5   hidden">
                <div className="rounded-xl bg-[#FAF9F6] border border-[#FAF9F6] p-3 text-center">
                  <div className="mx-auto mb-1.5 w-8 h-8 rounded-full bg-white border border-[#E5E9F2] flex items-center justify-center text-[#2A5CE6]">
                    <Network size={14} />
                  </div>
                 
                  <p className="text-xs font-semibold text-[#0B1E3F] mt-0.5">
                    {displayChain}
                  </p>
                </div>
                <div className="rounded-xl bg-[#FAF9F6] border border-[#FAF9F6] p-3 text-center">
                  <div className="mx-auto mb-1.5 w-8 h-8 rounded-full bg-white border border-[#E5E9F2] flex items-center justify-center text-[#2A5CE6]">
                    <Clock3 size={14} />
                  </div>
                
                  <p className="text-xs font-semibold text-[#0B1E3F] mt-0.5">
                    ~1 min
                  </p>
                </div>
                <div className="rounded-xl bg-[#FAF9F6] border border-[#FAF9F6] p-3 text-center">
                  <div className="mx-auto mb-1.5 w-8 h-8 rounded-full bg-white  flex items-center justify-center">
                    <Image
                      src="/usdc.png"
                      alt="USDC"
                      width={18}
                      height={18}
                      className="rounded-full"
                    />
                  </div>
               
                  <p className="text-xs font-semibold text-[#0B1E3F] mt-0.5">
                    USDC
                  </p>
                </div>
              </div>
            </div>
          </div>

       

          <div className="mt-1 rounded-xl border border-[#E5EEFF] p-3.5 flex gap-3 md:block hidden">
        
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#0B1E3F]">
                Send only USDC on the {displayChain} network
              </p>
              <p className="text-[11px] leading-relaxed text-[#3E4A6B] ">
                Deposits of other assets or on unsupported chains will be
                irretrievable. Confirm the network in your sending wallet before
                confirming.
              </p>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn {
          from { opacity: 0; transform: translateY(6px) scale(.98) }
          to   { opacity: 1; transform: translateY(0)   scale(1) }
        }
      `}</style>
    </div>
  );
}
