
"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { NavDropdown, MobileNavDropdown } from "./components/NavDropdown";




export default function Home() {
  interface FloatingTile {
    image: string;
    alt: string;
    rotate: string;
  }

  interface TestItem {
    image: string;
    title: string;
    description: string;
  }


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


    const floatingTiles: FloatingTile[] = [
      { image: "/images/tests/xray-legs.jpg", alt: "X-ray of legs", rotate: "-rotate-[8deg]" },
      { image: "/images/tests/dexa-scan.jpg", alt: "DEXA scan", rotate: "rotate-[6deg]" },
      { image: "/images/tests/mri-vascular.jpg", alt: "MRI vascular scan", rotate: "-rotate-[5deg]" },
      { image: "/images/tests/lung-scan.jpg", alt: "Lung scan", rotate: "rotate-[4deg]" },
      { image: "/images/tests/cardiac-vessels.jpg", alt: "Cardiac blood vessels", rotate: "-rotate-[6deg]" },
      { image: "/images/tests/spine-xray.jpg", alt: "Spine X-ray", rotate: "rotate-[10deg]" },
      { image: "/images/tests/vo2-mask.jpg", alt: "VO2 max testing mask", rotate: "rotate-[9deg]" },
    ];

    // duplicated once for a seamless loop
    const tickerTiles: FloatingTile[] = [...floatingTiles, ...floatingTiles];

    const tests: TestItem[] = [
      { image: "/images/tests/whole-body-mri.jpg", title: "Whole Body MRI", description: "Detects abnormalities across the body." },
      { image: "/images/tests/blood-panel.jpg", title: "Advanced Blood Panel", description: "In-depth blood analysis." },
      { image: "/images/tests/vo2-max.jpg", title: "VO2 Max Testing", description: "Measures oxygen uptake and endurance." },
      { image: "/images/tests/dexa.jpg", title: "DEXA Body Composition Testing", description: "Analyzes body fat, muscle, and bone density." },
      { image: "/images/tests/ct-angiography.jpg", title: "CT Coronary Angiography", description: "Assesses coronary blockages and heart risk." },
      { image: "/images/tests/plaque.jpg", title: "AI Coronary Plaque Characterization", description: "Identifies high-risk plaque features." },
      { image: "/images/tests/hereditary.jpg", title: "Hereditary Diseases Screening", description: "Screens genetic disease risk." },
      { image: "/images/tests/cgm.jpg", title: "Continuous Glucose Monitoring", description: "Tracks blood sugar continuously." },
      { image: "/images/tests/lung-ct.jpg", title: "Low Dose Lung CT Scan", description: "Detects early lung cancer signs." },
    ];

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
            <img src="logo.png" alt="Comparta" height={42} width={135} />
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
                        <span className="text-[14px] font-medium text-[#0B1E3F]">
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
                        <span className="text-[14px] font-medium text-[#0B1E3F]">
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
       {/*style={{ backgroundImage: `url('/Hands_Reaching_Out-removebg-preview.png')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}*/}

        <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-center px-4 pt-20 pb-[78px] text-center sm:px-6 md:h-[65vh]">
          <h1 className="text-[40px] font-normal leading-[1.05] text-[#0B1E3F] sm:text-[65px] md:text-[70px] lg:text-[70px] xl:text-[80px]">
            Move money like
            <span className="inline max-[349px]:inline">&nbsp;</span>
            <br className="block max-[349px]:hidden" />
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
      <section className="w-full bg-white py-20 px-6 md:py-28">
        <div className="mx-auto max-w-7xl text-center">
          <h2 className="text-3xl md:text-6xl font-normal text-neutral-900 tracking-tight text-center">
            One platform. Every way you{" "}
            <span className="inline-flex items-center gap-2 whitespace-nowrap align-middle">
              move money
              <img
                src="/3d.webp"
                alt="3D icon"
                className="inline-block h-8 md:h-16 w-auto align-middle"
              />
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-sm md:text-lg text-neutral-500 leading-relaxed">
            Send, receive, save, pay bills, pay your team and get spending insights -
            without ever leaving the platform.
          </p>
          <div className="mt-8">
            <button className="rounded-lg bg-neutral-100 px-6 py-3 text-sm font-medium text-neutral-900 hover:bg-neutral-200 transition-colors cursor-pointer">
              Start now
            </button>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* Column 1: Send + Pay bills */}
            <div className="flex flex-col gap-8">
              <div className="flex min-h-[380px] md:min-h-[425px] flex-col rounded-2xl bg-sky-100 py-8 px-10 text-left">
                <p className="text-lg text-neutral-800">
                  Send money instantly, wherever your team or clients are
                </p>
                <div className="relative mt-auto aspect-[4/3] w-full overflow-hidden rounded-xl  flex items-center justify-center">
                  <img
                    src="/send.png"
                    alt="Sending money instantly"
                    className="h-3/4 w-3/4 object-contain"
                  />
                </div>
              </div>

              <div className="flex min-h-[380px] md:min-h-[340px] flex-col rounded-2xl bg-[#0142C2]/20 text-left">
                <div className="relative mt-auto min-h-[380px] md:min-h-[340px] overflow-hidden rounded-xl bg-[#0142C2]/40">
                  <img
                    src="/image2.webp"
                    alt="Automating recurring bills"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute bottom-4 left-4 flex flex-col gap-1 p-4 rounded-lg ">
                    {/* bg-black/40 backdrop-blur-sm */ }
                    <p className="text-lg text-white">
                      Automate recurring bills 
                    </p>
                    <p className="text-sm text-white/80">
                      Never miss a payment again
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Column 2: Receive (image) + Pay your team */}
            <div className="flex flex-col gap-8">
              <div className="relative min-h-[380px] md:min-h-[340px] md:max-h-[347px] overflow-hidden rounded-2xl bg-neutral-100">
                <img
                  src="/smile3.webp"
                  alt="Receiving a payment"
                  className="h-full w-full object-cover"
                />
                <div className="absolute bottom-4 right-4 flex flex-col gap-1 p-4 rounded-lg ">
                  <p className="text-lg text-white ">
                    Receive payments instantly
                  </p>
                  <p className="text-sm text-white/80">
                    Get settled in seconds, not days
                  </p>
                </div>
              </div>

              <div className="flex min-h-[380px] md:min-h-[425px] flex-col rounded-2xl bg-violet-100 py-8 px-10 text-left">
                <p className="text-lg text-neutral-800">
                  Pay your whole team in one click
                </p>
                <div className="relative mt-auto aspect-[4/3] md:aspect-[5/4.5] w-full overflow-hidden rounded-xl flex items-center justify-center">
                  <img
                    src="/pay1.png"
                    alt="Paying your team"
                    className="h-3/4 w-3/4 object-contain"
                  />
                </div>
              </div>
            </div>


          </div>
        </div>
      </section>

    </div>
    </>
  );

}