import Image from "next/image";
import Link from "next/link";

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Invoicing", href: "/invoices" },
      { label: "Payment Links", href: "/payment-links" },
      { label: "Payroll", href: "/payroll" },
      { label: "Smart Savings", href: "/savings" },
      { label: "Send & Receive", href: "/wallet" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Careers", href: "/careers" },
      { label: "Blog", href: "/blog" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Help Center", href: "/help" },
      { label: "Developer API", href: "/developers" },
      { label: "Security", href: "/security" },
      { label: "Status", href: "/status" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Compliance", href: "/compliance" },
      { label: "Cookie Policy", href: "/cookies" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative w-full overflow-hidden bg-[#000000]">
      <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-10 md:px-16">
        <div className="flex flex-col gap-6 border-b border-white/10 py-16 sm:py-20 md:flex-row md:items-center md:justify-between">
          <h2 className="max-w-xl text-3xl font-normal tracking-tight text-white sm:text-4xl md:text-5xl">
            Ready to move money like it&apos;s easy?
          </h2>
          <a
            href="#"
            className="group hidden w-fit shrink-0 items-center gap-2 rounded-full bg-[#2A5CE6] px-6 py-3.5 text-sm font-semibold text-[#ffffff] transition-colors hover:bg-[#2450d1]/90 sm:text-base md:inline-flex"
          >
            Create your account
          </a>
        </div>

        <div className="grid grid-cols-2 gap-10 py-14 sm:grid-cols-3 sm:py-16 lg:grid-cols-5 lg:gap-8">
          <div className="col-span-2 flex flex-col gap-4 sm:col-span-3 lg:col-span-1">
            <Link href="/" className="flex w-fit items-center gap-2">
              <Image src="/img5.png" alt="Comparta" height={42} width={135} />
            </Link>
          </div>

          {FOOTER_COLUMNS.map(({ title, links }) => (
            <div key={title} className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-white">{title}</h3>
              <ul className="flex flex-col gap-3">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="text-sm text-white/50 transition-colors hover:text-white"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 border-t border-white/10 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/40">
            © {new Date().getFullYear()} Comparta. All rights reserved.
          </p>
        </div>
      </div>

      <div className="pointer-events-none relative select-none overflow-hidden">
        <p className="-mb-[4vw] pb-12 text-center text-[20vw] font-bold leading-none tracking-tight text-white/[0.18] sm:-mb-[3vw] sm:text-[16vw]">
          Comparta
        </p>
      </div>
    </footer>
  );
}
