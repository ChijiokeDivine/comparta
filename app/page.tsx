
"use client";

import Image from "next/image";
import { useState, useEffect } from "react";


export default function Home() {
  const [lordIconProps, setLordIconProps] = useState({
    trigger: "in",
    delay: "1500",
    state: "in-reveal",
  });

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
              className="rounded-sm bg-[#2A5CE6] px-7 py-3 text-[15px] font-semibold text-white  transition-transform hover:-translate-y-0.5 hover:bg-[#2450d1]"
            >
              Sign up for free
            </a>
          </div>

          {/* Mobile menu button */}
          <button className="flex flex-col gap-1.5 md:hidden" aria-label="Open menu">
            <span className="h-0.5 w-6 bg-[#0B1E3F]" />
            <span className="h-0.5 w-6 bg-[#0B1E3F]" />
            <span className="h-0.5 w-4 bg-[#0B1E3F]" />
          </button>
        </div>
      </header>

      {/* Hero section with background image */}
      <section className="relative overflow-hidden" >
       

        <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-center px-4 py-20 text-center sm:px-6 md:h-[70vh]">
          <h1 className="text-[45px] font-normal leading-[1.05] text-[#0B1E3F] sm:text-[68px] md:text-[76px] lg:text-[80px] xl:text-[86px]">
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
            className="mt-10 inline-flex items-center gap-3 rounded-sm bg-[#2A5CE6] px-9 py-3 text-[16px] font-semibold text-white "
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
    </div>
    </>
  );

}

function NavDropdown({ label }: { label: string }) {
  return (
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
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

  );
  
}