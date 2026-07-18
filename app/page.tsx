
"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";



export default function Home() {
  const [lordIconProps, setLordIconProps] = useState({
    trigger: "in",
    delay: "1500",
    state: "in-reveal",
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    const timer = setTimeout(() => {
      setLordIconProps({
        trigger: "hover",
        delay: undefined as unknown as string,
        state: undefined as unknown as string,
      });
    }, 5000);

    return () => clearTimeout(timer);
  }, []);
    // GSAP pinned horizontal scroll for the "grow" cards section
    useEffect(() => {
      let ctx: { revert: () => void } | undefined;

      const init = async () => {
        const { default: gsap } = await import("gsap");
        const { ScrollTrigger } = await import("gsap/ScrollTrigger");
        gsap.registerPlugin(ScrollTrigger);

        const sticky = stickyRef.current;
        const track = trackRef.current;
        if (!sticky || !track) return;

        ctx = gsap.context(() => {
          gsap.to(track, {
            x: () => -(track.scrollWidth - window.innerWidth),
            y: () => {
              // Distance needed to move from top (padding-top: 40px)
              // down to vertically centered within the 100vh sticky viewport
              const centeredOffset = (window.innerHeight - track.offsetHeight) / 2;
              return Math.max(centeredOffset - 40, 0); // 40 = grow-sticky's padding-top
            },
            ease: "none",
            scrollTrigger: {
              trigger: sticky,
              start: "top top",
              end: () => `+=${track.scrollWidth - window.innerWidth}`,
              scrub: 1,
              pin: true,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            },
          });
        }, sticky);
      };

      init();
      return () => ctx?.revert();
    }, []);

    const growCards = [
      {
        key: "savings",
        variant: "grow-card--savings",
        iconPath: "M5 12H19M19 12L13 6M19 12L13 18",
        text: "Automate savings for your important goals, from simple milestones to big dreams.",
        littleText: "Automate savings"
      },
      {
        key: "funds",
        variant: "grow-card--funds",
        iconPath: "M4 17L10 11L14 15L20 7M20 7H15M20 7V12",
        text: "Smart returns without guesswork. Our mutual funds handle it, letting you focus on your goals.",
        littleText: "Smart returns"
      },
      {
        key: "stocks",
        variant: "grow-card--stocks",
        iconPath: "M4 17L10 11L14 15L20 7M20 7H15M20 7V12",
        text: "Co-own Nigeria's top companies, from market leaders to newcomers and grow with them.",
        littleText: "Co-own Nigerian stocks"
      },
      {
        key: "Bonds",
        variant: "grow-card--stocks",
        iconPath: "M4 17L10 11L14 15L20 7M20 7H15M20 7V12",
        text: "Co-own Nigeria's top companies, from market leaders to newcomers and grow with them.",
        littleText: "Co-own Nigerian bonds"
      },
      {
        key: "securities",
        variant: "grow-card--stocks",
        iconPath: "M4 17L10 11L14 15L20 7M20 7H15M20 7V12",
        text: "Co-own Nigeria's top companies, from market leaders to newcomers and grow with them.",
        littleText: "Co-own Nigerian securities"
      },
    ];

  return (
    <>
      <style>{`
        .hero-inline-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          vertical-align: middle;
          margin-left: 10px;
          // transform: translateY(10px);
        }
      `}</style>
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="relative z-20 w-full">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between px-4 py-6 sm:px-6 md:px-8">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2">
            <svg
              width="20"
              height="20"
              viewBox="0 0 36 36"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="1" y="1" width="34" height="34" stroke="#2F6FF0" strokeWidth="1.6" />
              <rect x="5.8" y="5.8" width="24.4" height="24.4" stroke="#2F6FF0" strokeWidth="1.6" />
              <rect x="10.6" y="10.6" width="14.8" height="14.8" stroke="#2F6FF0" strokeWidth="1.6" />
              <rect x="15.2" y="15.2" width="5.6" height="5.6" fill="#2F6FF0" />
            </svg>
            <span className="text-[22px] font-semibold tracking-tight text-[#2F6FF0]">
              Comparta
            </span>
          </a>

          {/* Nav */}
          <nav className="hidden items-center gap-10 md:flex">
            <NavDropdown label="Personal" />
            <NavDropdown label="Business" />
            <NavDropdown label="Developer" />
          </nav>

          {/* Actions */}
          <div className="hidden items-center gap-8 md:flex">
            <a
              href="#"
              className="text-[16px] font-semibold text-[#2F6FF0] hover:opacity-80"
            >
              Log in
            </a>
            <a
              href="#"
              className="btn-3d btn-3d--sm"
            >
              Sign up for free
            </a>
          </div>

          {/* Mobile menu button */}
          <button
            className="flex flex-col gap-1.5 md:hidden"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <span
              className={`h-0.5 w-6 bg-[#0B1E3F] transition-all duration-300 ${
                mobileMenuOpen ? "translate-y-2 rotate-45" : ""
              }`}
            />
            <span
              className={`h-0.5 w-6 bg-[#0B1E3F] transition-all duration-300 ${
                mobileMenuOpen ? "opacity-0" : ""
              }`}
            />
            <span
              className={`h-0.5 w-4 bg-[#0B1E3F] transition-all duration-300 ${
                mobileMenuOpen ? "-translate-y-2 -rotate-45 w-6" : ""
              }`}
            />
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 bg-white z-50 overflow-y-auto">
            <div className="max-w-[1920px] mx-auto px-4 py-6">
              {/* Close button at the top */}
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

              {/* Nav items with all sub-items visible by default, organized by section */}
              <nav className="space-y-10">
                {/* Personal Section */}
                <div>
                  <h3 className="text-[12px] font-semibold text-[#7C8CA6] uppercase tracking-wider mb-4">
                    Personal
                  </h3>
                  <div className="space-y-3">
                    {[
                      "Grow & Invest",
                      "Move Money",
                      "Payments",
                    ].map((item) => (
                      <a
                        key={item}
                        href="#"
                        className="flex items-center gap-3 px-3 py-1 rounded-lg hover:bg-[#F2F4F8] transition-colors"
                      >
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
                        <span className="text-[12px] font-medium text-[#0B1E3F]">
                          {item}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>

                {/* Business Section */}
                <div>
                  <h3 className="text-[12px] font-semibold text-[#7C8CA6] uppercase tracking-wider mb-4">
                    Business
                  </h3>
                  <div className="space-y-3">
                    {[
                      "Account & Payments",
                      "Spend & Invoices",
                      "Payroll",
                      
                    
                    ].map((item) => (
                      <a
                        key={item}
                        href="#"
                        className="flex items-center gap-3 px-3 py-1 rounded-lg hover:bg-[#F2F4F8] transition-colors"
                      >
                        <div className="w-9 h-9 rounded-full bg-[#fffff] flex items-center justify-center flex-shrink-0">
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
                        <span className="text-[12px] font-medium text-[#0B1E3F]">
                          {item}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>

                {/* Developer Section */}
                <div>
                  <h3 className="text-[12px] font-semibold text-[#7C8CA6] uppercase tracking-wider mb-4">
                    Developer
                  </h3>
                  <div className="space-y-3">
                    <a
                      href="#"
                      className="flex items-center gap-3 px-3 py-1 rounded-lg hover:bg-[#F2F4F8] transition-colors"
                    >
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
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-[#0B1E3F]">
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

              {/* Bottom actions */}
              <div className="mt-12 flex flex-col gap-4">
                <a
                  href="#"
                  className="text-[16px] font-semibold text-[#2F6FF0] hover:opacity-80 text-center"
                >
                  Log in
                </a>
                <a
                  href="#"
                  className="btn-3d text-center "
                >
                  Sign up for free
                </a>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Hero section with background image */}
      <section className="relative overflow-hidden" >
       

        <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-center px-4 pt-20 pb-[78px] text-center sm:px-6 md:h-[65vh]">
          <h1 className="text-[45px] font-normal leading-[1.05] text-[#0B1E3F] sm:text-[65px] md:text-[70px] lg:text-[70px] xl:text-[80px]">
            Move money like 
            <br />
            it's easy
            <span className="hero-inline-icon">
      
              <lord-icon
                  src="https://cdn.lordicon.com/rhmhivzj.json"
                  trigger={lordIconProps.trigger}
                  {...(lordIconProps.delay ? { delay: lordIconProps.delay } : {})}
                  {...(lordIconProps.state ? { state: lordIconProps.state } : {})}
                  >
              </lord-icon>
            </span>
           
          </h1>
          

          <p className="mt-9 max-w-[600px] text-[16px] text-[#7C8CA6] md:text-[21px]">
            Comparta unifies invoicing, payments, payroll, and savings. instant settlement, all from one account. 
          </p>

          <a
            href="#"
            className="mt-10 btn-3d "
          >
            <span className="md:block hidden">Create your account</span><span className="md:hidden block">Get started</span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 7v10h10" />
              <path d="M7 17 21 3" />
            </svg>
          </a>
        </div>
      </section>
        <section className="grow-section " id="grow">
          <div className="grow-sticky " ref={stickyRef}>
          

            <div className="grow-track" ref={trackRef}>
              {growCards.map((card) => (
                <a href="#" key={card.key} className={`grow-card ${card.variant}`}>
                  <div className="grow-illustration" />
                  <div className="grow-info">
                    <div className="grow-info-icon">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path
                          d={card.iconPath}
                          stroke="#0B1E4B"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <p className="grow-info-text hidden md:block">{card.text}</p>
                    <p className="grow-info-text md:hidden">{card.littleText}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
    </div>
    </>
  );

}

function NavDropdown({ label }: { label: string }) {
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
      <button className="flex items-center gap-1.5 text-[16px] font-medium text-[#4A5A78] hover:text-[#0B1E3F]">
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

function MobileNavDropdown({ label }: { label: string }) {
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