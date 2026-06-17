import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0';

const allowedOrigins = new Set([
  'https://marineconsolidatedelectronics.com',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);

const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const serviceTypes = new Set([
  'electrical_issue',
  'electronics_issue',
  'generator',
  'battery_bank',
  'inverter',
  'shore_power',
  'corrosion',
  'navigation_system',
  'other',
]);
const priorities = new Set(['emergency', 'within_24_hours', 'this_week', 'no_rush']);

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin)
    ? origin
    : 'https://marineconsolidatedelectronics.com';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function cleanText(value: unknown, maxLength = 3000) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(value: unknown) {
  return cleanText(value, 254).toLowerCase();
}

function normalizePhone(value: unknown) {
  const raw = cleanText(value, 40);
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return `+${digits.replace(/\D/g, '').slice(0, 15)}`;
  return digits.replace(/\D/g, '').slice(0, 15);
}

function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded
    || request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || null;
}

function serviceLabel(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function priorityLabel(value: string) {
  const labels: Record<string, string> = {
    emergency: 'Emergency',
    within_24_hours: 'Within 24 Hours',
    this_week: 'This Week',
    no_rush: 'No Rush',
  };
  return labels[value] || value;
}

async function countRecent(admin: any, column: string, value: string | null, cutoff: string) {
  if (!value) return 0;
  const { count, error } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
    .gte('created_at', cutoff);
  if (error) throw error;
  return count ?? 0;
}

async function findAssignmentProfile(admin: any) {
  const { data: admins, error: adminError } = await admin
    .from('profiles')
    .select('id')
    .eq('active', true)
    .eq('role', 'admin')
    .limit(1);
  if (adminError) throw adminError;
  if (admins?.[0]?.id) return admins[0].id;

  const { data: users, error: userError } = await admin
    .from('profiles')
    .select('id')
    .eq('active', true)
    .limit(1);
  if (userError) throw userError;
  return users?.[0]?.id || null;
}

async function findOrCreateCustomer(admin: any, payload: any, assignedTo: string) {
  const { data: emailMatches, error: emailError } = await admin
    .from('customers')
    .select('id, contact_name, email, phone')
    .ilike('email', payload.email)
    .is('archived_at', null)
    .limit(1);
  if (emailError) throw emailError;
  if (emailMatches?.[0]) return emailMatches[0];

  const { data: phoneMatches, error: phoneError } = await admin
    .from('customers')
    .select('id, contact_name, email, phone')
    .eq('phone', payload.phone)
    .is('archived_at', null)
    .limit(1);
  if (phoneError) throw phoneError;
  if (phoneMatches?.[0]) return phoneMatches[0];

  const { data: customer, error } = await admin
    .from('customers')
    .insert({
      contact_name: payload.fullName,
      email: payload.email,
      phone: payload.phone,
      billing_address: {
        city: payload.city,
        marina_name: payload.marinaName,
      },
      notes: `Website lead capture.\nService: ${serviceLabel(payload.serviceType)}\nPriority: ${priorityLabel(payload.priority)}`,
      created_by: assignedTo,
      updated_by: assignedTo,
    })
    .select('id, contact_name, email, phone')
    .single();
  if (error) throw error;
  return customer;
}

async function findOrCreateVessel(admin: any, payload: any, customerId: string, assignedTo: string) {
  if (!payload.vesselName) return null;

  const { data: vessels, error: vesselError } = await admin
    .from('vessels')
    .select('id, vessel_name, vessel_type, location')
    .eq('customer_id', customerId)
    .is('archived_at', null);
  if (vesselError) throw vesselError;

  const existing = vessels?.find((vessel: any) => (
    String(vessel.vessel_name || '').trim().toLowerCase() === payload.vesselName.toLowerCase()
  ));
  if (existing) return existing;

  const location = [payload.marinaName, payload.city].filter(Boolean).join(', ') || null;
  const { data: vessel, error } = await admin
    .from('vessels')
    .insert({
      customer_id: customerId,
      vessel_name: payload.vesselName,
      vessel_type: payload.boatType || null,
      location,
      notes: 'Created from website lead capture.',
      created_by: assignedTo,
      updated_by: assignedTo,
    })
    .select('id, vessel_name, vessel_type, location')
    .single();
  if (error) throw error;
  return vessel;
}

async function createPipelineRecord(admin: any, payload: any, customerId: string, vesselId: string | null, assignedTo: string) {
  const notes = [
    'Website lead form submission.',
    `Service: ${serviceLabel(payload.serviceType)}`,
    `Priority: ${priorityLabel(payload.priority)}`,
    payload.marinaName ? `Marina: ${payload.marinaName}` : null,
    payload.city ? `City: ${payload.city}` : null,
    `Problem: ${payload.problemDescription}`,
  ].filter(Boolean).join('\n');

  const { data: pipeline, error } = await admin
    .from('sales_pipeline')
    .insert({
      customer_id: customerId,
      vessel_id: vesselId,
      stage: 'lead',
      source: 'website_lead_form',
      assigned_to: assignedTo,
      notes,
    })
    .select('id')
    .single();
  if (error) throw error;
  return pipeline;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, headers);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase runtime configuration is missing');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = await request.json();
    const honeypot = cleanText(body?.companyWebsite, 500);
    if (honeypot) {
      return jsonResponse({ ok: true }, 200, headers);
    }

    const payload = {
      fullName: cleanText(body?.fullName, 160),
      phone: normalizePhone(body?.phone),
      email: normalizeEmail(body?.email),
      vesselName: cleanText(body?.vesselName, 160) || null,
      boatType: cleanText(body?.boatType, 100) || null,
      marinaName: cleanText(body?.marinaName, 160) || null,
      city: cleanText(body?.city, 120) || null,
      serviceType: cleanText(body?.serviceType, 60),
      problemDescription: cleanText(body?.problemDescription, 3000),
      priority: cleanText(body?.priority, 40),
      source: 'website_lead_form',
    };

    const validationErrors: Record<string, string> = {};
    if (payload.fullName.length < 2) validationErrors.fullName = 'Full name is required.';
    if (payload.phone.length < 7) validationErrors.phone = 'A valid phone number is required.';
    if (!emailPattern.test(payload.email)) validationErrors.email = 'A valid email is required.';
    if (!serviceTypes.has(payload.serviceType)) validationErrors.serviceType = 'Select a service type.';
    if (!priorities.has(payload.priority)) validationErrors.priority = 'Select a priority.';
    if (payload.problemDescription.length < 10) {
      validationErrors.problemDescription = 'Describe the service need in at least 10 characters.';
    }
    if (Object.keys(validationErrors).length) {
      return jsonResponse({ error: 'Validation failed', fields: validationErrors }, 400, headers);
    }

    const ipAddress = clientIp(request);
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [emailCount, phoneCount, ipCount] = await Promise.all([
      countRecent(admin, 'email', payload.email, cutoff),
      countRecent(admin, 'phone', payload.phone, cutoff),
      countRecent(admin, 'ip_address', ipAddress, cutoff),
    ]);
    if (emailCount >= 3 || phoneCount >= 3 || ipCount >= 10) {
      return jsonResponse({ error: 'Too many requests. Please call us directly for urgent service.' }, 429, headers);
    }

    const assignedTo = await findAssignmentProfile(admin);
    if (!assignedTo) {
      return jsonResponse({ error: 'Lead routing is not configured.' }, 503, headers);
    }

    const { data: lead, error: leadError } = await admin
      .from('leads')
      .insert({
        full_name: payload.fullName,
        phone: payload.phone,
        email: payload.email,
        vessel_name: payload.vesselName,
        boat_type: payload.boatType,
        marina_name: payload.marinaName,
        city: payload.city,
        service_type: payload.serviceType,
        problem_description: payload.problemDescription,
        priority: payload.priority,
        source: payload.source,
        status: 'new',
        ip_address: ipAddress,
        user_agent: cleanText(request.headers.get('user-agent'), 500) || null,
      })
      .select('id')
      .single();
    if (leadError || !lead) throw leadError;

    const customer = await findOrCreateCustomer(admin, payload, assignedTo);
    const vessel = await findOrCreateVessel(admin, payload, customer.id, assignedTo);
    const pipeline = await createPipelineRecord(
      admin,
      payload,
      customer.id,
      vessel?.id || null,
      assignedTo,
    );

    const { error: updateLeadError } = await admin
      .from('leads')
      .update({
        status: 'converted',
        customer_id: customer.id,
        vessel_id: vessel?.id || null,
        pipeline_id: pipeline.id,
      })
      .eq('id', lead.id);
    if (updateLeadError) throw updateLeadError;

    return jsonResponse({
      ok: true,
      leadId: lead.id,
      customerId: customer.id,
      vesselId: vessel?.id || null,
      pipelineId: pipeline.id,
    }, 201, headers);
  } catch (error) {
    console.error('[submit-lead]', error);
    return jsonResponse({ error: 'Unable to submit your request. Please call Marine Consolidated Electronics.' }, 500, headers);
  }
});
