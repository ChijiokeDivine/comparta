// lib/identity/address.ts
//
// Arc is EVM-compatible, so addresses follow standard Ethereum format:
// "0x" + 40 hex characters. viem's isAddress/getAddress already implement
// this (including EIP-55 checksum validation when mixed-case), so this
// module is a thin, intention-revealing wrapper rather than reimplementing
// address parsing.

import { isAddress, getAddress } from "viem";

/** True if the string is a syntactically valid Arc/EVM address (any case). */
export function isValidAddress(value: string): boolean {
  return isAddress(value, { strict: false });
}

/**
 * Returns the EIP-55 checksummed form of a valid address. Throws if the
 * input isn't a valid address — check isValidAddress first if the input is
 * untrusted/unvalidated.
 */
export function toChecksumAddress(value: string): string {
  return getAddress(value);
}