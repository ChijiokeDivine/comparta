// lib/circle/amount.ts
//
// USDC has 6 decimals. Internally (Postgres, the ledger) every amount is a
// bigint in the smallest unit ("micro-USDC") to avoid float rounding bugs.
// Circle's API speaks decimal strings ("12.34"). These helpers are the only
// place that conversion should happen — never sprinkle Number() math on
// money anywhere else in the codebase.

const USDC_DECIMALS = 6;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);

/** bigint micro-USDC -> decimal string Circle's API expects, e.g. "12.34" */
export function toDecimalString(amount: bigint): string {
  if (amount < 0n) throw new Error("toDecimalString: amount must be >= 0");
  const whole = amount / USDC_SCALE;
  const frac = amount % USDC_SCALE;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0");
  return `${whole.toString()}.${fracStr}`;
}

/** decimal string ("12.34") or plain integer string -> bigint micro-USDC */
export function toSmallestUnit(decimal: string): bigint {
  const trimmed = decimal.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`toSmallestUnit: invalid decimal amount "${decimal}"`);
  }
  const parts = trimmed.split(".");
  const wholePart = parts[0] ?? "0";
  const fracPart = parts[1] ?? "";
  if (fracPart.length > USDC_DECIMALS) {
    throw new Error(
      `toSmallestUnit: "${decimal}" has more than ${USDC_DECIMALS} decimal places`
    );
  }
  const paddedFrac = fracPart.padEnd(USDC_DECIMALS, "0");
  return BigInt(wholePart) * USDC_SCALE + BigInt(paddedFrac || "0");
}

export function isPositive(amount: bigint): boolean {
  return amount > 0n;
}
