# MarineQuote AI Full System Audit Report

Audit date: 2026-06-15  
Repository: `marine-proposal`  
Production domain: `https://marineconsolidatedelectronics.com`  
Supabase project: `marinequote-ai-prod` (`wxhqhlwfwsrarhacdzlu`)  
Verdict: Operational for core quote creation, PDF generation, and email delivery. Not yet enterprise-complete.

## Executive Summary

MarineQuote AI is a production-deployed internal estimate management system built into the existing Marine Consolidated Electronics website. The system currently supports secure staff login, customer and vessel management, estimate creation, versioning, PDF generation, private PDF storage, email delivery through Zoho SMTP, delivery history, dashboard metrics, and sent-estimate history.

The strongest parts of the system are the database schema, RLS baseline, private PDF storage, atomic estimate saving, version snapshots, and server-side email/PDF functions. The biggest gaps are role granularity, audit trails beyond estimate versioning/email delivery, CRM pipeline features, customer-facing approval links, monitoring, backup procedures, MFA, and AI review. WhatsApp and AI are present only as public marketing claims or future concepts, not as implemented MarineQuote modules.

Production readiness score: **78 / 100**

## System Architecture Diagram

```text
Staff Browser
  |
  | HTTPS
  v
marineconsolidatedelectronics.com
  |
  | Static public website + /admin HTML/CSS/JS
  v
Admin UI
  |-- login.html / reset-password.html
  |-- dashboard.html
  |-- customers.html
  |-- vessels.html
  |-- estimate.html
  |-- estimate-preview.html
  |-- estimates.html
  |-- history.html
  |
  | Supabase JS publishable key
  v
Supabase Auth
  |
  v
PostgreSQL + RLS
  |-- profiles
  |-- customers
  |-- vessels
  |-- estimates
  |-- estimate_materials
  |-- estimate_labor
  |-- estimate_versions
  |-- estimate_documents
  |-- estimate_deliveries
  |
  | Authenticated Edge Function invoke
  v
Supabase Edge Functions
  |-- generate-estimate-pdf
  |     |-- reads estimate data through user JWT
  |     |-- writes PDF to private bucket
  |     |-- records estimate_documents
  |
  |-- send-estimate-email
        |-- validates active user
        |-- validates recipient against customer email
        |-- downloads private PDF
        |-- sends via Zoho SMTP using Edge Function secrets
        |-- writes estimate_deliveries
        |-- updates estimate status to sent

Private Supabase Storage
  |
  |-- estimate-pdfs bucket
      |-- signed URLs only
```

## Audit Method

Reviewed:

- Static admin frontend files under `admin/`
- Supabase migrations under `supabase/migrations/`
- Supabase Edge Functions under `supabase/functions/`
- Supabase local config under `supabase/config.toml`
- Public website integration under `index.html`
- Calculator tests under `tests/`
- Production `/admin/login.html`
- Production Edge Function listing

Commands run:

- `git status --short`
- `git diff --check`
- `npm test`
- `supabase functions list --project-ref wxhqhlwfwsrarhacdzlu`
- `curl https://marineconsolidatedelectronics.com/admin/login.html`

Verification results:

- `/admin/login.html` returns HTTP 200.
- `generate-estimate-pdf` is ACTIVE, version 6.
- `send-estimate-email` is ACTIVE, version 7.
- Calculator tests pass: 5 / 5.
- `git diff --check` passes.

## 1. Database Schema

Status: **Operational**

Implemented schema:

| Table / Type | Purpose | Status |
|---|---:|---|
| `app_role` | `admin`, `estimator` enum | Operational |
| `profiles` | Auth-linked staff profile and role state | Operational |
| `customers` | Customer contact, billing address, notes, archive flag | Operational |
| `vessels` | Vessel ownership, identifying data, archive flag | Operational |
| `estimate_status` | `draft`, `generated`, `sent` enum | Operational |
| `estimates` | Header, customer/vessel link, pricing totals, status, version | Operational |
| `estimate_materials` | Estimate material line items | Operational |
| `estimate_labor` | Estimate labor line items | Operational |
| `estimate_versions` | Immutable JSON snapshots per save | Operational |
| `estimate_documents` | Generated PDF metadata and storage path | Operational |
| `estimate_delivery_status` | `queued`, `sent`, `failed` enum | Operational |
| `estimate_deliveries` | Email delivery history and provider result | Operational |
| `estimate_number_sequence` | Generates `MCE-YYYY-00000` numbers | Operational |

Important database behavior:

- `handle_new_user()` creates a default active `estimator` profile.
- `is_active_user()` gates most RLS policies.
- `save_estimate()` performs atomic save of header, materials, labor, totals refresh, and version snapshot.
- Estimate line totals are generated columns.
- Estimate totals are recalculated server-side by trigger.
- Vessel/customer relationship is validated by trigger.

## 2. Supabase Tables

Status: **Operational**

Tables are modeled correctly for Phase 1 production usage. The core data model supports Eduardo creating and managing estimates without spreadsheets.

Strengths:

- Clear relational model.
- Customer-vessel relationship enforced.
- Soft archive exists for customers and vessels.
- Estimate version snapshots provide rollback evidence.
- Email delivery history is separated from estimate documents.

Limitations:

- No `estimate_approvals` table.
- No `audit_events` table.
- No `attachments` table beyond generated PDFs.
- No reusable materials catalog.
- No quote templates or service packages.
- No payment/invoice tables.

## 3. Authentication System

Status: **Operational, needs hardening**

Current implementation:

- Supabase email/password Auth.
- `/admin/login.html` signs in with `supabase.auth.signInWithPassword`.
- Auth session persists in browser.
- Protected pages call `requireActiveProfile()`.
- Inactive profile triggers sign-out.
- Password reset flow exists.

Supabase config:

- Global signup disabled.
- Email/password enabled for admin-created accounts.
- Minimum password length: 12.
- Password requirements: lower, upper, digits.
- Refresh token rotation enabled.
- Session timebox: 12 hours.
- Inactivity timeout: 30 minutes.

Risks:

- MFA is not enabled.
- No CAPTCHA on login.
- No IP allowlist for `/admin`.
- No device/session management UI.
- Auth config in `supabase/config.toml` is local config evidence; hosted Auth settings should be periodically verified in dashboard.

## 4. User Roles

Status: **Partially implemented**

Implemented:

- `admin`
- `estimator`
- `active` flag

Observed behavior:

- All active users can read and update business records.
- Delete policies are admin-only.
- Frontend does not expose role-specific UX.

Risk:

- `estimator` currently has broad write access to customers, vessels, estimates, documents, and line items.
- No granular permissions for "view only", "send email", "generate PDF", "manage customers", or "manage users".

Recommended next action:

- Add role capability checks for sensitive actions before expanding staff access.

## 5. Dashboard Metrics

Status: **Operational**

Implemented metrics:

- Draft estimates count.
- Generated estimates count.
- Sent estimates count.
- Active customers count.
- Recent estimates list.

Limitations:

- No revenue totals.
- No open quotes aging.
- No conversion rate.
- No email failure alert.
- No monthly estimate volume.
- No estimates by customer/vessel.

Recommended next action:

- Add business metrics after audit/events foundation.

## 6. Customer Module

Status: **Operational**

Implemented:

- List/search customers.
- Create customer.
- Edit customer.
- Archive customer.
- Contact name, company, email, phone.
- JSON billing address.
- Notes.

Strengths:

- Uses DOM text APIs for rendering, reducing XSS risk.
- Input lengths and email format enforced by DB.
- Soft archive avoids deleting historical estimate data.

Gaps:

- No duplicate detection.
- No import/export.
- No activity timeline.
- No multiple contacts per company.
- No customer-specific estimate history embedded in customer page.

## 7. Vessel Module

Status: **Operational**

Implemented:

- List/search vessels.
- Create vessel.
- Edit vessel.
- Archive vessel.
- Link vessel to customer.
- Vessel name/type/manufacturer/model/year/length/registration/location/notes.

Strengths:

- DB enforces that a vessel is identifiable.
- Estimate trigger validates selected vessel belongs to selected customer.

Gaps:

- No vessel service history view.
- No vessel photos or documents.
- No multiple owners/captains.
- No equipment inventory per vessel.

## 8. Estimate Module

Status: **Operational**

Implemented:

- Estimate builder.
- Customer and vessel selectors.
- Job description.
- Recommended work.
- Materials.
- Labor.
- Discount.
- Tax.
- Validity days.
- Customer notes.
- Internal notes.
- Server-calculated totals.
- Save draft.
- Reopen estimate.
- Generate PDF.
- Send email.
- Estimate list.
- Sent/history list.
- Version snapshots.

Strengths:

- `save_estimate()` is transactional.
- Frontend totals mirror backend formula.
- Backend is source of truth for totals.
- Saved estimates reset to `draft`, avoiding stale generated output.
- Current PDF is invalidated when form changes.

Risks:

- `estimates.html` excludes sent estimates, while `history.html` shows all. This is acceptable but may confuse staff if labels are not explicit.
- No explicit quote approval workflow.
- No "rejected", "approved", or "expired" status.
- No item catalog, price book, or standard labor rate library.
- No inline comparison between versions.

## 9. Email Delivery System

Status: **Operational**

Implemented:

- Send Email button in estimate builder.
- Send Quote form in estimate preview.
- Recipient confirmation against customer email.
- PDF attachment from private storage.
- Zoho SMTP via Supabase Edge Function secrets.
- Sender/reply-to handled server-side.
- HTML corporate template.
- Delivery log in `estimate_deliveries`.
- Estimate status updates to `sent`.

Security strengths:

- SMTP credentials are not exposed in frontend.
- Browser users cannot insert/update delivery audit records after migration `202606130007`.
- Edge Function validates active user.
- Edge Function rejects recipient mismatch.

Risks:

- No email open/click tracking.
- No bounce tracking.
- No resend throttling per estimate/customer.
- No staff-facing failure reason except generic UI message.
- "Approve Estimate" CTA currently points to protected admin preview, not a customer-safe approval page.

## 10. PDF Generation System

Status: **Operational**

Implemented:

- Authenticated Supabase Edge Function.
- `pdf-lib` server-side PDF generation.
- Private `estimate-pdfs` bucket.
- Signed download URLs, 10-minute expiry.
- One PDF per estimate version path.
- PDF document metadata in `estimate_documents`.

Strengths:

- No public bucket exposure.
- PDF generation requires authenticated active profile.
- PDF generated from backend data, not browser DOM.
- Pagination fixes have been applied.

Risks:

- PDF layout is hand-coded and harder to maintain than a template engine.
- No automated PDF visual regression test.
- Long descriptions are truncated in material/labor table rows to first wrapped line.
- No company logo image embedded in PDF; branding is text/color based.

## 11. WhatsApp Integrations

Status: **Prototype / Marketing only**

Current state:

- Public site references WhatsApp contact behavior.
- No MarineQuote admin WhatsApp send flow exists.
- No WhatsApp delivery table exists.
- No Twilio/Meta WhatsApp provider integration exists.

Recommendation:

- Treat WhatsApp as a V1.2 module after audit/events and approval workflow.

## 12. AI Integrations

Status: **Missing**

Current state:

- The brand name is "MarineQuote AI".
- Public proposal text references AI assistant/Natalie.
- No estimate AI review layer is implemented.
- No OpenAI/Anthropic/Vapi runtime integration is present in the admin system.
- No AI review table, prompt log, or risk score exists.

Recommendation:

- Add AI review only after core audit logging and quote workflow are stable.

## 13. CRM Capabilities

Status: **Partially implemented**

Existing CRM-like features:

- Customers.
- Vessels.
- Estimate history.
- Sent quote history.

Missing CRM features:

- Lead capture.
- Pipeline stages.
- Follow-up reminders.
- Tasks.
- Notes timeline.
- Calendar.
- Opportunity value.
- Quote approval/rejection.
- Customer communication history beyond sent estimate email.
- Import/export.

Recommendation:

- Do not expand CRM until MarineQuote estimate workflow is fully hardened.

## 14. Existing Modules

| Module | Status | Evidence |
|---|---|---|
| Public website | Operational | `index.html`, production domain |
| Staff login | Operational | `admin/login.html`, Supabase Auth |
| Password reset | Operational | `admin/reset-password.html` |
| Protected admin shell | Operational | `auth.js`, `page-shell.js` |
| Dashboard | Operational | `admin/dashboard.html`, `dashboard.js` |
| Customers | Operational | `customers.html`, `customers.js`, `customers` table |
| Vessels | Operational | `vessels.html`, `vessels.js`, `vessels` table |
| Estimate builder | Operational | `estimate.html`, `estimate.js`, `save_estimate()` |
| Estimate preview | Operational | `estimate-preview.html`, `estimate-preview.js` |
| Estimate history | Operational | `history.html`, `history.js` |
| PDF generation | Operational | `generate-estimate-pdf` function |
| Private PDF storage | Operational | `estimate-pdfs` bucket migration |
| Email delivery | Operational | `send-estimate-email` function |
| Delivery logging | Operational | `estimate_deliveries` table |
| Versioning | Operational | `estimate_versions` table |
| Calculator tests | Operational | `tests/estimate-calculator.test.mjs` |

## 15. Missing Modules

Priority missing modules:

| Module | Status | Business Impact |
|---|---|---|
| Customer approval page | Missing | Customers cannot approve from email without staff login |
| Approval/rejection workflow | Missing | No formal quote outcome state |
| Audit events | Missing | Limited traceability beyond versions/deliveries |
| AI estimate review | Missing | No missing-info or pricing anomaly detection |
| Monitoring/alerting | Missing | Failures require manual discovery |
| Backup/recovery runbook | Missing | Operational risk |
| MFA | Missing | Admin access risk |
| Role permissions UI | Missing | Scaling beyond Eduardo is risky |
| Material catalog | Missing | Repetitive entry and pricing drift |
| Labor rate catalog | Missing | Pricing consistency risk |
| Email bounce/open tracking | Missing | No delivery intelligence |
| WhatsApp quote send | Missing | No quote delivery over WhatsApp |
| CRM task/follow-up system | Missing | Manual follow-up burden |

## 16. Technical Debt

| Area | Severity | Notes |
|---|---:|---|
| Static vanilla JS frontend | Medium | Fast and simple, but no build-time type safety or component reuse. |
| Broad active-user RLS | High | Any active user can modify most records; acceptable for one staff user, risky for team growth. |
| No audit event ledger | High | Estimate versions exist, but customer/vessel/profile changes are not fully audited. |
| Protected approval CTA | Medium | Email CTA says approve but opens admin-only preview. |
| No automated Edge Function tests | Medium | Current tests cover calculator only. |
| PDF visual testing absent | Medium | Pagination regressions can return. |
| No dependency manifest for frontend libs | Low | Supabase loaded from CDN in browser. |
| No deployment manifest in repo | Low | Vercel/GitHub deployment is inferred, not fully documented in config. |
| Logo embedded as base64 in email function | Low | Reliable for Edge deploy, but not maintainable long-term. |

## 17. Security Status

Overall status: **Good baseline, not enterprise-hardened**

Positive controls:

- Supabase Auth required for admin.
- Signup disabled globally.
- Password policy configured.
- Sessions timeboxed.
- RLS enabled on business tables.
- Anonymous access revoked.
- Private PDF bucket.
- Signed PDF URLs.
- Edge Functions require JWT.
- SMTP password stays in Supabase secrets, not browser code.
- Delivery audit records are service-role controlled.

Risks:

- MFA disabled.
- No login CAPTCHA.
- No IP allowlist.
- No centralized security logs.
- No intrusion alerting.
- No backup/restore drill evidence.
- Service role is used correctly server-side, but operational access procedures are not documented.
- Active estimator role is too broad for multi-user operations.

## 18. Risk Assessment

| Risk | Severity | Status | Recommendation |
|---|---:|---|---|
| Customer cannot approve from email without admin login | High | Existing | Build signed customer approval page. |
| Broad estimator permissions | High | Existing | Add role capability policies and UI gating. |
| No full audit trail | High | Existing | Add `audit_events` with immutable append-only writes. |
| No MFA | High | Existing | Enable TOTP MFA for admin accounts. |
| No backup/restore runbook | High | Existing | Document and test recovery process. |
| Email failure visibility limited | Medium | Existing | Add dashboard alert and retry controls. |
| No PDF regression testing | Medium | Existing | Add PDF smoke/visual tests. |
| AI claims not implemented in product | Medium | Existing | Either add AI review or reduce product claims. |
| WhatsApp claims not implemented in admin | Medium | Existing | Keep as marketing/contact only until integrated. |
| No material/labor catalogs | Low | Existing | Add after approval workflow. |

## 19. Recommended Roadmap

### Phase 1: Operational Hardening

1. Add MFA for Eduardo/admin accounts.
2. Add `audit_events` table and server-side logging for create/update/archive/send/generate actions.
3. Add backup and recovery runbook.
4. Add monitoring for Edge Function failures.
5. Add staff-facing email failure/retry panel.

### Phase 2: Customer Approval Workflow

1. Add `estimate_approval_tokens` or signed approval links.
2. Add public customer-safe approval page.
3. Add estimate statuses: `approved`, `rejected`, `expired`.
4. Add approval/rejection records with timestamp, IP/user agent, and customer identity confirmation.
5. Update email CTA to customer-safe approval URL.

### Phase 3: Pricing Consistency

1. Add materials catalog.
2. Add labor rate catalog.
3. Add service package templates.
4. Add copy-from-prior-estimate flow.
5. Add margin/profit view for internal users.

### Phase 4: AI Review Layer

1. Add AI review table.
2. Evaluate missing customer/vessel/job data.
3. Flag pricing anomalies.
4. Flag missing materials/labor.
5. Require staff confirmation before sending.
6. Store prompt/version/model metadata.

### Phase 5: CRM and Communications

1. Add customer timeline.
2. Add follow-up reminders.
3. Add WhatsApp quote delivery.
4. Add email open/bounce tracking if provider supports it.
5. Add basic pipeline/reporting.

## Production Readiness Score

**78 / 100**

Scoring:

| Category | Score |
|---|---:|
| Core estimate workflow | 18 / 20 |
| Database design | 16 / 18 |
| Authentication | 11 / 15 |
| RLS/security baseline | 12 / 15 |
| PDF generation | 9 / 10 |
| Email delivery | 9 / 10 |
| Monitoring/audit/recovery | 2 / 8 |
| Scalability/maintainability | 1 / 4 |

Interpretation:

- Ready for Eduardo to run real internal estimates.
- Not ready as a multi-staff enterprise platform without role hardening, MFA, audit events, monitoring, and recovery procedures.
- AI/CRM/WhatsApp should remain roadmap items until the quote workflow is fully hardened.

## Final Recommendation

Keep MarineQuote AI in production for controlled internal use by Eduardo. The current system is strong enough for creating, saving, generating PDFs, emailing estimates, and maintaining customer/vessel records. Before expanding users or positioning it as a full AI/CRM platform, prioritize MFA, audit events, customer approval workflow, monitoring, and backup/recovery documentation.
