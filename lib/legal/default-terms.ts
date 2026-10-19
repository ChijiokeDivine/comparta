export const DEFAULT_TERMS_VERSION = "v1.0.0";
export const DEFAULT_TERMS_TITLE = "Terms of Service";

export const DEFAULT_TERMS_SECTIONS = [
  { id: "acceptance", title: "1. Acceptance of Terms" },
  { id: "service", title: "2. Description of Service" },
  { id: "eligibility", title: "3. Eligibility & Accounts" },
  { id: "kyb", title: "4. KYB & Verification" },
  { id: "use", title: "5. Permitted Use" },
  { id: "payments", title: "6. Payments & Settlement" },
  { id: "buckets", title: "7. Buckets, Allocations & Rules" },
  { id: "fees", title: "8. Fees & Billing" },
  { id: "custody", title: "9. Custody, Yield & Risk" },
  { id: "prohibited", title: "10. Prohibited Activities" },
  { id: "ip", title: "11. Intellectual Property" },
  { id: "privacy", title: "12. Privacy & Data" },
  { id: "disclaimers", title: "13. Disclaimers" },
  { id: "liability", title: "14. Limitation of Liability" },
  { id: "indemnity", title: "15. Indemnification" },
  { id: "termination", title: "16. Termination" },
  { id: "changes", title: "17. Changes to Terms" },
  { id: "governing", title: "18. Governing Law & Disputes" },
  { id: "contact", title: "19. Contact Us" },
] as const;

export const DEFAULT_TERMS_HTML = `
<section id="acceptance">
  <h2>1. Acceptance of Terms</h2>

  <h3>1.1 Binding Agreement</h3>
  <p>By accessing, browsing, or using Comparta (the “Platform”, “Service”, “we”, “us”, or “our”), you agree to be bound by these Terms of Service (“Terms”). If you do not agree to these Terms in full, you must not access or use the Platform.</p>

  <h3>1.2 Authority to Bind</h3>
  <p>If you create an account or use the Platform on behalf of a company, organization, or other legal entity, you represent and warrant that you have the full legal authority to bind that entity to these Terms. In such cases, “you” refers to both you individually and the entity you represent.</p>

  <h3>1.3 Additional Policies</h3>
  <p>These Terms incorporate by reference our Privacy Policy, Cookie Policy (if published), and any product-specific terms or disclosures presented at the point of use. In the event of a conflict, these Terms control unless the other document expressly states otherwise.</p>

  <h3>1.4 Electronic Acceptance</h3>
  <p>Your electronic acceptance of these Terms (including by clicking “I agree”, creating an account, or continuing to use the Platform after notice of updates) constitutes a valid and binding electronic signature under applicable electronic transactions laws.</p>
</section>

<section id="service">
  <h2>2. Description of Service</h2>

  <h3>2.1 Overview</h3>
  <p>Comparta is a financial operating system designed for modern teams. It enables users to send and receive USDC, issue invoices, run payroll, create shareable payment links, allocate balances across virtual buckets, earn yield on eligible savings balances, schedule recurring transfers (including dollar-cost-averaging), and obtain AI-assisted spending insights and anomaly detection.</p>

  <h3>2.2 Settlement Layer</h3>
  <p>Settlement occurs on Circle’s Arc Layer-1 network through Circle Developer-Controlled Wallets. Each organization is provisioned with a single custodied on-chain wallet. Virtual balances (buckets) are maintained in an append-only double-entry ledger that is reconciled against the on-chain wallet balance.</p>

  <h3>2.3 Feature Availability</h3>
  <p>We may add, modify, suspend, or discontinue any feature at any time, with or without notice. Certain features (including money movement, payroll, yield, and advanced allocation rules) require completed KYB verification and an approved organization status. Availability may also depend on your jurisdiction, account type, and risk profile.</p>

  <h3>2.4 Beta & Experimental Features</h3>
  <p>From time to time we may offer beta, pilot, or experimental features. These are provided “as is”, may be unstable, and may be withdrawn at any time. Your use of such features is at your own risk.</p>
</section>

<section id="eligibility">
  <h2>3. Eligibility & Accounts</h2>

  <h3>3.1 Age & Capacity</h3>
  <p>You must be at least 18 years of age (or the age of majority in your jurisdiction, whichever is higher) and have the legal capacity to enter into a binding contract.</p>

  <h3>3.2 Account Types</h3>
  <p>You may register as an individual (personal / freelancer) or on behalf of a business or organization. Account type affects available features, verification requirements, and fee schedules.</p>

  <h3>3.3 Account Security</h3>
  <p>You are solely responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account. You must notify us immediately of any unauthorized access or suspected compromise. We are not liable for losses arising from your failure to safeguard credentials.</p>

  <h3>3.4 Accurate Information</h3>
  <p>You agree to provide true, accurate, current, and complete information during registration and to keep it updated. We may suspend or terminate accounts that contain false, misleading, or incomplete information, or that we reasonably believe present elevated risk.</p>

  <h3>3.5 One Account per Organization</h3>
  <p>Unless we expressly permit otherwise, each organization should maintain a single primary account. Sharing credentials across unrelated entities or creating multiple accounts to evade limits, restrictions, or verification is prohibited.</p>
</section>

<section id="kyb">
  <h2>4. KYB & Verification</h2>

  <h3>4.1 Requirement</h3>
  <p>Before enabling money-movement features (sends, payroll, payment-link settlement, yield deployment, etc.), we require Know-Your-Business (KYB) or equivalent identity verification. Individual users may be subject to simplified identity checks.</p>

  <h3>4.2 Ongoing Monitoring</h3>
  <p>Approval is not permanent. We may re-verify, request additional information, place an organization on hold, or revoke approval if new risk signals appear, regulatory requirements change, or information becomes outdated or inaccurate.</p>

  <h3>4.3 Real-Time Gating</h3>
  <p>Financial gating always re-reads the current KYB / compliance status from our systems. A session token or cached status alone does not grant access. An organization may be approved or held mid-session; access is evaluated on each relevant request.</p>

  <h3>4.4 Authorization to Verify</h3>
  <p>You authorize us and our service providers (including Circle and identity-verification partners) to collect, process, and verify information necessary to comply with anti-money-laundering (AML), counter-terrorist-financing (CTF), sanctions, and other applicable laws.</p>

  <h3>4.5 No Guarantee of Approval</h3>
  <p>Submission of documents does not guarantee approval. We reserve the right to decline or delay onboarding for any lawful reason, including risk, jurisdictional, or policy considerations.</p>
</section>

<section id="use">
  <h2>5. Permitted Use</h2>

  <h3>5.1 Lawful Purposes Only</h3>
  <p>You may use the Platform only for lawful business and personal financial management purposes. You must comply with all applicable sanctions, AML, CTF, tax, and consumer-protection laws in every jurisdiction in which you operate or from which you access the Service.</p>

  <h3>5.2 Responsibility for Instructions</h3>
  <p>You are solely responsible for the accuracy of payment instructions, payee identifiers (usernames or addresses), allocation rules, payroll schedules, and any other configuration you set. We execute instructions as received; we do not independently verify the correctness of destinations or amounts beyond basic format and risk checks.</p>

  <h3>5.3 Team & Role Management</h3>
  <p>If your organization has multiple users, the Owner and Admins are responsible for assigning appropriate roles and for the actions of Members. We are not responsible for internal disputes over access or permissions.</p>
</section>

<section id="payments">
  <h2>6. Payments & Settlement</h2>

  <h3>6.1 USDC as Primary Unit</h3>
  <p>The Platform operates primarily in USDC. Transfers settle according to the rules of the underlying network (Arc) and Circle’s systems. Settlement times are typically near-instant once confirmed on-chain, but we do not guarantee any specific confirmation latency.</p>

  <h3>6.2 Inbound Payments</h3>
  <p>Inbound USDC is credited to your organization’s on-chain wallet and then allocated to ledger buckets according to your active allocation rules (or to the default operating bucket if no rules apply). Card or ACH payments (where available) are converted to USDC via Circle’s payments infrastructure before ledger credit.</p>

  <h3>6.3 Outbound Transfers</h3>
  <p>Outbound transfers debit the relevant ledger account and the on-chain wallet. You must ensure sufficient liquid balance exists in the chosen bucket. Failed or rejected transfers may leave funds in intermediate states that require manual reconciliation.</p>

  <h3>6.4 Idempotency</h3>
  <p>We implement dual-layer idempotency (client-supplied keys plus provider-level keys) so that retries do not double-spend. Partial failures (provider success + database failure) are logged as critical events for manual reconciliation. You acknowledge that once a transaction is confirmed on-chain it is irreversible.</p>

  <h3>6.5 Username Resolution</h3>
  <p>Payments directed to a username are resolved at the time of execution. If a username is released or reassigned between scheduling and execution, the transfer may fail or (in rare cases) be delivered to a new holder of that username. We recommend verifying the recipient identity before large or irreversible transfers.</p>

  <h3>6.6 Payment Links & Invoices</h3>
  <p>Payment links and invoices create obligations only when a valid payment is received and reconciled. Wrong-amount payments on fixed-amount links may be automatically refunded. We are not responsible for disputes between you and your payers regarding the underlying commercial relationship.</p>
</section>

<section id="buckets">
  <h2>7. Buckets, Allocations & Rules</h2>

  <h3>7.1 Virtual Buckets</h3>
  <p>Buckets are virtual ledger accounts that sit on top of a single on-chain wallet. They allow you to segregate funds conceptually (e.g., Operating, Tax Reserve, Payroll, Savings) without creating multiple on-chain wallets. The sum of all bucket balances must equal the on-chain wallet balance (subject to pending reconciliation).</p>

  <h3>7.2 Allocation Rules</h3>
  <p>You may configure standing allocation rules that automatically move percentages or fixed amounts of inbound payments (or on a schedule) between buckets. Rules execute according to the triggers and parameters you set. Failed rule executions are logged; we do not guarantee that every rule will always succeed (e.g., insufficient balance).</p>

  <h3>7.3 Savings & Yield Rules</h3>
  <p>Where yield is offered, savings rules (percentage of income, round-up, fixed recurring) may deploy liquid USDC into yield-bearing positions. Redemptions are asynchronous and subject to the underlying protocol’s settlement times and any applicable locks or fees.</p>

  <h3>7.4 Recurring Transfers & DCA</h3>
  <p>Recurring and dollar-cost-averaging transfers execute on the schedule you define. We will attempt execution at the scheduled time; insufficient funds, network issues, or recipient resolution failures may cause a cycle to fail. Failed cycles are logged and may be retried or skipped according to the rule configuration.</p>
</section>

<section id="fees">
  <h2>8. Fees & Billing</h2>

  <h3>8.1 Free Features</h3>
  <p>Account creation, basic invoicing, payment-link generation, and standard ledger operations are currently free. We reserve the right to introduce fees for these features with reasonable prior notice.</p>

  <h3>8.2 Chargeable Features</h3>
  <p>Fees may apply to card/ACH processing, certain premium or high-volume features, network gas costs (where not absorbed by us), yield-related costs, or third-party services. All applicable fees are disclosed before you confirm a chargeable action.</p>

  <h3>8.3 Fee Changes</h3>
  <p>We may change the fee schedule at any time. Material increases will be communicated with reasonable notice. Continued use after the effective date constitutes acceptance of the new fees.</p>

  <h3>8.4 Taxes</h3>
  <p>You are solely responsible for determining and paying any taxes that apply to your use of the Platform or to transactions you conduct. We do not provide tax advice.</p>
</section>

<section id="custody">
  <h2>9. Custody, Yield & Risk</h2>

  <h3>9.1 Custody Model</h3>
  <p>Funds are held in Circle-custodied Developer-Controlled Wallets on Arc. Comparta does not take proprietary custody of your private keys. You acknowledge that Circle’s terms, security practices, and operational status affect the availability and safety of your funds.</p>

  <h3>9.2 Stablecoin Risk</h3>
  <p>USDC is designed to maintain a 1:1 peg with the US dollar. We do not guarantee that the peg will hold at all times. De-pegging, issuer risk, or regulatory action affecting stablecoins could result in loss of value.</p>

  <h3>9.3 Yield Risk</h3>
  <p>Yield features (where offered) involve smart-contract risk, counterparty risk, liquidity risk, and potential loss of principal. Past performance is not indicative of future results. Yield is not guaranteed and may be zero or negative after fees.</p>

  <h3>9.4 No Deposit Insurance</h3>
  <p>Comparta is not a bank, credit union, or insured depository institution. Balances are not covered by FDIC, SIPC, or equivalent deposit-insurance schemes. You bear the risk of loss.</p>

  <h3>9.5 Operational & Technology Risk</h3>
  <p>Digital assets can be lost through phishing, malware or social engineering. You are responsible for securing your own devices and credentials.</p>
</section>

<section id="prohibited">
  <h2>10. Prohibited Activities</h2>

  <h3>10.1 Illegal Conduct</h3>
  <p>You may not use the Platform to engage in fraud, money laundering, terrorist financing, sanctions evasion, tax evasion, or any other criminal activity.</p>

  <h3>10.2 Restricted Goods & Services</h3>
  <p>You may not process payments for illegal goods or services, including but not limited to controlled substances (outside lawful channels), weapons where prohibited, adult content involving non-consenting parties, or any activity that violates applicable law.</p>

  <h3>10.3 Platform Abuse</h3>
  <p>You may not attempt to reverse-engineer, scrape, overload, probe, or interfere with the Platform; circumvent rate limits or access controls; impersonate others; or manipulate the ledger, reconciliation, or on-chain records.</p>

  <h3>10.4 Evasion of Controls</h3>
  <p>You may not create multiple accounts, use VPNs or proxies primarily to evade geographic or risk controls, or otherwise attempt to circumvent our compliance or security measures.</p>

  <h3>10.5 Enforcement</h3>
  <p>We reserve the right to freeze funds, reverse transactions (to the extent technically possible), report activity to authorities, and terminate access for any violation of these rules or applicable law, without prior notice where required by law or risk considerations.</p>
</section>

<section id="ip">
  <h2>11. Intellectual Property</h2>

  <h3>11.1 Ownership</h3>
  <p>Comparta, its name, logos, software, documentation, designs, and all related intellectual property are owned by us or our licensors. All rights not expressly granted are reserved.</p>

  <h3>11.2 Limited License</h3>
  <p>Subject to these Terms, we grant you a limited, non-exclusive, non-transferable, revocable license to access and use the Platform for its intended purpose. You may not copy, modify, distribute, sell, lease, or create derivative works of our software or content except as permitted by law or with our prior written consent.</p>

  <h3>11.3 Feedback</h3>
  <p>If you provide feedback, suggestions, or ideas, you grant us a perpetual, royalty-free, worldwide license to use and incorporate them without restriction or compensation.</p>

  <h3>11.4 Third-Party Materials</h3>
  <p>The Platform may incorporate or link to third-party software, content, or services. Those materials are subject to their own licenses and terms; we are not responsible for them.</p>
</section>

<section id="privacy">
  <h2>12. Privacy & Data</h2>

  <h3>12.1 Privacy Policy</h3>
  <p>Our collection, use, storage, and sharing of personal data is described in our Privacy Policy. By using the Platform you consent to that processing as described therein.</p>

  <h3>12.2 AI & Insights</h3>
  <p>Transaction metadata (amounts, memos, counterparty display names, dates, categories) may be used—in anonymized or aggregated form where appropriate—to improve auto-categorization, anomaly detection, and natural-language query features. Raw wallet addresses, private keys, entity secrets, and other sensitive credentials are never sent to large-language-model providers.</p>

  <h3>12.3 Compliance Data</h3>
  <p>We retain KYB, transaction, and consent records for the periods required by applicable law and our internal retention policies. You may request access or deletion subject to legal retention obligations.</p>
</section>

<section id="disclaimers">
  <h2>13. Disclaimers</h2>

  <h3>13.1 “As Is” Service</h3>
  <p>THE PLATFORM IS PROVIDED “AS IS” AND “AS AVAILABLE” WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.</p>

  <h3>13.2 No Guarantee of Availability</h3>
  <p>We do not warrant that the Service will be uninterrupted, timely, secure, error-free, or free of viruses or other harmful components. Scheduled and unscheduled maintenance may occur.</p>

  <h3>13.3 No Financial, Legal, or Tax Advice</h3>
  <p>Nothing on the Platform constitutes financial, investment, legal, or tax advice. You should consult your own professional advisors before making decisions based on information available through the Service.</p>

  <h3>13.4 Third-Party Dependencies</h3>
  <p>The Platform depends on third-party infrastructure (including Circle, Arc, cloud providers, and identity services). We are not responsible for outages, errors, or policy changes of those third parties.</p>
</section>

<section id="liability">
  <h2>14. Limitation of Liability</h2>

  <h3>14.1 Exclusion of Certain Damages</h3>
  <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, COMPARTA AND ITS AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR BUSINESS OPPORTUNITY, WHETHER ARISING IN CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR OTHERWISE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>

  <h3>14.2 Essential Basis</h3>
  <p>The limitations in this section are an essential basis of the bargain between you and us and will apply even if any limited remedy fails of its essential purpose.</p>

  <h3>14.3 Jurisdictional Variations</h3>
  <p>Some jurisdictions do not allow the exclusion or limitation of certain damages. In such jurisdictions, our liability is limited to the maximum extent permitted by law.</p>
</section>

<section id="indemnity">
  <h2>15. Indemnification</h2>

  <h3>15.1 Your Obligation</h3>
  <p>You agree to indemnify, defend, and hold harmless Comparta and its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys’ fees) arising out of or related to: (a) your use of the Platform; (b) your violation of these Terms; (c) your violation of any third-party right or applicable law; or (d) any dispute between you and a payer, payee, or other third party.</p>

  <h3>15.2 Procedure</h3>
  <p>We will provide reasonable notice of any claim subject to indemnification. You may not settle any claim that imposes obligations on us without our prior written consent.</p>
</section>

<section id="termination">
  <h2>16. Termination</h2>

  <h3>16.1 Termination by You</h3>
  <p>You may close your account at any time through the Platform or by contacting support, subject to any outstanding payment, reconciliation, or legal obligations.</p>

  <h3>16.2 Termination or Suspension by Us</h3>
  <p>We may suspend or terminate your access immediately, with or without notice, for breach of these Terms, regulatory or compliance requirements, risk concerns, prolonged inactivity, or any other lawful reason.</p>

  <h3>16.3 Effect of Termination</h3>
  <p>Upon termination, your right to use the Platform ceases. We may retain data as required by law or for legitimate business purposes. Provisions that by their nature should survive (including ownership, disclaimers, liability limits, indemnity, and governing law) will survive termination.</p>

  <h3>16.4 Fund Withdrawal on Closure</h3>
  <p>Prior to final account closure you are responsible for withdrawing or transferring any remaining balances. We may impose reasonable procedures and timelines for residual balance handling consistent with applicable law.</p>
</section>

<section id="changes">
  <h2>17. Changes to Terms</h2>

  <h3>17.1 Right to Update</h3>
  <p>We may update these Terms from time to time. The version string and published date will change with each material update.</p>

  <h3>17.2 Notice</h3>
  <p>Material changes will be communicated via the Platform, email, or other reasonable means. Your continued use after the effective date constitutes acceptance of the revised Terms.</p>

  <h3>17.3 Version Tracking</h3>
  <p>Each version is stored with a unique version string. When you accept Terms (at signup or upon a required re-acceptance), we record the exact document version, timestamp, IP address, and user agent for audit and compliance purposes.</p>
</section>

<section id="governing">
  <h2>18. Governing Law & Disputes</h2>

  <h3>18.1 Governing Law</h3>
  <p>These Terms are governed by the laws of the jurisdiction in which Comparta is established, without regard to its conflict-of-law principles.</p>

  <h3>18.2 Venue</h3>
  <p>Any dispute arising out of or relating to these Terms or the Platform shall be resolved exclusively in the courts of that jurisdiction, except where mandatory consumer-protection or other laws provide for a different forum.</p>

  <h3>18.3 Informal Resolution</h3>
  <p>Before filing a formal claim, you agree to attempt to resolve the dispute informally by contacting us at the address below and allowing us a reasonable period (not less than 30 days) to respond.</p>

  <h3>18.4 Class Action Waiver</h3>
  <p>To the fullest extent permitted by law, you agree that any dispute will be conducted only on an individual basis and not in a class, consolidated, or representative action.</p>
</section>

<section id="contact">
  <h2>19. Contact Us</h2>

  <h3>19.1 Legal Inquiries</h3>
  <p>Questions about these Terms may be sent to <a href="mailto:legal@comparta.xyz">legal@comparta.xyz</a>.</p>

  <h3>19.2 Support</h3>
  <p>For product support, use the in-app support channel or the contact options published on <a href="https://comparta.xyz">comparta.xyz</a>.</p>

  <h3>19.3 Commercial Licensing</h3>
  <p>For commercial licensing, partnership, or enterprise inquiries, visit <a href="https://comparta.xyz">comparta.xyz</a> or email the address provided on the site.</p>
</section>
`;