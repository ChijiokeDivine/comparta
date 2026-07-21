"use client";

import { useState } from "react";

export function NavDropdown({ label }: { label: string }) {
  const [isOpen, setIsOpen] = useState(false);

  // Define dropdown items for each section
  const dropdownData: Record<string, { items: { label: string; icon?: string; isComingSoon?: boolean }[]; columns: number }> = {
    Personal: {
      columns: 3,
      items: [
        { label: "Savings Account", icon: "savings" },
        { label: "Fixed Deposits", icon: "deposit" },
        { label: "Investments", icon: "invest" },
        { label: "Transfers", icon: "transfer" },
        { label: "Payments", icon: "bill" },
      ],
    },
    Business: {
      columns: 3,
      items: [
        { label: "Business Account", icon: "business" },
        { label: "Invoicing", icon: "invoice" },
        { label: "Payroll", icon: "payroll" },
        { label: "Payments", icon: "payment" },
      ],
    },
    Developer: {
      columns: 1,
      items: [
        { label: "API Documentation", icon: "api", isComingSoon: true },
      ],
    },
  };

  const currentData = dropdownData[label] || { columns: 1, items: [] };

  return (
    <div
      className="relative group"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button className="flex items-center gap-1.5 text-[16px] font-medium text-[#FFFFFF] hover:text-[#FFFFFF]">
        {label}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-300 group-hover:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="nav-dropdown-menu">
          <div
            className={`grid gap-6 ${
              currentData.columns === 3
                ? "grid-cols-1 sm:grid-cols-3"
                : "grid-cols-1"
            }`}
          >
            {currentData.items.map((item, idx) => (
              <a
                key={idx}
                href="#"
                className="nav-dropdown-item flex items-center gap-3 px-4 py-1 rounded-lg hover:bg-[#F2F4F8] transition-colors"
              >
                {/* Icon placeholder (you can replace with actual images/icons) */}
                <div className="w-9 h-9 rounded-full bg-[#ffffff] flex items-center justify-center flex-shrink-0">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#0B1E3F"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <path d="M12 17h.01" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-[#0B1E3F]">
                      {item.label}
                    </span>
                    {item.isComingSoon && (
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-[#2A5CE6] text-white uppercase tracking-wider">
                        Soon
                      </span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function MobileNavDropdown({ label }: { label: string }) {
  const [isOpen, setIsOpen] = useState(false);

  // Define dropdown items for each section
  const dropdownData: Record<string, { items: { label: string; icon?: string; isComingSoon?: boolean }[]; columns: number }> = {
    Personal: {
      columns: 3,
      items: [
        { label: "Savings Account", icon: "savings" },
        { label: "Fixed Deposits", icon: "deposit" },
        { label: "Investments", icon: "invest" },
        { label: "Transfers", icon: "transfer" },
        { label: "Bill Payments", icon: "bill" },
      ],
    },
    Business: {
      columns: 3,
      items: [
        { label: "Business Account", icon: "business" },
        { label: "Invoicing", icon: "invoice" },
        { label: "Payroll", icon: "payroll" },
        { label: "Payments", icon: "payment" },
        { label: "Expense Management", icon: "expense" },
      ],
    },
    Developer: {
      columns: 1,
      items: [
        { label: "API Documentation", icon: "api", isComingSoon: true },
      ],
    },
  };

  const currentData = dropdownData[label] || { columns: 1, items: [] };

  return (
    <div>
      <button
        className="flex items-center justify-between w-full text-[16px] font-medium text-[#4A5A78] hover:text-[#0B1E3F]"
        onClick={() => setIsOpen(!isOpen)}
      >
        {label}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Mobile Dropdown Menu */}
      {isOpen && (
        <div className="mt-3 pl-4 border-l-2 border-[#EEF1F8] flex flex-col gap-2">
          {currentData.items.map((item, idx) => (
            <a
              key={idx}
              href="#"
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#F2F4F8] transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-[#EEF1F8] flex items-center justify-center flex-shrink-0">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0B1E3F"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <path d="M12 17h.01" />
                </svg>
              </div>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-[14px] font-medium text-[#0B1E3F]">
                  {item.label}
                </span>
                {item.isComingSoon && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#2A5CE6] text-white uppercase tracking-wider">
                    Soon
                  </span>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
