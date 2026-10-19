"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import {
  ArrowLeftRight,
  Code2,
  CreditCard,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { NavDropdown } from "./NavDropdown";

const PERSONAL_ITEMS: { label: string; icon: LucideIcon }[] = [
  { label: "Grow & Invest", icon: TrendingUp },
  { label: "Move Money", icon: ArrowLeftRight },
  { label: "Payments", icon: CreditCard },
];

const BUSINESS_ITEMS: { label: string; icon: LucideIcon }[] = [
  { label: "Account & Payments", icon: Wallet },
  { label: "Spend & Invoices", icon: Receipt },
  { label: "Payroll", icon: Users },
];

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="relative z-20 w-full">
      <div className="mx-auto flex max-w-[1920px] items-center justify-between px-4 py-6 sm:px-6 md:px-8">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/img5.png" alt="Comparta" height={35} width={110} />
        </Link>

        <nav className="hidden items-center gap-10 md:flex">
          <NavDropdown label="Personal" />
          <NavDropdown label="Business" />
          <NavDropdown label="Developer" />
        </nav>

        <div className="hidden items-center gap-8 md:flex">
          <a
            href="/login"
            className="text-[14px] font-semibold text-[#FFFFFF] hover:opacity-80"
          >
            Log in
          </a>
          <a href="/register" className="btn-3d btn-3d--sm">
            Open account
          </a>
        </div>

        <button
          className="flex flex-col gap-1.5 md:hidden"
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <span
            className={`h-0.5 w-6 bg-[#FFFFFF] transition-all duration-300 ${
              mobileMenuOpen ? "translate-y-2 rotate-45" : ""
            }`}
          />
          <span
            className={`h-0.5 w-6 bg-[#FFFFFF] transition-all duration-300 ${
              mobileMenuOpen ? "-translate-y-2 -rotate-45 " : ""
            }`}
          />
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 bg-white z-50 overflow-y-auto">
          <div className="max-w-[1920px] mx-auto px-4 py-6">
            <div className="flex justify-end mb-4">
              <button
                className="p-2 rounded-full hover:bg-[#F2F4F8]"
                aria-label="Close menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0B1E3F"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="space-y-10">
              <div>
                <h3 className="text-[12px] font-semibold text-[#7C8CA6] uppercase tracking-wider mb-4">
                  Personal
                </h3>
                <div className="space-y-3">
                  {PERSONAL_ITEMS.map(({ label, icon: Icon }) => (
                    <a
                      key={label}
                      href="#"
                      className="flex items-center gap-3 px-3 py-0 rounded-lg hover:bg-[#F2F4F8] transition-colors"
                    >
                      <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                        <Icon size={20} strokeWidth={2} color="#0B1E3F" />
                      </div>
                      <span className="text-[14px] font-medium text-[#0B1E3F]">
                        {label}
                      </span>
                    </a>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-[12px] font-semibold text-[#7C8CA6] uppercase tracking-wider mb-4">
                  Business
                </h3>
                <div className="space-y-3">
                  {BUSINESS_ITEMS.map(({ label, icon: Icon }) => (
                    <a
                      key={label}
                      href="#"
                      className="flex items-center gap-3 px-3 py-0 rounded-lg hover:bg-[#F2F4F8] transition-colors"
                    >
                      <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                        <Icon size={20} strokeWidth={2} color="#0B1E3F" />
                      </div>
                      <span className="text-[14px] font-medium text-[#0B1E3F]">
                        {label}
                      </span>
                    </a>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-[12px] font-semibold text-[#7C8CA6] uppercase tracking-wider mb-4">
                  Developer
                </h3>
                <div className="space-y-3">
                  <a
                    href="#"
                    className="flex items-center gap-3 px-3 py-0 rounded-lg hover:bg-[#F2F4F8] transition-colors"
                  >
                    <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                      <Code2 size={20} strokeWidth={2} color="#0B1E3F" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-[#0B1E3F]">
                        API
                      </span>
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-[#2A5CE6] text-white uppercase tracking-wider">
                        Soon
                      </span>
                    </div>
                  </a>
                </div>
              </div>
            </nav>

            <div className="mt-12 flex flex-col gap-4 items-center">
              <a
                href="/login"
                className="text-[16px] font-semibold text-[#2F6FF0] hover:opacity-80 text-center"
              >
                Log in
              </a>
              <a
                href="/register"
                className="btn-3d text-center"
                style={{
                  "--btn-bg": "#2A5CE6",
                  "--btn-bg-hover": "#2450d1",
                  "--btn-edge": "#1A3FA8",
                  "--btn-edge-hover": "#17358f",
                  color: "#ffffff",
                  width: "85%",
                  padding: "16px 0 16px 0",
                } as CSSProperties}
              >
                Sign up for free
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
