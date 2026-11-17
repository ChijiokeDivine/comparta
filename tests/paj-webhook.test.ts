// tests/paj-webhook.test.ts
//
// Pure unit tests for Paj webhook verification and order-state transitions.
// No database, no network, no Paj credentials required.
//
// These cover the properties that are dangerous to get wrong:
//   - a body re-serialised after parsing does not verify
//   - stale timestamps are rejected even when the signature is correct
//   - a retry/duplicate cannot move a terminal order backwards
//   - amount/rate enrichment still applies for a repeated status

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractPajSignatures,
  pajDeliveryFingerprint,
  verifyPajWebhookSignature,
} from "@/lib/paj/webhook";
import {
  pajTransactionTypeMatchesOrder,
  resolveStatusTransition,
} from "@/lib/paj/webhookState";

const SECRET = "whsec_0123456789abcdef0123456789abcdef";

function sign(body: string, timestamp: number, secret = SECRET): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `v1=${digest}`;
}

describe("verifyPajWebhookSignature", () => {
  const body = '{"id":"ord_1","status":"PROCESSING"}';
  const now = Math.floor(Date.now() / 1000);

  it("accepts a correctly signed delivery", () => {
    expect(
      verifyPajWebhookSignature({
        rawBody: body,
        timestamp: String(now),
        signature: sign(body, now),
        secret: SECRET,
      })
    ).toEqual({ ok: true });
  });

  it("rejects a body changed after signing", () => {
    const result = verifyPajWebhookSignature({
      rawBody: body.replace("PROCESSING", "COMPLETED"),
      timestamp: String(now),
      signature: sign(body, now),
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Invalid signature/);
  });

  it("rejects a timestamp outside the replay window", () => {
    const stale = now - 301;
    const result = verifyPajWebhookSignature({
      rawBody: body,
      timestamp: String(stale),
      signature: sign(body, stale),
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/replay window/);
  });

  it("rejects a signature made with the wrong secret", () => {
    const result = verifyPajWebhookSignature({
      rawBody: body,
      timestamp: String(now),
      signature: sign(body, now, "whsec_wrong"),
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing headers and a missing secret", () => {
    expect(
      verifyPajWebhookSignature({
        rawBody: body,
        timestamp: null,
        signature: null,
        secret: SECRET,
      }).ok
    ).toBe(false);
    expect(
      verifyPajWebhookSignature({
        rawBody: body,
        timestamp: String(now),
        signature: sign(body, now),
        secret: undefined,
      }).ok
    ).toBe(false);
  });

  it("accepts a bare legacy digest and ignores other schemes", () => {
    const bare = sign(body, now).slice("v1=".length);
    expect(
      verifyPajWebhookSignature({
        rawBody: body,
        timestamp: String(now),
        signature: bare,
        secret: SECRET,
      }).ok
    ).toBe(true);

    expect(
      verifyPajWebhookSignature({
        rawBody: body,
        timestamp: String(now),
        signature: `v2=${bare}`,
        secret: SECRET,
      }).ok
    ).toBe(false);
  });

  it("accepts v1 when a transition sends several schemes", () => {
    const header = `v2=deadbeef, ${sign(body, now)}`;
    expect(extractPajSignatures(header)).toHaveLength(1);
    expect(
      verifyPajWebhookSignature({
        rawBody: body,
        timestamp: String(now),
        signature: header,
        secret: SECRET,
      }).ok
    ).toBe(true);
  });

  it("rejects a non-hex digest instead of throwing", () => {
    const result = verifyPajWebhookSignature({
      rawBody: body,
      timestamp: String(now),
      signature: "v1=zzzz",
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("fingerprints identical bytes identically", () => {
    expect(pajDeliveryFingerprint(body)).toBe(pajDeliveryFingerprint(body));
    expect(pajDeliveryFingerprint(body)).not.toBe(
      pajDeliveryFingerprint(`${body} `)
    );
    expect(pajDeliveryFingerprint(body)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolveStatusTransition", () => {
  it("moves INIT → PROCESSING → COMPLETED", () => {
    expect(resolveStatusTransition("INIT", "PROCESSING")).toMatchObject({
      apply: true,
      nextStatus: "PROCESSING",
      changed: true,
    });
    expect(resolveStatusTransition("PROCESSING", "COMPLETED")).toMatchObject({
      apply: true,
      nextStatus: "COMPLETED",
      changed: true,
    });
  });

  it("never moves backwards", () => {
    expect(resolveStatusTransition("PROCESSING", "INIT")).toMatchObject({
      apply: false,
      changed: false,
    });
  });

  it("never overwrites a terminal order", () => {
    expect(resolveStatusTransition("COMPLETED", "ERROR").apply).toBe(false);
    expect(resolveStatusTransition("ERROR", "COMPLETED").apply).toBe(false);
    expect(resolveStatusTransition("COMPLETED", "PROCESSING").apply).toBe(false);
  });

  it("treats a repeated status as enrichment only", () => {
    expect(resolveStatusTransition("PROCESSING", "PROCESSING")).toMatchObject({
      apply: true,
      changed: false,
    });
    expect(resolveStatusTransition("COMPLETED", "COMPLETED")).toMatchObject({
      apply: true,
      changed: false,
    });
  });

  it("ignores an unrecognised status", () => {
    expect(resolveStatusTransition("INIT", null)).toMatchObject({
      apply: false,
      nextStatus: null,
    });
  });
});

describe("pajTransactionTypeMatchesOrder", () => {
  it("matches Paj's ON_RAMP/OFF_RAMP to our enums", () => {
    expect(pajTransactionTypeMatchesOrder("ON_RAMP", "ONRAMP")).toBe(true);
    expect(pajTransactionTypeMatchesOrder("OFF_RAMP", "OFFRAMP")).toBe(true);
    expect(pajTransactionTypeMatchesOrder("ON_RAMP", "OFFRAMP")).toBe(false);
  });

  it("does not block a delivery that omits transactionType", () => {
    expect(pajTransactionTypeMatchesOrder(undefined, "ONRAMP")).toBe(true);
  });
});
