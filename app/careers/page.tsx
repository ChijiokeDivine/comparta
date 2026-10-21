// app/careers/page.tsx
import type { Metadata } from "next";
import {
  ArrowRight,
  Code2,
  Globe2,
  Heart,
  Layers,
  MapPin,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Join Comparta — help build the financial operating system for modern teams. Open roles in engineering, product, design, and growth.",
  alternates: { canonical: "/careers" },
};

const VALUES = [
  {
    icon: Zap,
    title: "Ship with urgency",
    body: "We move fast, ship often, and treat every week as a chance to make the product meaningfully better for teams that depend on us.",
  },
  {
    icon: Layers,
    title: "Correctness over cleverness",
    body: "Money systems demand rigor. We prefer append-only ledgers, dual-layer idempotency, and boring reliability over flashy shortcuts.",
  },
  {
    icon: Users,
    title: "Teams first",
    body: "We build for organizations, not just individuals — permissions, audit trails, payroll, and shared balances are first-class citizens.",
  },
  {
    icon: Globe2,
    title: "Global by default",
    body: "USDC and onchain rails let money move in seconds across borders. We design for a world where your team and customers can be anywhere.",
  },
];

const BENEFITS = [
  {
    title: "Competitive compensation",
    body: "Meaningful equity and competitive salary. We want the people who build Comparta to own a real stake in its success.",
  },
  {
    title: "Remote-friendly",
    body: "Work from where you’re most effective. We run async-first with clear written decisions and focused collaboration windows.",
  },
  {
    title: "Health & wellness",
    body: "Comprehensive health coverage and a wellness stipend so you can take care of yourself and the people who matter to you.",
  },
  {
    title: "Learning budget",
    body: "Annual budget for courses, books, conferences, and tools. We invest in the craft that makes our product better.",
  },
  {
    title: "Equipment of your choice",
    body: "Mac or Linux, monitor setup, chair — get what you need to do your best work without fighting your tools.",
  },
  {
    title: "Time off that counts",
    body: "Generous PTO and the expectation that you actually use it. Burnout is a product risk we refuse to accept.",
  },
];

const OPEN_ROLES = [
  {
    id: "senior-fullstack",
    title: "Senior Full-Stack Engineer",
    team: "Engineering",
    location: "Remote · Worldwide",
    type: "Full-time",
    summary:
      "Own end-to-end features across Next.js, Prisma, and Circle’s onchain stack — from ledger correctness to polished product UI.",
  },
  {
    id: "protocol-engineer",
    title: "Protocol / Backend Engineer",
    team: "Engineering",
    location: "Remote · Worldwide",
    type: "Full-time",
    summary:
      "Deep work on settlement, reconciliation, yield, and the append-only systems that keep every dollar accounted for.",
  },
  {
    id: "product-designer",
    title: "Product Designer",
    team: "Design",
    location: "Remote · Worldwide",
    type: "Full-time",
    summary:
      "Shape the visual and interaction language of a financial OS — dashboards, flows, and moments that feel calm under pressure.",
  },
  {
    id: "product-manager",
    title: "Product Manager",
    team: "Product",
    location: "Remote · Worldwide",
    type: "Full-time",
    summary:
      "Define roadmaps for invoicing, payroll, savings, and insights. Partner closely with engineering and design to ship what teams actually need.",
  },
  {
    id: "growth-marketing",
    title: "Growth Marketing Lead",
    team: "Growth",
    location: "Remote · Worldwide",
    type: "Full-time",
    summary:
      "Build the systems that help founders and finance teams discover Comparta — content, lifecycle, partnerships, and measurable acquisition.",
  },
];

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B1E4B]">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden">
        {/* Background — leave blank for your asset */}
        <div className="absolute inset-0 bg-[#0B1E4B]">
          {/* Optional: drop a video or image here
          <video
            src=""
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-cover"
            poster=""
          />
          */}
          {/* Image placeholder */}
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Replace with: <Image src="" alt="" fill className="object-cover" /> */}
          </div>
          <div className="absolute inset-0 bg-black/45" />
        </div>

        <Header />

        <section className="relative">
          <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-center px-4 pb-28 pt-10 text-center sm:px-6 md:h-[78vh] md:pb-24 md:pt-6">
           
            <h1 className="max-w-4xl text-[40px] font-normal leading-[1.08] text-white sm:text-[56px] md:text-[64px] lg:text-[70px]">
              Build the financial OS for modern teams
            </h1>
            <p className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-white/85 md:text-[18px]">
              We’re a small team solving hard problems in money movement,
              custody, and team finance — onchain, correctly, and at scale.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <a
                href="#open-roles"
                className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[14px] font-semibold text-[#0B1E4B] transition-colors hover:bg-[#F2F4F8]"
              >
                View open roles
                <ArrowRight size={16} strokeWidth={2.25} />
              </a>
              
            </div>
          </div>
        </section>
      </div>

      {/* ── Mission strip ── */}
      <section className="border-b border-[#E8ECF2] bg-[#F8F9FC]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 md:items-center md:py-20">
          <div>
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#2A5CE6]">
              Why we exist
            </p>
            <h2 className="text-[28px] font-semibold leading-tight tracking-tight text-[#0B1E4B] sm:text-[34px]">
              Finance tools shouldn’t feel like 2012
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#3E4A6B]">
              Teams still juggle banks, spreadsheets, payroll apps, and wallets
              that weren’t built for organizations. Comparta unifies treasury,
              payments, payroll, savings, and insights on a single ledger —
              backed by Circle custody on Arc.
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-[#3E4A6B]">
              If you care about correctness, product craft, and shipping systems
              that real businesses rely on every day, you’ll feel at home here.
            </p>
          </div>

          {/* Image placeholder — team / office / product */}
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#E8ECF2]">
            {/* Replace with: <Image src="" alt="Comparta team" fill className="object-cover" /> */}
            <div className="absolute inset-0 flex items-center justify-center text-[13px] font-medium text-[#7C8CA6]">
              {/* image */}
            </div>
          </div>
        </div>
      </section>

      {/* ── Values ── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <div className="mb-12 max-w-xl">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#2A5CE6]">
            How we work
          </p>
          <h2 className="text-[28px] font-semibold tracking-tight text-[#0B1E4B] sm:text-[34px]">
            Principles we hire and build by
          </h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {VALUES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-[#E8ECF2] bg-white p-7"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[#F2F4F8]">
                <Icon size={20} strokeWidth={2} className="text-[#2A5CE6]" />
              </div>
              <h3 className="text-[17px] font-semibold text-[#0B1E4B]">{title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#3E4A6B]">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Benefits ── */}
      <section className="bg-[#0B1E4B]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <div className="mb-12 max-w-xl">
          
            <h2 className="text-[28px] font-semibold tracking-tight text-white sm:text-[34px]">
              Support for the whole person
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-white/70">
              We invest in the conditions that let great people do durable work.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <div
                key={b.title}
                className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
                  <Heart size={16} className="text-[#8EB4FF]" />
                </div>
                <h3 className="text-[15px] font-semibold text-white">{b.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-white/65">
                  {b.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Open roles ── */}
      <section id="open-roles" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#2A5CE6]">
              Open roles
            </p>
            <h2 className="text-[28px] font-semibold tracking-tight text-[#0B1E4B] sm:text-[34px]">
              Find your seat at the table
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#3E4A6B]">
              Don’t see a perfect fit? Send a note to{" "}
              <a
                href="mailto:careers@comparta.xyz"
                className="font-medium text-[#2A5CE6] underline-offset-2 hover:underline"
              >
                careers@comparta.xyz
              </a>{" "}
              — we’re always curious about exceptional people.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-[#F2F4F8] px-4 py-2 text-[13px] font-medium text-[#3E4A6B]">
            <Sparkles size={14} className="text-[#2A5CE6]" />
            {OPEN_ROLES.length} open positions
          </div>
        </div>

        <div className="space-y-3">
          {OPEN_ROLES.map((role) => (
            <a
              key={role.id}
              href={`mailto:careers@comparta.xyz?subject=Application: ${encodeURIComponent(role.title)}`}
              className="group flex flex-col gap-4 rounded-2xl border border-[#E8ECF2] bg-white p-6  sm:flex-row sm:items-center sm:justify-between sm:gap-8"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[17px] font-semibold text-[#0B1E4B] group-hover:text-[#2A5CE6] transition-colors">
                    {role.title}
                  </h3>
                  <span className="rounded-full bg-[#F2F4F8] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#3E4A6B]">
                    {role.team}
                  </span>
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-[#3E4A6B]">
                  {role.summary}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px] text-[#7C8CA6]">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={14} />
                    {role.location}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Code2 size={14} />
                    {role.type}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-[14px] font-semibold text-[#2A5CE6]">
                Apply
                <ArrowRight
                  size={16}
                  className="transition-transform group-hover:translate-x-1"
                />
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* ── Culture image band ── */}
      <section className="border-y border-[#E8ECF2] bg-[#F8F9FC]">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-3 md:py-16">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#E8ECF2]"
            >
              {/* Replace with: <Image src="" alt="" fill className="object-cover" /> */}
              <div className="absolute inset-0 flex items-center justify-center text-[12px] font-medium text-[#7C8CA6]">
                {/* image {i} */}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}