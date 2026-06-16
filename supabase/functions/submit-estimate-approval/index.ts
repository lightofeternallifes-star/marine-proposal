import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0';

const allowedOrigins = new Set([
  'https://marineconsolidatedelectronics.com',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);

const validActions = new Set(['view', 'approve', 'reject']);

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

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function isSafeToken(token: string) {
  return /^[A-Za-z0-9_-]{32,256}$/.test(token);
}

async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function clientIp(request: Request) {
  const raw = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) || /^[0-9a-f:]+$/i.test(raw)) {
    return raw;
  }
  return null;
}

function estimatePayload(estimate: any, tokenRecord: any) {
  const vesselName = estimate.vessels?.vessel_name
    || [estimate.vessels?.manufacturer, estimate.vessels?.model].filter(Boolean).join(' ')
    || estimate.vessels?.registration_number
    || 'Vessel';

  return {
    estimate: {
      id: estimate.id,
      estimateNumber: estimate.estimate_number,
      status: estimate.status,
      total: money(estimate.total_cents, estimate.currency),
      totalCents: estimate.total_cents,
      currency: estimate.currency,
      validityDays: estimate.validity_days,
      jobDescription: estimate.job_description,
      recommendedWork: estimate.recommended_work,
      customerNotes: estimate.customer_notes,
      sentAt: estimate.sent_at,
      generatedAt: estimate.generated_at,
    },
    customer: {
      name: estimate.customers?.company_name || estimate.customers?.contact_name,
      contactName: estimate.customers?.contact_name,
      companyName: estimate.customers?.company_name,
      email: estimate.customers?.email,
      phone: estimate.customers?.phone,
    },
    vessel: {
      name: vesselName,
      type: estimate.vessels?.vessel_type,
      manufacturer: estimate.vessels?.manufacturer,
      model: estimate.vessels?.model,
      registrationNumber: estimate.vessels?.registration_number,
      location: estimate.vessels?.location,
    },
    token: {
      expiresAt: tokenRecord.expires_at,
      usedAt: tokenRecord.used_at,
    },
  };
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

    const body = await request.json();
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const action = typeof body?.action === 'string' ? body.action : '';
    const customerNote = typeof body?.customerNote === 'string'
      ? body.customerNote.trim().slice(0, 2000)
      : null;

    if (!isSafeToken(token)) {
      return jsonResponse({ error: 'Invalid approval link' }, 400, headers);
    }
    if (!validActions.has(action)) {
      return jsonResponse({ error: 'Invalid approval action' }, 400, headers);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const tokenHash = await sha256Hex(token);

    const { data: tokenRecord, error: tokenError } = await admin
      .from('estimate_approval_tokens')
      .select(`
        id, estimate_id, document_id, recipient_email, expires_at, used_at, revoked_at,
        estimates(
          id, estimate_number, status, currency, total_cents, validity_days,
          job_description, recommended_work, customer_notes, generated_at, sent_at,
          customers(contact_name, company_name, email, phone),
          vessels(vessel_name, vessel_type, manufacturer, model, registration_number, location)
        )
      `)
      .eq('token_hash', tokenHash)
      .single();

    if (tokenError || !tokenRecord) {
      return jsonResponse({ error: 'Invalid approval link' }, 404, headers);
    }
    if (tokenRecord.revoked_at) {
      return jsonResponse({ error: 'This approval link is no longer available' }, 410, headers);
    }
    if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
      return jsonResponse({ error: 'This approval link has expired' }, 410, headers);
    }

    const estimate = tokenRecord.estimates;
    if (!estimate) {
      return jsonResponse({ error: 'Estimate not found' }, 404, headers);
    }

    const eventBase = {
      estimate_id: estimate.id,
      approval_token_id: tokenRecord.id,
      recipient_email: tokenRecord.recipient_email,
      user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
      ip_address: clientIp(request),
    };

    if (action === 'view') {
      await admin.from('estimate_approval_events').insert({
        ...eventBase,
        action: 'viewed',
      });
      return jsonResponse(estimatePayload(estimate, tokenRecord), 200, headers);
    }

    if (tokenRecord.used_at) {
      return jsonResponse({
        error: 'This estimate has already received a customer decision',
        ...estimatePayload(estimate, tokenRecord),
      }, 409, headers);
    }

    const nextStatus = action === 'approve' ? 'approved' : 'rejected';
    const eventAction = action === 'approve' ? 'approved' : 'rejected';
    const decidedAt = new Date().toISOString();

    const { error: estimateUpdateError } = await admin
      .from('estimates')
      .update({
        status: nextStatus,
        updated_at: decidedAt,
      })
      .eq('id', estimate.id)
      .in('status', ['sent', 'generated']);

    if (estimateUpdateError) throw estimateUpdateError;

    const { error: tokenUpdateError } = await admin
      .from('estimate_approval_tokens')
      .update({ used_at: decidedAt })
      .eq('id', tokenRecord.id)
      .is('used_at', null);
    if (tokenUpdateError) throw tokenUpdateError;

    const { error: eventError } = await admin
      .from('estimate_approval_events')
      .insert({
        ...eventBase,
        action: eventAction,
        customer_note: customerNote || null,
      });
    if (eventError) throw eventError;

    return jsonResponse({
      status: nextStatus,
      decidedAt,
      message: action === 'approve'
        ? 'Estimate approved successfully'
        : 'Estimate rejected successfully',
    }, 200, headers);
  } catch (error) {
    console.error('submit-estimate-approval failed:', safeErrorMessage(error));
    return jsonResponse({ error: 'Unable to process this approval request' }, 500, headers);
  }
});
