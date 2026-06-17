# PHASE_3B_DATA_FOUNDATION_REPORT.md

## Phase

Natalie AI Phase 3B - Data Foundation

## Scope

Implemented only:

- `conversations`
- `messages`
- `appointments`
- relationships
- indexes
- RLS
- authenticated admin visibility inside MarineQuote AI

Not implemented:

- Twilio
- WhatsApp
- AI
- OpenAI
- automated outbound messaging
- automated qualification engine

## Architecture

```text
Lead
  -> Conversation
  -> Messages
  -> Appointment Request
  -> visible inside MarineQuote AI
```

Natalie data is now modeled as CRM infrastructure. The public browser still does not write directly to Natalie tables. Admin/staff users can view and manually create foundation records through authenticated MarineQuote AI admin pages.

## Database Migration

Created:

- `supabase/migrations/202606170002_natalie_data_foundation.sql`

Created enums:

- `conversation_channel`
- `conversation_status`
- `qualification_state`
- `message_direction`
- `message_sender_type`
- `message_delivery_status`
- `appointment_status`

Created tables:

- `public.conversations`
- `public.messages`
- `public.appointments`

## Tables

### `conversations`

Purpose:

- Represents a Natalie intake session linked to a lead/customer/vessel/pipeline opportunity.

Key relationships:

- `lead_id -> leads.id`
- `customer_id -> customers.id`
- `vessel_id -> vessels.id`
- `pipeline_id -> sales_pipeline.id`
- `assigned_to -> profiles.id`

Indexes:

- `conversations_lead_id_idx`
- `conversations_customer_id_idx`
- `conversations_vessel_id_idx`
- `conversations_pipeline_id_idx`
- `conversations_status_updated_idx`
- `conversations_channel_external_idx`
- `conversations_last_message_idx`
- `conversations_assigned_to_idx`

### `messages`

Purpose:

- Stores inbound/outbound conversation messages for auditability and CRM visibility.

Key relationships:

- `conversation_id -> conversations.id`
- `lead_id -> leads.id`
- `customer_id -> customers.id`

Indexes:

- `messages_conversation_created_idx`
- `messages_customer_created_idx`
- `messages_lead_created_idx`
- `messages_external_message_idx`
- `messages_delivery_status_idx`

Automation:

- New messages update `conversations.last_message_at`.

### `appointments`

Purpose:

- Stores requested inspection windows and location details.

Key relationships:

- `lead_id -> leads.id`
- `customer_id -> customers.id`
- `vessel_id -> vessels.id`
- `pipeline_id -> sales_pipeline.id`
- `conversation_id -> conversations.id`

Indexes:

- `appointments_customer_id_idx`
- `appointments_vessel_id_idx`
- `appointments_pipeline_id_idx`
- `appointments_conversation_id_idx`
- `appointments_status_start_idx`
- `appointments_created_idx`

## RLS

RLS enabled:

- `conversations`: yes
- `messages`: yes
- `appointments`: yes

Anonymous access:

- revoked on all three tables

Authenticated active users:

- can read, insert, and update

Admin users:

- can delete

Service role:

- can read, insert, update, and delete for future Edge Function processing

## Relationship Protection

Added validation triggers:

- conversation and appointment records validate that vessel/pipeline/lead relationships match the selected customer.
- message records validate that message lead/customer context matches the selected conversation.
- messages inherit lead/customer context from the parent conversation when omitted.

## Admin Visibility

Created:

- `admin/natalie.html`
- `admin/js/natalie.js`

Modified:

- `admin/css/admin.css`
- admin sidebar navigation across existing admin pages

Admin capabilities:

- View Natalie conversation counts.
- View active, waiting, qualified, message, and appointment request metrics.
- Create a manual Natalie conversation from an existing website lead.
- View conversations with linked customer/vessel/lead context.
- View messages per selected conversation.
- Add manual messages to a selected conversation.
- View appointment requests.
- Add a manual appointment request to a selected conversation.

Admin URL:

- `https://marineconsolidatedelectronics.com/admin/natalie.html`

## Production Deployment

Supabase project:

- `marinequote-ai-prod`
- project ref: `wxhqhlwfwsrarhacdzlu`

Migration deployed:

- `202606170002_natalie_data_foundation.sql`

Production DB verification:

- `conversations` exists
- `messages` exists
- `appointments` exists
- RLS enabled on all three tables
- initial counts are zero

Admin UI deployment:

- `https://marineconsolidatedelectronics.com/admin/natalie.html` returns HTTP 200
- deployed markup includes Natalie conversation, message, and appointment sections
- dashboard navigation includes the Natalie admin link

## Verification

Local:

- `git diff --check`: passed
- `npm test`: passed

Production:

- migration applied successfully with `supabase db push --linked --yes`
- RLS verified through production database query
- table columns verified through production database query
- table counts verified through production database query

## Current Counts After Migration

- conversations: `0`
- messages: `0`
- appointments: `0`

No fake Natalie data was inserted.

## Remaining Work

Next phase should implement the actual Natalie intake workflow:

- create conversation automatically after `/lead/` submission
- Twilio WhatsApp webhook
- deterministic qualification state machine
- automated message creation
- appointment request capture from customer replies
- pipeline progression from `lead` to `qualified`
- assigned user notification

## Final Status

Phase 3B Data Foundation is production-deployed at the database layer and visible inside MarineQuote AI Admin.
