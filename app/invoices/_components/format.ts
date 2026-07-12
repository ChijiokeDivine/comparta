// app/invoices/_components/format.ts
//
// Client-safe display helpers. Deliberately doesn't import anything
// server-only (Prisma, node:crypto, etc) — this runs in the browser.

export type InvoiceStatus = "DRAFT" | "SENT" | "VIEWED" | "PAID" | "OVERDUE" | "VOID";

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Viewed",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};

export const STATUS_CLASSES: Record<InvoiceStatus, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600 border-zinc-200",
  SENT: "bg-blue-50 text-blue-700 border-blue-200",
  VIEWED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
  OVERDUE: "bg-red-50 text-red-700 border-red-200",
  VOID: "bg-zinc-100 text-zinc-400 border-zinc-200 line-through decoration-1",
};

export function formatMoney(decimalString: string, currency: string = "USDC"): string {
  const [whole, frac = ""] = decimalString.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${frac.padEnd(2, "0").slice(0, 2)} ${currency}`;
}

export function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatRelativeTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays > 1) return `${diffDays} days ago`;
  if (diffDays === -1) return "tomorrow";
  return `in ${Math.abs(diffDays)} days`;
}

export const EVENT_LABEL: Record<string, string> = {
  CREATED: "Invoice created",
  SENT: "Sent to recipient",
  VIEWED: "Viewed by recipient",
  REMINDER_SENT: "Reminder sent",
  PAID: "Payment received",
  VOID: "Voided",
};