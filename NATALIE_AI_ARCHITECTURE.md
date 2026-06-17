# NATALIE_AI_ARCHITECTURE.md

## 1. System Architecture

Natalie AI is Marine Consolidated Electronics' virtual sales coordinator and customer intake specialist. Natalie is not a chatbot. Natalie is an operational intake layer that qualifies inbound leads, protects Eduardo's time, structures customer data, requests appointment windows, updates the CRM, and advances qualified opportunities through the sales pipeline.

Current production foundation:

- Website: `https://marineconsolidatedelectronics.com`
- Lead capture route: `/lead/`
- Supabase project: `marinequote-ai-prod`
- Existing tables: `leads`, `customers`, `vessels`, `sales_pipeline`, `estimates`, `estimate_documents`, `estimate_deliveries`, `estimate_approval_tokens`, `estimate_approval_events`
- Existing pipeline stage for new inbound leads: `lead`

Target Natalie flow:

```text
Website Lead Form
  -> leads
  -> customers
  -> vessels
  -> sales_pipeline stage=lead
  -> Natalie starts qualification
  -> conversations
  -> messages
  -> appointments
  -> required data complete
  -> sales_pipeline stage=qualified
  -> assigned user notified
```

Natalie should be channel-agnostic. The first production channel should be WhatsApp because Marine service customers respond quickly there, but the data model must also support SMS, web chat, phone transcript, and email intake later.

Core responsibilities:

- Identify the customer and vessel.
- Confirm whether the vessel is at a marina or private residence.
- Collect vessel type and vessel name.
- Classify the requested service.
- Determine whether the issue prevents vessel operation.
- Collect exact vessel location.
- Request inspection date and time.
- Update the CRM with structured data.
- Move complete opportunities from `lead` to `qualified`.
- Notify the assigned user when Natalie completes qualification.

## 2. WhatsApp Architecture

Recommended provider:

- Twilio WhatsApp Business API

Primary inbound/outbound flow:

```text
Customer submits /lead/
  -> submit-lead creates lead/customer/vessel/pipeline
  -> Natalie session is created
  -> outbound WhatsApp message sent via Twilio
  -> customer replies
  -> Twilio webhook receives message
  -> Supabase Edge Function stores message
  -> Natalie state machine determines next question
  -> response is sent through Twilio
  -> qualification completeness is recalculated
  -> pipeline stage updates when complete
```

Recommended Edge Functions:

- `start-natalie-qualification`
  - Creates conversation for a new lead.
  - Sends first outbound WhatsApp message.
  - Can be triggered after lead capture or manually from admin.

- `twilio-whatsapp-webhook`
  - Receives inbound WhatsApp messages.
  - Verifies Twilio signature.
  - Normalizes message payload.
  - Inserts message into `messages`.
  - Advances conversation state.
  - Sends Natalie reply.

- `natalie-notify-assignee`
  - Sends internal notification when qualification is complete.
  - Can use email first, then WhatsApp/SMS later.

WhatsApp message strategy:

- Keep each message short.
- Ask one question at a time.
- Confirm critical fields before advancing.
- Use structured replies where possible.
- Avoid free-form ambiguity for service type and priority.
- Escalate emergency cases immediately.

Natalie qualification questions:

1. Is your vessel located at a marina or private residence?
2. What type of vessel do you have?
3. What is the vessel name?
4. What service do you need?
   - Electrical
   - Generator
   - Battery
   - Inverter
   - Shore Power
   - Navigation
   - Electronics
   - Other
5. Is this preventing the vessel from operating?
6. Where is your vessel currently located?
   - Marina Name
   - City
   - State / Province
   - Country
7. What is the best date and time for an inspection?

Emergency handling:

- If the customer says the vessel cannot operate, mark `priority = emergency`.
- Add an internal notification immediately.
- Keep the pipeline in `lead` or `qualified` depending on required data completion, but flag the conversation as urgent.

## 3. Database Schema

### `conversations`

Purpose:

- Represents a Natalie-led qualification session across one channel.
- Links the lead, customer, vessel, and pipeline opportunity.

Recommended fields:

```sql
id uuid primary key default gen_random_uuid()
lead_id uuid references public.leads(id) on delete set null
customer_id uuid references public.customers(id) on delete set null
vessel_id uuid references public.vessels(id) on delete set null
pipeline_id uuid references public.sales_pipeline(id) on delete set null
channel text not null
external_conversation_id text
external_contact_id text
status text not null default 'active'
qualification_state text not null default 'started'
current_question_key text
assigned_to uuid references public.profiles(id) on delete set null
last_message_at timestamptz
completed_at timestamptz
archived_at timestamptz
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Recommended `channel` values:

- `whatsapp`
- `sms`
- `web`
- `email`
- `phone`

Recommended `status` values:

- `active`
- `waiting_on_customer`
- `qualified`
- `appointment_requested`
- `escalated`
- `closed`
- `archived`

Recommended `qualification_state` values:

- `started`
- `location_type_requested`
- `vessel_type_requested`
- `vessel_name_requested`
- `service_type_requested`
- `operability_requested`
- `location_details_requested`
- `appointment_requested`
- `complete`

Indexes:

```sql
create index conversations_lead_id_idx on public.conversations (lead_id);
create index conversations_customer_id_idx on public.conversations (customer_id);
create index conversations_pipeline_id_idx on public.conversations (pipeline_id);
create index conversations_status_updated_idx on public.conversations (status, updated_at desc);
create index conversations_channel_external_idx on public.conversations (channel, external_contact_id);
create index conversations_last_message_idx on public.conversations (last_message_at desc);
```

Retention:

- Active conversations: retained indefinitely while customer/pipeline is active.
- Closed non-customer spam conversations: archive after 90 days.
- Message content: retain for 24 months by default, then archive/export if needed.
- Metadata and qualification summary: retain with customer record.

### `messages`

Purpose:

- Stores every inbound/outbound Natalie message for auditability, debugging, and customer history.

Recommended fields:

```sql
id uuid primary key default gen_random_uuid()
conversation_id uuid not null references public.conversations(id) on delete cascade
lead_id uuid references public.leads(id) on delete set null
customer_id uuid references public.customers(id) on delete set null
direction text not null
sender_type text not null
channel text not null
external_message_id text
body text not null
structured_payload jsonb not null default '{}'::jsonb
delivery_status text
error_message text
created_at timestamptz not null default now()
```

Recommended `direction` values:

- `inbound`
- `outbound`

Recommended `sender_type` values:

- `customer`
- `natalie`
- `staff`
- `system`

Indexes:

```sql
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index messages_customer_created_idx on public.messages (customer_id, created_at desc);
create index messages_external_message_idx on public.messages (external_message_id);
create index messages_delivery_status_idx on public.messages (delivery_status);
```

Retention:

- Retain full message history for 24 months.
- Never store secrets, provider auth payloads, or raw webhook signatures.
- Keep structured payloads minimal and operationally useful.

### `appointments`

Purpose:

- Stores customer-requested inspection windows.
- Does not need to be a full scheduling system in Phase 3A.

Recommended fields:

```sql
id uuid primary key default gen_random_uuid()
lead_id uuid references public.leads(id) on delete set null
customer_id uuid not null references public.customers(id) on delete restrict
vessel_id uuid references public.vessels(id) on delete set null
pipeline_id uuid references public.sales_pipeline(id) on delete set null
conversation_id uuid references public.conversations(id) on delete set null
requested_start_at timestamptz
requested_end_at timestamptz
requested_time_text text
timezone text
location_type text
marina_name text
city text
state_province text
country text
status text not null default 'requested'
notes text
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Recommended `status` values:

- `requested`
- `confirmed`
- `reschedule_requested`
- `completed`
- `cancelled`

Indexes:

```sql
create index appointments_customer_id_idx on public.appointments (customer_id);
create index appointments_pipeline_id_idx on public.appointments (pipeline_id);
create index appointments_status_start_idx on public.appointments (status, requested_start_at);
create index appointments_created_idx on public.appointments (created_at desc);
```

Retention:

- Retain appointment records indefinitely as part of customer service history.
- Archive cancelled/no-show appointments after 24 months if no estimate or customer activity exists.

### Lead data extensions

The existing `leads` table can support Phase 3A, but Natalie will eventually need more structured qualification fields. Recommended additive fields for a future migration:

```sql
location_type text
state_province text
country text
is_operability_blocked boolean
qualified_at timestamptz
qualification_completed_by text
qualification_summary jsonb
```

Alternative:

- Keep `leads` stable.
- Store Natalie-specific structured qualification in `conversations.qualification_summary`.

Recommendation:

- Use `conversations` and `appointments` for Phase 3A.
- Add only the minimum lead fields later if dashboard filtering requires them.

## 4. Pipeline Integration

Existing pipeline entry point:

```text
/lead/
  -> submit-lead
  -> sales_pipeline.stage = lead
```

Natalie progression rule:

Move from `lead` to `qualified` automatically only when required information exists.

Required qualification fields:

- customer full name
- phone
- email
- vessel location type
- vessel type
- vessel name
- service type
- operability blocked answer
- marina/private residence location details
- requested inspection date/time

Automatic stage update:

```text
if required fields complete:
  sales_pipeline.stage = qualified
  sales_pipeline.notes += Natalie qualification summary
  conversations.status = qualified
  conversations.completed_at = now()
  notify assigned user
```

Do not move to `appointment_scheduled` until Eduardo or staff confirms an actual inspection time.

Recommended stage semantics:

- `lead`: request received, qualification incomplete.
- `qualified`: Natalie collected required intake data and appointment request.
- `appointment_scheduled`: staff confirmed inspection date/time.
- `estimate_sent`: quote sent.
- `approved`: customer approved quote.
- `won`: business manually marked won.
- `lost`: customer rejected or staff marked lost.

Pipeline notes should include:

- service type
- urgency
- operability impact
- location
- requested inspection date/time
- Natalie confidence/completion status

## 5. Appointment Integration

Natalie should request an inspection window, not promise an appointment.

Customer-facing language:

```text
What is the best date and time for an inspection? Eduardo's team will confirm availability.
```

Recommended appointment lifecycle:

```text
requested by customer
  -> appointments.status = requested
  -> assigned user notified
  -> staff confirms/reschedules
  -> appointments.status = confirmed
  -> sales_pipeline.stage = appointment_scheduled
```

Phase 3A should not require Google Calendar, Calendly, or automatic scheduling. Those can be added later after the intake workflow is stable.

Future appointment automation:

- Google Calendar integration
- staff availability rules
- service territory logic
- travel window calculation
- automatic reminders
- no-show tracking

## 6. Twilio Requirements

Required Twilio setup:

- Twilio account
- WhatsApp Business sender
- approved WhatsApp Business profile
- verified sender number
- messaging service SID
- webhook URL for inbound messages
- webhook URL for delivery status callbacks
- production phone number mapping

Required Supabase secrets:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_FROM
TWILIO_MESSAGING_SERVICE_SID
TWILIO_WEBHOOK_AUTH_SECRET
NATALIE_NOTIFY_EMAIL
```

Optional future secrets:

```text
OPENAI_API_KEY
NATALIE_MODEL
NATALIE_ESCALATION_PHONE
NATALIE_ESCALATION_EMAIL
```

Webhook security:

- Verify Twilio request signature.
- Reject unsigned or invalid webhook calls.
- Store only normalized message payloads.
- Never expose Twilio credentials to frontend.
- Use service role only inside Edge Functions.

WhatsApp constraints:

- Respect WhatsApp 24-hour customer service window.
- Use approved templates for outbound messages outside the active customer service window.
- Keep opt-out handling available.
- Track delivery failures.

## 7. Production Roadmap

### Phase 3A - Architecture Approval

Deliverable:

- `NATALIE_AI_ARCHITECTURE.md`

No deployment.
No implementation code.
No migrations.

### Phase 3B - Data Foundation

Build:

- `conversations`
- `messages`
- `appointments`
- RLS policies
- indexes
- optional lead qualification fields

Success criteria:

- Existing Lead Capture, CRM, Pipeline, Estimates, PDF, Email, and Approval Portal remain unchanged.
- Admin users can read Natalie conversations.
- Public users cannot read or write Natalie tables directly.

### Phase 3C - WhatsApp Inbound/Outbound

Build:

- `start-natalie-qualification`
- `twilio-whatsapp-webhook`
- Twilio signature verification
- message logging
- deterministic question state machine

Success criteria:

- A website lead can receive Natalie WhatsApp qualification.
- Customer replies are stored.
- Natalie asks the correct next question.

### Phase 3D - CRM and Pipeline Automation

Build:

- qualification completeness evaluator
- lead to qualified pipeline progression
- appointment request creation
- internal notification to assigned user

Success criteria:

- A complete Natalie flow moves pipeline from `lead` to `qualified`.
- Appointment request appears in database.
- Assigned user receives notification.

### Phase 3E - Admin Visibility

Build:

- Natalie conversation panel in customer profile.
- Pipeline card qualification summary.
- Appointment request view.
- Manual override for pipeline stage.

Success criteria:

- Eduardo can understand what Natalie collected without reading every message.
- Staff can confirm appointment without leaving MarineQuote AI.

### Phase 3F - Scale and Intelligence

Build:

- AI-assisted summary generation.
- duplicate lead handling.
- spam scoring.
- multilingual support.
- follow-up reminders.
- reporting by service type, geography, urgency, and close rate.

Success criteria:

- Natalie can handle 1,000+ leads per month without redesign.
- Staff sees prioritized, structured, actionable opportunities.

## 8. Security Considerations

Access model:

- Public browser must never write directly to `conversations`, `messages`, `appointments`, `customers`, `vessels`, or `sales_pipeline`.
- Public inbound requests must go through Edge Functions.
- Edge Functions use service role only on the server.
- Admin UI reads through authenticated Supabase client and RLS.

RLS requirements:

- `conversations`: authenticated active users can read/update; service role can insert/update.
- `messages`: authenticated active users can read; service role can insert; staff-authored messages require authenticated user.
- `appointments`: authenticated active users can read/update; service role can insert requested appointments.

Data protection:

- Do not store Twilio auth tokens in code.
- Do not log full webhook signatures.
- Do not log credentials.
- Avoid storing sensitive payment data. Natalie does not discuss payment collection.
- Keep customer message content limited to service intake.

Abuse prevention:

- Twilio signature verification.
- Rate limiting by phone/contact.
- Duplicate conversation detection.
- Spam keyword detection.
- Manual escalation for repeated abuse.

Operational safety:

- Natalie should not promise exact arrival times.
- Natalie should not quote pricing.
- Natalie should not diagnose final technical cause.
- Natalie should not say Eduardo personally confirmed anything unless staff action occurred.
- Natalie should present itself as Marine Consolidated's virtual coordinator, not as a human technician.

Recommended Natalie identity:

```text
Hi, this is Natalie, Marine Consolidated Electronics' virtual service coordinator. I will collect the details Eduardo's team needs to review your vessel service request.
```

Escalation triggers:

- vessel cannot operate
- smoke, burning smell, electrical hazard
- generator failure underway
- battery overheating
- shore power failure
- customer requests human help
- repeated unclear replies

## Final Recommendation

Build Natalie as a structured workflow engine first, with AI assistance added only where it improves summarization, classification, or customer-language handling.

The durable architecture is:

```text
Lead Capture
  -> Structured Conversation
  -> Message History
  -> Appointment Request
  -> CRM Update
  -> Pipeline Qualification
  -> Staff Notification
```

This protects Eduardo's time, improves response consistency, and creates a scalable intake system that can grow from 10 leads per month to 1,000+ leads per month without changing the core MarineQuote data model.
