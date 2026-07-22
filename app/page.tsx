"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import Lenis from "lenis";
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
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [secondTooltipOpen, setSecondTooltipOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const secondTooltipRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    const container = scrollRef.current;
    if (!container) return;
    const cardWidth = container.querySelector("div")?.clientWidth || 400;
    const gap = 24; // matches gap-6
    const scrollAmount = cardWidth + gap;

    container.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };


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

  // Smooth scroll (Lenis), synced with GSAP ScrollTrigger
  useEffect(() => {
    let lenis: Lenis | undefined;

    const init = async () => {
      const { default: gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);

      lenis = new Lenis({
        duration: 1.2,           // higher = smoother/slower, try 1.0-1.6
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        touchMultiplier: 1.5,
      });

      // Keep ScrollTrigger in sync with Lenis's virtual scroll position
      lenis.on("scroll", ScrollTrigger.update);

      // Drive both Lenis and GSAP off the same ticker instead of each other's rAF
      gsap.ticker.add((time) => {
        lenis?.raf(time * 1000);
      });
      gsap.ticker.lagSmoothing(0);
    };

    init();

    return () => {
      lenis?.destroy();
    };
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

    // Close tooltips when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
          setTooltipOpen(false);
        }
        if (secondTooltipRef.current && !secondTooltipRef.current.contains(event.target as Node)) {
          setSecondTooltipOpen(false);
        }
      };

      if (tooltipOpen || secondTooltipOpen) {
        document.addEventListener('mousedown', handleClickOutside);
      }

      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [tooltipOpen, secondTooltipOpen]);


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
      key: "send-receive",
      variant: "hero-card--send",
      lordIconSrc: "https://cdn.lordicon.com/rhmhivzj.json",
      text: "Send and receive USDC instantly with just a username, no wallet address needed.",
      littleText: "Send by username"
    },
    {
      key: "invoices",
      variant: "hero-card--invoice",
      lordIconSrc: "https://cdn.lordicon.com/unsfxkxg.json",
      text: "Send invoices that get paid in seconds, not weeks. Auto-marked paid on settlement.",
      littleText: "Invoices that get paid"
    },
    {
      key: "payment-links",
      variant: "hero-card--links",
      lordIconSrc: "https://cdn.lordicon.com/ymgusxed.json",
      text: "Share one link and get paid by wallet or card, no crypto experience required.",
      littleText: "Get paid by link"
    },
    {
      key: "balances",
      variant: "hero-card--balances",
      lordIconSrc: "https://cdn.lordicon.com/jeznmujs.json",
      text: "Split revenue into Operating, Tax, Payroll, and Savings automatically as it comes in.",
      littleText: "Auto-split your revenue"
    },
    {
      key: "savings",
      variant: "hero-card--savings",
      lordIconSrc: "https://cdn.lordicon.com/tzovitfd.json",
      text: "Put idle cash to work with savings that earn yield quietly in the background.",
      littleText: "Savings that earn yield"
    }
  ];

  const faqData = {
    title: "All your questions answered",
    content: [
      { question: "What exactly is Comparta?", answer: "Comparta is a financial platform for sending, receiving, and managing money in USDC — a digital dollar. You get invoicing, payment links, payroll, multiple balances, and savings, all settling instantly, without needing any crypto experience." },
      { question: "Do I need to understand crypto to use this?", answer: "No. You can send an invoice, share a payment link, or pay your team the same way you would with any banking app. USDC works quietly in the background — your clients can even pay you with a regular card or bank transfer." },
      { question: "What is USDC, and why does Comparta use it?", answer: "USDC is a stablecoin — a digital dollar backed 1:1 by real US dollar reserves. It doesn't fluctuate like Bitcoin or other cryptocurrencies. We use it because it settles in seconds, moves internationally without banking delays, and holds its value." },
      { question: "How fast do payments actually settle?", answer: "Instantly. Once a payment is sent, it lands in seconds — not the 1-3 business days typical of bank transfers or the T+2 settlement common with cards." },
      { question: "Is my money safe with Comparta?", answer: "Your funds are held through regulated custody infrastructure with bank-level security standards. Every transaction is recorded and reconcilable, and your balances are never commingled with other users' funds." },
      { question: "Can I get paid from anywhere in the world?", answer: "Yes. Clients can pay you from a wallet on nearly any major network, or with a card or bank transfer if they don't use crypto at all — it all lands as one unified USDC balance in your account, regardless of where it came from." },
      { question: "How do multiple balances work?", answer: "You can split your incoming revenue into separate buckets — Operating, Tax, Payroll, Savings, or custom ones you name yourself — without opening multiple accounts. Set rules to auto-allocate a percentage of every payment, or move funds between buckets manually." },
      { question: "Can I run payroll for my team through Comparta?", answer: "Yes. Add your team as payees, set a pay schedule, and approve each run with one click. Every payment is tracked individually, so you always know who's been paid and when." },
      { question: "What happens to money I'm not using right away?", answer: "Idle cash in a savings bucket can automatically earn yield in the background, instead of sitting flat. You can redeem back to spendable USDC at any time." },
      { question: "Do I need a business to sign up, or can individuals use Comparta too?", answer: "Both. Freelancers and individuals can send, receive, and save. Registered businesses get additional tools like payroll, team permissions, and multi-user access after a quick verification step." },
      { question: "What's the verification process like?", answer: "For individuals, it's a simple identity check. For businesses, we verify your registration details before enabling money-movement features — this typically takes a few business days and is a one-time step." },
      { question: "What does it cost to use Comparta?", answer: "There's no cost to create an account, send invoices, or generate payment links. Fees apply only where value is created — for card/bank payment processing and select premium features — and are always shown upfront before you confirm." },
      { question: "Can I convert my USDC back to regular cash?", answer: "Yes. You can move funds out to your bank account whenever you need to — USDC is always redeemable 1:1 for US dollars." },
      { question: "What if a payment fails or goes to the wrong place?", answer: "Every transfer requires you to confirm the recipient's name and address before sending, to prevent mistakes. If something does go wrong on our end, our support team can trace and resolve it — every transaction is fully logged and auditable." },
      { question: "Is Comparta available on mobile?", answer: "Yes, Comparta is available on iOS and Android, with full feature parity to the web platform — you can send, invoice, and manage payroll from your phone." }
    ]
  };

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
      {/* Header + Hero shared background wrapper */}
      <div className="relative overflow-hidden">
        {/* Shared background image */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url('/Living+Room+Night_014.webp')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
        {/* Overlay */}
        <div className="absolute inset-0 bg-black/50" />

        {/* Header */}
        <header className="relative z-20 w-full">
          <div className="mx-auto flex max-w-[1920px] items-center justify-between px-4 py-6 sm:px-6 md:px-8">
            {/* Logo */}
            <a href="/" className="flex items-center gap-2">
              <img src="img5.png" alt="Comparta" height={42} width={135} />
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
                className="text-[16px] font-semibold text-[#FFFFFF] hover:opacity-80"
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
        <section className="relative"  >

          <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-end px-4 pt-20 md:pb-20 pb-36  text-center sm:px-6 md:h-[90vh] h-[80vh]">
            <h1 className="text-[40px] font-normal leading-[1.05] text-[#FFFFFF] sm:text-[65px] md:text-[70px] lg:text-[70px] xl:text-[80px] pt-12  md:pt-20">
              Move money like
              <span className="inline max-[349px]:inline">&nbsp;</span>
              <br className="block max-[349px]:hidden" />
              it's easy

             
            </h1>
            

            <p className="mt-9 max-w-[600px] text-[16px] text-[#FFFFFF] md:text-[21px]">
              Comparta unifies invoicing, payments, payroll, and savings. instant settlement, all from one account. 
            </p>
            <a
              href="#"
              className="mt-10 btn-3d "
            >
              <span className="md:block hidden">Create your account</span><span className="md:hidden block">Get started</span>
             
            </a>
          </div>
        </section>
      </div>
      <section className="grow-section " id="grow">
        <h2 className="text-[#0B1E3F] px-6 md:px-16 font-normal text-2xl md:text-5xl tracking-tight text-center py-8 md:pb-8 md:pt-24 md:mt-16 text-left">
          Built around your <br className="md:hidden block" />business
        </h2>
        <div className="grow-sticky " ref={stickyRef}>


          <div className="grow-track" ref={trackRef}>
            {growCards.map((card) => (
              <a href="#" key={card.key} className={`grow-card ${card.variant}`}>
                <div className="grow-illustration" />
                <div className="grow-info">
                  <div className="grow-info-icon">
                    <lord-icon
                      src={card.lordIconSrc}
                      trigger={lordIconProps.trigger}
                      {...(lordIconProps.delay ? { delay: lordIconProps.delay } : {})}
                      {...(lordIconProps.state ? { state: lordIconProps.state } : {})}
                    />
                  </div>
                  <p className="grow-info-text hidden md:block">{card.text}</p>
                  <p className="grow-info-text md:hidden">{card.littleText}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>
      <section className="relative w-full min-h-[70vh] md:min-h-[85vh] overflow-hidden bg-[#2a5ce6]">
      

        {/* Content */}
        <div className="relative z-10 flex flex-col md:flex-row justify-between h-full min-h-[500px] md:min-h-[650px] px-6 sm:px-10 md:px-16 py-20 md:py-20">
          {/* Left: Text */}
          <div className="flex flex-col justify-between md:w-1/2">
            {/* Heading */}
            <div>
              <h1 className="text-white pt-12 sm:pt-16 md:pt-20 font-normal text-3xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight leading-tight">
                Banks make you wait.
              </h1>
              <div className="flex items-center gap-2 sm:gap-3 mt-1 sm:mt-2">
                <h1 className="text-emerald-300 font-normal text-3xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight leading-tight">
                  We don't.
                </h1>
              
              </div>
            </div>

            {/* Footer text */}
            <p className="max-w-md sm:max-w-lg text-sm sm:text-base text-white/70 leading-relaxed mt-10 md:mt-0">
              <span className="text-white font-medium">
                No holding periods. No "3-5 business days."
              </span>{" "}
              Comparta moves money around the clock - nights, weekends, holidays, all the same.
            </p>
          </div>

          {/* Right: Image */}
          <div className="mt-12 md:mt-0 md:w-1/2  flex items-center justify-center">
            <Image
              src="/money.png"
              alt="Illustration"
              width={600}
              height={600}
              className="w-3/4 sm:w-1/2 md:w-full max-w-[200px] sm:max-w-[250px] md:max-w-md h-auto"
            />
          </div>
        </div>

        
      </section>
      <section className="w-full bg-white py-28 px-6 md:py-[180px] ">
        <div className="mx-auto max-w-7xl text-center">
          <h2 className="text-3xl md:text-6xl font-normal text-neutral-900 tracking-tight text-center ">
            <span className="max-[362px]:hidden">One platform.</span> Every way you{" "}
            <span className="inline-flex items-center gap-2 whitespace-nowrap align-middle">
              move money
              <img
                src="/send.png"
                alt="3D icon"
                className="inline-block h-8 md:h-16 w-auto align-middle"
              />
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-sm md:text-lg text-neutral-500 leading-relaxed">
            Everything you need to control spend and optimize finance operations, all on a single platform.
          </p>
    

          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* Column 1: Send + Pay bills */}
            <div className="flex flex-col gap-8">
              <div className="flex min-h-[380px] md:min-h-[425px] flex-col rounded-2xl bg-sky-100 py-8 px-10 text-left">
                <p className="text-xl text-neutral-800">
                  Instant payments, anywhere 
                </p>
                <div className="relative mt-auto aspect-[4/3] w-full overflow-hidden rounded-xl  flex items-center justify-center">
                  <img
                    src="/pay1.png"
                    alt="Sending money instantly"
                    className="h-3/4 w-3/4 object-contain"
                  />
                </div>
              </div>


            </div>

            {/* Column 2: Receive (image) + Pay your team */}
            <div className="flex flex-col gap-8">
        

              <div className="flex min-h-[380px] md:min-h-[425px] flex-col rounded-2xl bg-violet-100 py-8 px-10 text-left">
                <p className="text-xl text-neutral-800">
                  Send money globally for less
                </p>
                <div className="relative mt-auto aspect-[4/3]  w-full overflow-hidden rounded-xl flex items-center justify-center">
                  <img
                    src="/3d.webp"
                    alt="Paying your team"
                    className="h-3/4 w-3/4 object-contain"
                  />
                </div>
              </div>


              
            </div>


          </div>
        </div>
      </section>
      <section className="w-full bg-[#1B1B1B] py-20 sm:py-20 lg:py-28 px-4 sm:px-6 lg:px-8 mt-[50px] ">
        <div className="mx-auto max-w-6xl">
          {/* Heading */}
          <div className="text-center mb-10 sm:mb-14 lg:mb-16 pt-12 sm:pt-16 md:pt-20">
            <h2 className="text-white font-normal tracking-tight text-3xl md:text-6xl leading-[1.1]">
              Two sides of running a business. 
            
            </h2>
            <p className="mt-6 text-gray-400 text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
              Getting paid and paying people out used to mean two different headaches. Comparta handles that.
            </p>
          </div>

          {/* Image cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {/* Get paid, without the chase */}
            <div className="relative rounded-xl overflow-hidden aspect-[4/5] sm:aspect-[3/4] group">
              <img
                src="/image24.webp"
                alt="Get paid, without the chase"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute bottom-0 left-0 p-5 sm:p-6 lg:p-8">
                <h3 className="text-white text-xl sm:text-2xl font-medium">
                  Get paid, without the chase
                </h3>
                <div ref={secondTooltipRef} className="relative inline-block">
                  <button 
                    className="mt-1 text-gray-300 text-sm sm:text-base underline underline-offset-4 decoration-gray-500 hover:text-white transition-colors relative"
                    onClick={() => setSecondTooltipOpen(!secondTooltipOpen)}
                  >
                    Learn more
                  </button>
                  {/* Tooltip */}
                  {secondTooltipOpen && (
                    <div className="absolute bottom-full left-0 mb-3 w-72 sm:w-80 bg-white rounded-xl shadow-2xl p-5 z-20">
                      <div className="absolute -bottom-2 left-4 w-4 h-4 bg-white rotate-45" />
                      <p className="text-gray-800 text-sm leading-relaxed">
                        Send an invoice or a payment link and watch it get paid in seconds, not days. No wondering if the wire went through. Your client pays with a transfer, or a wallet - you just see the money land.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Pay out, without the stress */}
            <div className="relative rounded-xl overflow-hidden aspect-[4/5] sm:aspect-[3/4] group">
              <img
                src="/ejh.webp"
                alt="Pay out, without the stress"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute bottom-0 left-0 p-5 sm:p-6 lg:p-8">
                <h3 className="text-white text-xl sm:text-2xl font-medium">
                 Pay out, without the stress
                </h3>
                <div ref={tooltipRef} className="relative inline-block">
                  <button 
                    className="mt-1 text-gray-300 text-sm sm:text-base underline underline-offset-4 decoration-gray-500 hover:text-white transition-colors relative"
                    onClick={() => setTooltipOpen(!tooltipOpen)}
                  >
                    Learn more
                  </button>
                  {/* Tooltip */}
                  {tooltipOpen && (
                    <div className="absolute bottom-full left-0 mb-3 w-72 sm:w-80 bg-white rounded-xl shadow-2xl p-5 z-20">
                      <div className="absolute -bottom-2 left-4 w-4 h-4 bg-white rotate-45" />
                      <p className="text-gray-800 text-sm leading-relaxed">
                        Payroll, contractors, savings, recurring transfers - set it up once, approve it with one click, and let Comparta handle the rest. Every payment tracked, every balance separated, nothing lost in a spreadsheet.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="relative w-full min-h-[70vh] md:min-h-[85vh] overflow-visible py-16 sm:py-20 md:py-24">
      

  
        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center h-full px-4 sm:px-6 pt-12 sm:pt-16 md:pt-20" >
          <h1 className="text-black font-normal text-4xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight">
            Freedom to move, instantly
          </h1>

          <p className="mt-5 md:mt-6 text-black/80 text-sm  md:text-xl max-w-md sm:max-w-lg md:max-w-xl">
            No queues. No waiting on a bank. Just money that moves the moment you need it to.
          </p>

          <div className="mt-9 sm:mt-12 md:mt-16 w-full max-w-5xl lg:max-w-6xl mx-auto px-4">
            <div className="relative w-full md:aspect-[16/9] aspect-[5/4]  rounded-2xl overflow-hidden">
              <Image
                src="/joy.webp"
                alt="Pay team"
                fill
                className="object-cover"
                priority
              />
            </div>
          </div>
        </div>
      </section>
      <section className="relative w-full bg-[#FBFBFD] py-16 sm:py-20 md:py-28 overflow-hidden">
        {/* Heading */}
        <div className="text-center px-4 sm:px-6 pt-12 sm:pt-16 md:pt-20 mb-12 sm:mb-16 md:mb-20">
          <h2 className="text-black font-normal text-3xl md:text-6xl tracking-tight">
            Built for your business
          </h2>
          <p className="mt-4 sm:mt-6 text-gray-400 text-sm sm:text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
            Different businesses move money differently. Here's what Comparta looks like for yours.
          </p>
        </div>

        {/* Carousel */}
        <div className="relative">
          {/* Left arrow */}
          <button
            onClick={() => scroll("left")}
            className="hidden sm:flex absolute left-2 sm:left-4 md:left-6 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-md items-center justify-center transition-colors"
            aria-label="Previous"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Right arrow */}
          <button
            onClick={() => scroll("right")}
            className="hidden sm:flex absolute right-2 sm:right-4 md:right-6 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-md items-center justify-center transition-colors"
            aria-label="Next"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Scrollable cards */}
          <div
            ref={scrollRef}
            className="flex gap-4 sm:gap-5 md:gap-6 overflow-x-auto snap-x snap-mandatory scroll-smooth px-4 sm:px-8 md:px-16 lg:px-24 scrollbar-hide"
            >
            {/* Card 1 */}
            <div className="relative snap-center shrink-0 w-[85%] sm:w-[70%] md:w-[55%] lg:w-[45%] h-[480px] sm:h-[560px] md:h-[640px] rounded-2xl md:rounded-3xl border border-black/10 bg-black overflow-hidden">
              <button className="absolute top-5 left-5 sm:top-6 sm:left-6 w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-white/30 flex items-center justify-center text-white/70 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>

              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-52 h-52 sm:w-64 sm:h-64 md:w-72 md:h-72 rounded-full bg-gradient-to-br from-purple-700 via-purple-500 to-fuchsia-300 shadow-[0_0_80px_rgba(168,85,247,0.4)]" />
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 bg-gradient-to-t from-[#0a0d10] via-[#0a0d10]/80 to-transparent">
                <h3 className="text-white font-semibold text-lg sm:text-xl mb-2 sm:mb-3">
                  Freelancers
                </h3>
                <p className="text-gray-400 text-sm leading-relaxed sm:hidden">
                  Invoice fast. Get paid faster.
                </p>
                <p className="text-gray-400 text-sm sm:text-base leading-relaxed hidden sm:block">
                  Send an invoice between meetings. Get paid before you've closed your laptop.
                </p>
              </div>
            </div>

            {/* Card 2 */}
            <div className="relative snap-center shrink-0 w-[85%] sm:w-[70%] md:w-[55%] lg:w-[45%] h-[480px] sm:h-[560px] md:h-[640px] rounded-2xl md:rounded-3xl border border-black/10 bg-black overflow-hidden">
              <button className="absolute top-5 left-5 sm:top-6 sm:left-6 w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-white/30 flex items-center justify-center text-white/70 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>

              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-52 h-52 sm:w-64 sm:h-64 md:w-72 md:h-72 rounded-full bg-gradient-to-br from-orange-600 via-amber-500 to-yellow-200 shadow-[0_0_80px_rgba(251,146,60,0.4)]" />
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 bg-gradient-to-t from-[#0a0d10] via-[#0a0d10]/80 to-transparent">
                <h3 className="text-white font-semibold text-lg sm:text-xl mb-2 sm:mb-3">
                  Agencies
                </h3>
                <p className="text-gray-400 text-sm leading-relaxed sm:hidden">
                  Track invoices. Split revenue automatically.
                </p>
                <p className="text-gray-400 text-sm sm:text-base leading-relaxed hidden sm:block">
                  Every client invoice in one view. Revenue splits into tax and payroll on its own.
                </p>
              </div>
            </div>

            {/* Card 3 */}
            <div className="relative snap-center shrink-0 w-[85%] sm:w-[70%] md:w-[55%] lg:w-[45%] h-[480px] sm:h-[560px] md:h-[640px] rounded-2xl md:rounded-3xl border border-black/10 bg-black overflow-hidden">
              <button className="absolute top-5 left-5 sm:top-6 sm:left-6 w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-white/30 flex items-center justify-center text-white/70 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>

              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-52 h-52 sm:w-64 sm:h-64 md:w-72 md:h-72 rounded-full bg-gradient-to-br from-blue-700 via-cyan-500 to-teal-200 shadow-[0_0_80px_rgba(34,211,238,0.4)]" />
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 bg-gradient-to-t from-[#0a0d10] via-[#0a0d10]/80 to-transparent">
                <h3 className="text-white font-semibold text-lg sm:text-xl mb-2 sm:mb-3">
                  Remote Teams
                </h3>
                <p className="text-gray-400 text-sm leading-relaxed sm:hidden">
                  Payroll, anywhere. Paid by username.
                </p>
                <p className="text-gray-400 text-sm sm:text-base leading-relaxed hidden sm:block">
                  Run payroll across time zones. Pay any teammate with just a username.
                </p>
              </div>
            </div>


             {/* Card 4 */}
            <div className="relative snap-center shrink-0 w-[85%] sm:w-[70%] md:w-[55%] lg:w-[45%] h-[480px] sm:h-[560px] md:h-[640px] rounded-2xl md:rounded-3xl border border-black/10 bg-black overflow-hidden">
              <button className="absolute top-5 left-5 sm:top-6 sm:left-6 w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-white/30 flex items-center justify-center text-white/70 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>

              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-52 h-52 sm:w-64 sm:h-64 md:w-72 md:h-72 rounded-full bg-gradient-to-br from-indigo-700 via-violet-500 to-purple-200 shadow-[0_0_80px_rgba(139,92,246,0.4)]" />
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 bg-gradient-to-t from-[#0a0d10] via-[#0a0d10]/80 to-transparent">
                <h3 className="text-white font-semibold text-lg sm:text-xl mb-2 sm:mb-3">
                  Digital Businesses
                </h3>
                <p className="text-gray-400 text-sm leading-relaxed sm:hidden">
                  Get paid instantly. Earn while it sits.
                </p>
                <p className="text-gray-400 text-sm sm:text-base leading-relaxed hidden sm:block">
                  Share a payment link. Watch it settle instantly, then quietly earn yield.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

    
      <section className="w-full bg-white py-20 sm:py-28 px-4 sm:px-6 md:px-16">
        <div className="mx-auto max-w-4xl md:max-w-6xl">
          {/* Heading + Button */}
          <div className="flex items-center md:justify-between  mb-12 md:mb-16 gap-4">
            <h2 className="text-[#0B1E3F] font-normal text-3xl md:text-5xl tracking-tight text-center md:text-left">
              {faqData.title}
            </h2>
            <div className="hidden md:block">
              <a
                href="#"
                className="btn-3d btn-3d--sm"
                style={{
                  '--btn-bg': '#2A5CE6',
                  '--btn-bg-hover': '#2450d1',
                  '--btn-edge': '#1A3FA8',
                  '--btn-edge-hover': '#17358f',
                  color: '#ffffff',
                } as React.CSSProperties}
              >
                Contact support
              </a>
            </div>
        </div>

          {/* Accordion Items */}
          <div className="space-y-4">
            {faqData.content.map((item, index) => {
              const isOpen = openFaqIndex === index;
              return (
                <div key={index} className="border-b border-gray-200 pb-4">
                  <button
                    onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                    className="w-full flex items-center justify-between text-left py-3 focus:outline-none"
                  >
                    <span className="text-[#0B1E3F] font-medium text-base md:text-lg">
                      {item.question}
                    </span>
                    <svg
                      className={`w-5 h-5 text-[#0B1E3F] transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                      isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <p
                        className={`text-[#7C8CA6] text-sm md:text-base leading-relaxed pt-1 pb-1 transition-all duration-300 ${
                          isOpen ? 'opacity-100 translate-y-0 delay-75' : 'opacity-0 -translate-y-1'
                        }`}
                      >
                        {item.answer}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      {/* Footer */}
      <footer className="relative w-full bg-[#000000] overflow-hidden">

        <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-10 md:px-16">
          {/* CTA row */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 py-16 sm:py-20 border-b border-white/10">
            <h2 className="text-white font-normal text-3xl sm:text-4xl md:text-5xl tracking-tight max-w-xl">
              Ready to move money like it&apos;s easy?
            </h2>
            <a
              href="#"
              className="group shrink-0 md:inline-flex items-center gap-2 bg-[#2A5CE6] text-[#ffffff] font-semibold rounded-full px-6 py-3.5 text-sm sm:text-base hover:bg-[#2450d1]/90 transition-colors w-fit hidden "
            >
              Create your account
              
            </a>
          </div>

          {/* Links grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-10 lg:gap-8 py-14 sm:py-16">
            {/* Brand column */}
            <div className="col-span-2 sm:col-span-3 lg:col-span-1 flex flex-col gap-4">
              <a href="/" className="flex items-center gap-2 w-fit">
              
                <img src="img5.png" alt="Comparta" height={42} width={135} />
          
              </a>
           

            </div>

            <FooterColumn
              title="Product"
              links={["Invoicing", "Payment Links", "Payroll", "Smart Savings", "Send & Receive"]}
            />
            <FooterColumn title="Company" links={["About", "Careers", "Blog", "Contact"]} />
            <FooterColumn
              title="Resources"
              links={["Help Center", "Developer API", "Security", "Status"]}
            />
            <FooterColumn
              title="Legal"
              links={["Terms of Service", "Privacy Policy", "Compliance", "Cookie Policy"]}
            />
          </div>

          {/* Bottom bar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 py-8 border-t border-white/10">
            <p className="text-white/40 text-sm">
              © {new Date().getFullYear()} Comparta. All rights reserved.
            </p>

        
          </div>
        </div>

        {/* Giant watermark wordmark */}
        <div className="relative select-none pointer-events-none overflow-hidden">
          <p className="text-center font-bold text-white/[0.18] leading-none text-[20vw] sm:text-[16vw] tracking-tight -mb-[4vw] sm:-mb-[3vw] pb-12">
            Comparta
          </p>
        </div>
      </footer>

    </div>
    </>
  );

}

function FooterColumn({ title, links }: { title: string; links: string[] }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-white text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-3">
        {links.map((link) => (
          <li key={link}>
            <a
              href="#"
              className="text-white/50 text-sm hover:text-white transition-colors"
            >
              {link}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}