// lib/invoices/money.ts
//
// Line-item math for invoices. Same rule as lib/circle/amount.ts: every
// persisted USDC amount is a bigint in the smallest unit (micro-USDC),
// computed from decimal strings — never Number() math on money.
//
// Quantity is allowed up to 4 decimal places (e.g. "2.5" hours) so this
// scales it into an integer before multiplying against the unit price's
// bigint smallest-unit value, then floor-divides back down. Floor (never
// round up) matches the ledger's "never silently create money" posture —
// a fraction of a micro-USDC is rounded away, not toward the biller.

import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";

const QUANTITY_DECIMALS = 4;
const QUANTITY_SCALE = 10n ** BigInt(QUANTITY_DECIMALS);

export class InvoiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceValidationError";
  }
}

export interface RawLineItemInput {
  description: string;
  /** Decimal string, e.g. "2.5". At most 4 decimal places. */
  quantity: string;
  /** Decimal string, e.g. "125.50". At most 6 decimal places (USDC precision). */
  unitPrice: string;
}

export interface ComputedLineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  /** Decimal string — the authoritative per-line total, server-computed. */
  lineTotal: string;
}

export interface ComputedLineItems {
  items: ComputedLineItem[];
  /** bigint micro-USDC — sum of every line's total. */
  subtotal: bigint;
}

function parseQuantity(raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvoiceValidationError(`"${raw}" isn't a valid quantity.`);
  }
  const [wholePart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > QUANTITY_DECIMALS) {
    throw new InvoiceValidationError(
      `Quantity "${raw}" has more than ${QUANTITY_DECIMALS} decimal places.`
    );
  }
  const scaled = BigInt(wholePart) * QUANTITY_SCALE + BigInt(fracPart.padEnd(QUANTITY_DECIMALS, "0") || "0");
  if (scaled <= 0n) {
    throw new InvoiceValidationError(`Quantity "${raw}" must be greater than zero.`);
  }
  return scaled;
}

/**
 * Validates and computes totals for a full set of line items. Throws
 * InvoiceValidationError (with a message identifying the offending line)
 * on any bad input. Never trust a client-submitted subtotal — this is
 * the only place a line total or invoice subtotal is computed.
 */
export function computeLineItems(rawItems: RawLineItemInput[]): ComputedLineItems {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new InvoiceValidationError("An invoice needs at least one line item.");
  }
  if (rawItems.length > 200) {
    throw new InvoiceValidationError("An invoice can have at most 200 line items.");
  }

  let subtotal = 0n;
  const items: ComputedLineItem[] = rawItems.map((raw, idx) => {
    const description = raw.description?.trim();
    if (!description) {
      throw new InvoiceValidationError(`Line ${idx + 1}: description is required.`);
    }
    if (description.length > 500) {
      throw new InvoiceValidationError(`Line ${idx + 1}: description is too long (max 500 characters).`);
    }

    let unitPriceSmallest: bigint;
    try {
      unitPriceSmallest = toSmallestUnit(raw.unitPrice);
    } catch {
      throw new InvoiceValidationError(
        `Line ${idx + 1}: "${raw.unitPrice}" isn't a valid unit price.`
      );
    }
    if (unitPriceSmallest <= 0n) {
      throw new InvoiceValidationError(`Line ${idx + 1}: unit price must be greater than zero.`);
    }

    const quantityScaled = parseQuantity(raw.quantity);
    const lineTotalSmallest = (unitPriceSmallest * quantityScaled) / QUANTITY_SCALE;

    subtotal += lineTotalSmallest;

    return {
      description,
      quantity: raw.quantity.trim(),
      unitPrice: toDecimalString(unitPriceSmallest),
      lineTotal: toDecimalString(lineTotalSmallest),
    };
  });

  return { items, subtotal };
}

/** Validates a client-supplied tax amount (issuer-entered, not derived — no tax-rate config exists yet). */
export function parseTaxAmount(raw: string | undefined): bigint {
  if (raw === undefined || raw.trim() === "") return 0n;
  try {
    const amount = toSmallestUnit(raw);
    if (amount < 0n) throw new Error();
    return amount;
  } catch {
    throw new InvoiceValidationError(`"${raw}" isn't a valid tax amount.`);
  }
}