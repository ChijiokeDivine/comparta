# Onramp (buy USDC with card or bank)

Comparta uses Circle's **Onramp** (App Kit) so a signed-in user can buy USDC
with a debit card, Apple Pay, Google Pay or bank transfer. USDC is delivered
directly to the organization's existing Arc wallet.

The integration is deliberately small and lives in one vertical slice:

| Piece | Location |
| --- | --- |
| Server config (key, environment, referrer domain) | `lib/onramp/config.ts` |
| Authenticated session endpoint | `app/api/onramp/sessions/route.ts` |
| Widget + lifecycle handling | `app/components/onramp/OnrampPanel.tsx` |
| Deposit UI (method switcher) | `app/components/DepositModal.tsx` |
| Entry points | dashboard `QuickActions`, wallet `DepositButton` |
| Client environment constants | `lib/config/clientChains.ts` |

## How the flow works

```
Dashboard / Wallet
  └─ "New deposit" / "Add funds"
       └─ DepositModal
            ├─ Card or bank  → OnrampPanel
            │                    └─ POST /api/onramp/sessions
            │                         └─ Circle Onramp widget (iframe)
            └─ Crypto transfer → existing address + QR flow
```

1. The user must already have a wallet. If they do not, the dashboard's first
   quick action is **Create wallet** and the wallet page shows the create
   empty state. Onramp needs a destination address, so the card/bank tab is
   unavailable until a wallet exists.
2. `OnrampPanel` posts `{ appUserId, destinationAddress, destinationChain,
   assets }` to `/api/onramp/sessions`.
3. The route authenticates the NextAuth session, checks that `appUserId`
   matches the signed-in user, and checks that `destinationAddress` belongs to
   that user's organization. Unauthenticated or mismatched requests are
   rejected with `401` before a session is minted.
4. The widget is mounted inline. Lifecycle events update the UI; a settled
   purchase asks the page to `router.refresh()` so balances update. Inbound
   USDC is also credited by the existing Circle webhook
   (`app/api/webhooks/circle/route.ts` → `handleInboundTransfer`), so the
   widget events are treated as UI hints, not as the source of truth.

## Configuration

Onramp is enabled by default when a Circle API key is available. Set the
following in the active environment:

```bash
# Optional. "false" hides every card/bank entry point.
ONRAMP_ENABLED=

# Optional dedicated Onramp key. When blank, the active network's normal
# Circle key is used: CIRCLE_API_KEY locally, CIRCLE_API_KEY_MAIN on mainnet.
CIRCLE_ONRAMP_API_KEY=

# Optional. Bare hostname that will embed the widget. Defaults to the
# hostname of NEXTAUTH_URL. No scheme, port or path.
ONRAMP_REFERRER_DOMAIN=
```

The Circle key must be enabled for App Kits in the
[Circle Console](https://console.circle.com/app-kits/). API keys are
environment-specific: use the sandbox key locally/preview and the live key in
production. With the existing network resolver this means production already
uses `CIRCLE_API_KEY_MAIN`; no extra wiring is needed.

Environment endpoints are selected automatically:

| Comparta network | wallets-api | Widget |
| --- | --- | --- |
| testnet / local | `https://api-test.circle.com` | `https://onramp-sandbox.arc.io` |
| mainnet | `https://api.circle.com` | `https://onramp.arc.io` |

Sandbox allows `http://localhost:*`. Production's widget CSP only allows
hostnames registered in the Onramp KYB's `web_url` entries, so add your
production domain there before enabling card payments.

## Content Security Policy

If a CSP header is added later, the widget origin must be allowed:

```text
frame-src https://onramp.arc.io;
```

Use `https://onramp-sandbox.arc.io` for testnet/local. No `connect-src`
exception is needed for Onramp itself.

## Events and confirmation

`OnrampPanel` handles:

- `INITIALIZATION_SUCCESS` / `INITIALIZATION_ERROR`
- `DEPOSIT_SUBMITTED` / `DEPOSIT_SETTLED`
- `DEPOSIT_NOT_COMPLETED` (`CANCELED_BY_CUSTOMER`, `SESSION_TIMEOUT`,
  `NO_PAYMENT_OPTIONS`, `CUSTOMER_PENDING_REVIEW`, `CUSTOMER_REJECTED`,
  `PAYMENT_PROVIDER_ERROR`)
- `onSessionExpired` (mints a fresh session and remounts)
- `widget.close()` on unmount, retry and session replacement

`DEPOSIT_SETTLED` is best effort (card/Apple Pay/Google Pay only, and only
while the widget is open). Comparta's ledger is credited from the onchain
transfer through the existing Circle webhook, not from browser events.

## Testing

1. Apply the database changes and set the environment variables above.
2. Create a wallet if the organization does not have one.
3. Open **Add funds → Card or bank**.
4. In sandbox, any six-digit OTP passes (`000000` fails), and any photo
   containing a face passes identity verification. Never enter real card
   details or PII.
5. Sandbox only emits `DEPOSIT_SUBMITTED`; verify test funds on the block
   explorer rather than expecting `DEPOSIT_SETTLED`. Sandbox test bank
   deposits may land on Ethereum rather than Arc — that is expected and only
   affects local wiring checks, not production delivery.

If the panel shows "Checkout couldn't start", check the server logs for
`[onramp] session mint failed` — the usual causes are a key that is not
enabled for App Kits, a sandbox/live key mismatch, or a missing referrer
domain registration.
