import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0';
import nodemailer from 'npm:nodemailer@6.10.1';

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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

async function sendDecisionNotification(estimate: any, action: string, customerNote: string | null) {
  const smtpHost = Deno.env.get('SMTP_HOST');
  const smtpPort = Number(Deno.env.get('SMTP_PORT') || '465');
  const smtpUser = Deno.env.get('SMTP_USER');
  const smtpPassword = Deno.env.get('SMTP_PASSWORD');
  const smtpSecureValue = Deno.env.get('SMTP_SECURE');
  const smtpSecure = smtpSecureValue
    ? smtpSecureValue.toLowerCase() === 'true'
    : smtpPort === 465;
  const fromEmail = Deno.env.get('SMTP_FROM_EMAIL') || smtpUser;
  const fromName = Deno.env.get('SMTP_FROM_NAME') || 'Marine Consolidated Electronics';
  const replyTo = Deno.env.get('SMTP_REPLY_TO') || fromEmail;
  const notificationEmail = Deno.env.get('APPROVAL_NOTIFICATION_EMAIL') || replyTo || fromEmail;

  if (
    !smtpHost
    || !Number.isInteger(smtpPort)
    || smtpPort < 1
    || smtpPort > 65535
    || !smtpUser
    || !smtpPassword
    || !fromEmail
    || !notificationEmail
  ) {
    throw new Error('Email provider configuration is incomplete');
  }

  const vesselName = estimate.vessels?.vessel_name
    || [estimate.vessels?.manufacturer, estimate.vessels?.model].filter(Boolean).join(' ')
    || estimate.vessels?.registration_number
    || 'Vessel';
  const customerName = estimate.customers?.company_name || estimate.customers?.contact_name || 'Customer';
  const decision = action === 'approve' ? 'Approved' : 'Rejected';
  const total = money(estimate.total_cents, estimate.currency);
  const noteHtml = customerNote
    ? `<p style="margin:0 0 16px;"><strong>Customer note:</strong><br>${escapeHtml(customerNote).replace(/\n/g, '<br>')}</p>`
    : '<p style="margin:0 0 16px;color:#5d6d7e;">No customer note was provided.</p>';

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    requireTLS: !smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
    tls: {
      minVersion: 'TLSv1.2',
    },
  });

  const result = await transporter.sendMail({
    from: {
      name: fromName,
      address: fromEmail,
    },
    to: notificationEmail,
    replyTo,
    subject: `${decision}: Quote ${estimate.estimate_number} - ${vesselName}`,
    html: `
      <!doctype html>
      <html lang="en">
        <body style="margin:0;padding:0;background:#f3f6f8;color:#172331;font-family:Arial,Helvetica,sans-serif;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6f8;width:100%;">
            <tr>
              <td align="center" style="padding:28px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                  style="max-width:620px;background:#ffffff;border:1px solid #d9e0e7;border-radius:10px;overflow:hidden;">
                  <tr>
                    <td style="padding:20px 28px;background:#071827;color:#ffffff;">
                      <strong style="display:block;font-size:16px;">Marine Consolidated Electronics</strong>
                      <span style="display:block;margin-top:4px;color:#D4AF37;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;">
                        Customer Estimate Decision
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:28px;font-size:15px;line-height:1.65;">
                      <h1 style="margin:0 0 18px;color:#071827;font-size:24px;">Estimate ${decision}</h1>
                      <p style="margin:0 0 16px;">
                        A customer has ${decision.toLowerCase()} quote
                        <strong>${escapeHtml(estimate.estimate_number)}</strong>.
                      </p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                        style="margin:0 0 18px;background:#071827;border:1px solid #D4AF37;border-radius:8px;">
                        <tr>
                          <td style="padding:16px 18px;color:#D4AF37;font-size:12px;font-weight:700;text-transform:uppercase;">
                            Quote Total
                          </td>
                          <td align="right" style="padding:16px 18px;color:#ffffff;font-size:22px;font-weight:700;">
                            ${escapeHtml(total)}
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 8px;"><strong>Customer:</strong> ${escapeHtml(customerName)}</p>
                      <p style="margin:0 0 8px;"><strong>Vessel:</strong> ${escapeHtml(vesselName)}</p>
                      <p style="margin:0 0 16px;"><strong>Decision:</strong> ${decision}</p>
                      ${noteHtml}
                      <p style="margin:18px 0 0;color:#5d6d7e;font-size:13px;">
                        This notification was generated automatically by MarineQuote AI.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    headers: {
      'X-MarineQuote-Estimate': estimate.estimate_number,
      'X-MarineQuote-Customer-Decision': decision,
    },
  });

  const messageId = String(result.messageId || '');
  if (!messageId) {
    throw new Error('SMTP provider did not return a message ID');
  }
  return messageId;
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
        error: 'This approval link has already been used.',
        ...estimatePayload(estimate, tokenRecord),
      }, 409, headers);
    }

    const nextStatus = action === 'approve' ? 'approved' : 'rejected';
    const eventAction = action === 'approve' ? 'approved' : 'rejected';
    const decidedAt = new Date().toISOString();
    let approvableStatus = estimate.status;

    if (approvableStatus === 'generated') {
      const { data: sentDelivery, error: sentDeliveryError } = await admin
        .from('estimate_deliveries')
        .select('sent_at')
        .eq('estimate_id', estimate.id)
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sentDeliveryError) throw sentDeliveryError;
      if (!sentDelivery?.sent_at) {
        return jsonResponse({
          error: 'This estimate has not been sent yet. Please contact Marine Consolidated Electronics.',
        }, 409, headers);
      }

      const { error: repairError } = await admin
        .from('estimates')
        .update({
          status: 'sent',
          sent_at: sentDelivery.sent_at,
        })
        .eq('id', estimate.id)
        .eq('status', 'generated');
      if (repairError) throw repairError;
      approvableStatus = 'sent';
    }

    if (approvableStatus !== 'sent') {
      return jsonResponse({
        error: 'This approval link has already been used.',
        ...estimatePayload(estimate, tokenRecord),
      }, 409, headers);
    }

    const { error: estimateUpdateError } = await admin
      .from('estimates')
      .update({
        status: nextStatus,
        updated_at: decidedAt,
      })
      .eq('id', estimate.id)
      .eq('status', 'sent');

    if (estimateUpdateError) throw estimateUpdateError;

    const { error: eventError } = await admin
      .from('estimate_approval_events')
      .insert({
        ...eventBase,
        action: eventAction,
        customer_note: customerNote || null,
      });
    if (eventError) throw eventError;

    const { error: tokenUpdateError } = await admin
      .from('estimate_approval_tokens')
      .update({ used_at: decidedAt })
      .eq('id', tokenRecord.id)
      .is('used_at', null);
    if (tokenUpdateError) throw tokenUpdateError;

    let notificationStatus = 'sent';
    let notificationMessageId: string | null = null;
    try {
      notificationMessageId = await sendDecisionNotification(estimate, action, customerNote);
      await admin
        .from('estimate_approval_events')
        .insert({
          ...eventBase,
          action: 'notification_sent',
          customer_note: notificationMessageId,
        });
    } catch (notificationError) {
      notificationStatus = 'failed';
      console.error('approval notification failed:', safeErrorMessage(notificationError));
      await admin
        .from('estimate_approval_events')
        .insert({
          ...eventBase,
          action: 'notification_failed',
          customer_note: safeErrorMessage(notificationError),
        });
    }

    return jsonResponse({
      status: nextStatus,
      decidedAt,
      notificationStatus,
      notificationMessageId,
      message: action === 'approve'
        ? 'Estimate approved successfully'
        : 'Estimate rejected successfully',
    }, 200, headers);
  } catch (error) {
    console.error('submit-estimate-approval failed:', safeErrorMessage(error));
    return jsonResponse({ error: 'Unable to process this approval request' }, 500, headers);
  }
});
