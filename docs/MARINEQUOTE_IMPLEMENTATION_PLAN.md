# MarineQuote AI Phase 1A Implementation Plan

## Objective

Deliver the first working MarineQuote AI estimate system inside the existing
Marine Consolidated Electronics website repository.

Eduardo must be able to sign in, maintain customers and vessels, build and
reopen versioned estimates, preview estimate data, and generate a private PDF.

## Phase 1A Scope

1. Supabase connection
2. Supabase email/password authentication
3. Customer management
4. Vessel management
5. Estimate management
6. Material line items
7. Labor line items
8. Estimate version snapshots
9. Protected dashboard
10. Estimate builder and calculations
11. Estimate preview
12. Private PDF generation and download

## Explicit Exclusions

- Email delivery
- AI estimate review
- CRM functionality
- Marketing functionality
- Lead generation
- Automation workflows

## Implementation Milestones

### Milestone 1: Data Foundation

- Configure the Supabase project settings.
- Create `profiles`, `customers`, and `vessels`.
- Create the Auth profile trigger.
- Enable RLS and authenticated-user policies.

### Milestone 2: Secure Admin Shell

- Connect the browser client to Supabase.
- Add login, password recovery, logout, and protected-route checks.
- Add the responsive dashboard shell.

### Milestone 3: Customer and Vessel Management

- Add searchable customer and vessel screens.
- Add create, update, and archive operations.
- Enforce vessel ownership by customer.

### Milestone 4: Estimate Builder

- Create `estimates`, `estimate_materials`, and `estimate_labor`.
- Add server-calculated totals and estimate numbering.
- Add the estimate editor, material rows, labor rows, tax, and discounts.

### Milestone 5: Versioning and History

- Create immutable `estimate_versions` snapshots.
- Save the estimate and its line items transactionally.
- Add estimate history and reopen behavior.

### Milestone 6: Preview and PDF

- Present the complete estimate in the builder before generation.
- Create `estimate_documents` and the private `estimate-pdfs` bucket.
- Generate PDFs through an authenticated Supabase Edge Function.
- Return short-lived signed download URLs.

## Database and Security Requirements

- Every application table must have RLS enabled.
- Anonymous database access must be denied.
- Only active authenticated profiles may read or write business records.
- Authenticated users may create and update operational records.
- Destructive deletes are restricted to administrators where supported.
- Generated PDFs must remain in private storage.
- Estimate totals and version snapshots must be generated server-side.

## Deployment Sequence

1. Create or select the dedicated MarineQuote Supabase project.
2. Link this repository to that project.
3. Apply migrations in timestamp order.
4. Create Eduardo's Auth user with the required metadata.
5. Configure the production Supabase URL and publishable key.
6. Deploy `generate-estimate-pdf`.
7. Deploy the website branch.
8. Run the end-to-end acceptance flow.

## Acceptance Flow

1. Sign in as Eduardo.
2. Create a customer.
3. Create a vessel assigned to that customer.
4. Create an estimate.
5. Add materials and labor.
6. Confirm calculations and preview content.
7. Save and reopen the estimate.
8. Confirm a new immutable version exists after each save.
9. Generate the PDF.
10. Download the PDF through a signed URL.

## Current Implementation State

The application, migrations, RLS policies, versioning, dashboard, estimate
builder, and private PDF function are implemented on
`feature/marinequote-phase-a`. Remote Supabase provisioning, credential
installation, migrations, Edge Function deployment, and production acceptance
testing remain environment-dependent tasks.
