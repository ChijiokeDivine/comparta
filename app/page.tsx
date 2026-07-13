import Image from "next/image";

export default function Home() {
  return (
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
      <section className="relative overflow-hidden">
        {/* Background image placeholder */}
        <div className="absolute inset-0 -z-10">
          <Image
            src="/image.jpg"
            alt=""
            fill
            priority
            className="object-cover"
          />
          {/* Light overlay so the background image reads subtly, matching the pale hero backdrop */}
          <div className="absolute inset-0 bg-[#F4F7FC]/90" />
        </div>

        <div className="mx-auto flex max-w-[1600px] flex-col items-center px-4 pb-32 pt-20 text-center sm:px-6 md:pt-28">
          <h1 className="text-[56px] font-normal leading-[1.05] text-[#0B1E3F] sm:text-[68px] md:text-[76px] lg:text-[80px] xl:text-[86px]">
            Watch your
            <br />
            money do more
          </h1>

          <p className="mt-9 max-w-[600px] text-[19px] text-[#7C8CA6] md:text-[21px]">
            One app. All your savings and investment needs. Trusted by
            individuals, HNIs, and corporates.
          </p>

          <a
            href="#"
            className="mt-10 inline-flex items-center gap-3 rounded-sm bg-[#2A5CE6] px-9 py-3 text-[16px] font-semibold text-white "
          >
            Start building wealth
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