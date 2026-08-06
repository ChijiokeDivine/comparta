// app/(app)/_components/icons.tsx
//
// Minimal inline SVG icon set for the authenticated app shell. Deliberately
// hand-rolled (not lucide-react or another package) since we can't confirm
// an icon library is installed in this project — same stroke-based style
// already used for icons in app/page.tsx (viewBox 0 0 24 24, strokeWidth 2).

type IconProps = { className?: string };

const base = "w-5 h-5";

export function DashboardIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function WalletIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path strokeLinecap="round" d="M3 10h18" />
      <path strokeLinecap="round" d="M16 14.5h2" />
    </svg>
  );
}

export function BucketsIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16l-1.5 12.5a2 2 0 0 1-2 1.5H7.5a2 2 0 0 1-2-1.5L4 7Z" />
      <path strokeLinecap="round" d="M2.5 7h19M9 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

export function ContactsIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="9" cy="8" r="3.25" />
      <path strokeLinecap="round" d="M3.5 19.5c0-3.31 2.46-6 5.5-6s5.5 2.69 5.5 6" />
      <path strokeLinecap="round" d="M16 4.5a3.25 3.25 0 0 1 0 6.5M18.5 19.5c0-2.8-1.7-5.13-4-5.85" />
    </svg>
  );
}

export function InvoicesIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3.5h9l3 3v14H6z" />
      <path strokeLinecap="round" d="M9 9.5h6M9 13h6M9 16.5h4" />
    </svg>
  );
}

export function PaymentLinksIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 13.5 13.5 10.5" />
      <path strokeLinecap="round" d="M8.5 15.5 6 18a3 3 0 0 1-4-4.5l3-3a3 3 0 0 1 4.24 0" />
      <path strokeLinecap="round" d="M15.5 8.5 18 6a3 3 0 1 1 4.5 4l-3 3a3 3 0 0 1-4.24 0" />
    </svg>
  );
}

export function PayrollIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="9" cy="12" r="2.25" />
      <path strokeLinecap="round" d="M14 10.5h4M14 13.5h4M6 17.5c.5-1.7 1.9-2.7 3-2.7s2.5 1 3 2.7" />
    </svg>
  );
}

export function SavingsIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12.5c0-4.5 3.5-8 8.5-8 3 0 4.8 1.3 5.8 2.5H20l-1 3h-2.2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12.5v3.8c0 1 .8 1.7 1.8 1.7H8v2M17 15v2.5c0 1.1-.9 2-2 2h-.5" />
      <circle cx="14" cy="11" r=".75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AllocationIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="6" cy="6" r="3" />
      <path strokeLinecap="round" d="M6 9v3a3 3 0 0 0 3 3h3M18 15v-3a3 3 0 0 0-3-3H12" />
      <circle cx="18" cy="18" r="3" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RecurringIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 0 1 13.5-5.8M20 12a8 8 0 0 1-13.5 5.8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.5 3v3.5H14M6.5 21v-3.5H10" />
    </svg>
  );
}

export function InsightsIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 20V10M11 20V4M18 20v-7" />
    </svg>
  );
}

export function SettingsIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.19.66.44 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function MenuIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function CloseIcon({ className = base }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function ArrowUpRightIcon({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}

export function PlusIcon({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}