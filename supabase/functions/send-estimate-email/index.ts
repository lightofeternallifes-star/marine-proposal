import nodemailer from 'nodemailer';
import { Buffer } from 'node:buffer';
import { createClient } from 'supabase';

const allowedOrigins = new Set([
  'https://marineconsolidatedelectronics.com',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);

const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
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

  let deliveryId: string | null = null;
  let supabase: any = null;
  let admin: any = null;

  try {
    const authorization = request.headers.get('authorization');
    if (!authorization) {
      return jsonResponse({ error: 'Authentication required' }, 401, headers);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Supabase runtime configuration is missing');
    }

    supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: 'Authentication required' }, 401, headers);
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, active')
      .eq('id', userData.user.id)
      .single();
    if (profileError || !profile?.active) {
      return jsonResponse({ error: 'Account is not active' }, 403, headers);
    }

    const body = await request.json();
    const estimateId = typeof body?.estimateId === 'string' ? body.estimateId : '';
    const confirmedRecipientEmail = typeof body?.recipientEmail === 'string'
      ? body.recipientEmail.trim().toLowerCase()
      : '';
    if (!estimateId) {
      return jsonResponse({ error: 'estimateId is required' }, 400, headers);
    }
    if (!emailPattern.test(confirmedRecipientEmail) || confirmedRecipientEmail.length > 254) {
      return jsonResponse({ error: 'A valid recipient email is required' }, 400, headers);
    }

    const { data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .select(`
        id, estimate_number, current_version, currency, total_cents,
        job_description, recommended_work,
        customers(contact_name, company_name, email),
        vessels(vessel_name, manufacturer, model, registration_number)
      `)
      .eq('id', estimateId)
      .single();
    if (estimateError || !estimate) {
      return jsonResponse({ error: 'Estimate not found' }, 404, headers);
    }
    const recipientEmail = estimate.customers.email?.trim().toLowerCase() || '';
    if (!emailPattern.test(recipientEmail) || recipientEmail.length > 254) {
      return jsonResponse({ error: 'The customer does not have a valid email address' }, 409, headers);
    }
    if (confirmedRecipientEmail !== recipientEmail) {
      return jsonResponse({ error: 'Recipient email no longer matches the customer record' }, 409, headers);
    }

    const { data: document, error: documentError } = await supabase
      .from('estimate_documents')
      .select('id, storage_path, version_number')
      .eq('estimate_id', estimate.id)
      .eq('version_number', estimate.current_version)
      .single();
    if (documentError || !document) {
      return jsonResponse({ error: 'Generate the current estimate PDF before sending' }, 409, headers);
    }

    const { data: delivery, error: deliveryError } = await admin
      .from('estimate_deliveries')
      .insert({
        estimate_id: estimate.id,
        document_id: document.id,
        recipient_email: recipientEmail,
        status: 'queued',
        provider: 'zoho_smtp',
        requested_by: userData.user.id,
      })
      .select('id')
      .single();
    if (deliveryError || !delivery) throw deliveryError;
    deliveryId = delivery.id;

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
    if (
      !smtpHost
      || !Number.isInteger(smtpPort)
      || smtpPort < 1
      || smtpPort > 65535
      || !smtpUser
      || !smtpPassword
      || !fromEmail
    ) {
      throw new Error('Email provider configuration is incomplete');
    }
    const { data: pdfBlob, error: downloadError } = await supabase.storage
      .from('estimate-pdfs')
      .download(document.storage_path);
    if (downloadError || !pdfBlob) throw downloadError;

    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const customerName = estimate.customers.company_name || estimate.customers.contact_name;
    const vesselName = estimate.vessels.vessel_name
      || [estimate.vessels.manufacturer, estimate.vessels.model].filter(Boolean).join(' ')
      || estimate.vessels.registration_number
      || 'your vessel';
    const total = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: estimate.currency,
    }).format(estimate.total_cents / 100);
    const fileName = `${estimate.estimate_number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;
    const serviceSummary = estimate.recommended_work
      || estimate.job_description
      || 'Marine electrical services';
    const subject = `Quote ${estimate.estimate_number} from Marine Consolidated Electronics`;
    const text = [
      `Hello ${customerName},`,
      '',
      `Thank you for the opportunity to provide quote ${estimate.estimate_number} for ${vesselName}.`,
      '',
      `Service summary: ${serviceSummary}`,
      `Quote total: ${total}.`,
      '',
      'The complete quote is attached as a PDF.',
      '',
      'Please reply to this email if you have any questions.',
      '',
      'Marine Consolidated Electronics',
    ].join('\n');
    const html = `
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>
        Thank you for the opportunity to provide quote
        <strong>${escapeHtml(estimate.estimate_number)}</strong>
        for ${escapeHtml(vesselName)}.
      </p>
      <p><strong>Service summary:</strong> ${escapeHtml(serviceSummary)}</p>
      <p><strong>Quote total:</strong> ${escapeHtml(total)}</p>
      <p>The complete quote is attached as a PDF.</p>
      <p>Please reply to this email if you have any questions.</p>
      <p>Marine Consolidated Electronics</p>
    `;

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
    const sendResult = await transporter.sendMail({
      from: {
        name: fromName,
        address: fromEmail,
      },
      to: recipientEmail,
      replyTo,
      subject,
      html,
      text,
      attachments: [{
        filename: fileName,
        content: Buffer.from(pdfBytes),
        contentType: 'application/pdf',
      }],
      headers: {
        'X-MarineQuote-Delivery-ID': deliveryId,
        'X-MarineQuote-Estimate': estimate.estimate_number,
      },
    });
    const providerMessageId = String(sendResult.messageId || '');
    if (!providerMessageId) throw new Error('SMTP provider did not return a message ID');

    const sentAt = new Date().toISOString();
    const { error: sentError } = await admin
      .from('estimate_deliveries')
      .update({
        status: 'sent',
        provider_message_id: providerMessageId,
        sent_at: sentAt,
        failed_at: null,
        error_message: null,
      })
      .eq('id', deliveryId);
    if (sentError) throw sentError;

    const { error: estimateUpdateError } = await admin
      .from('estimates')
      .update({
        status: 'sent',
        sent_at: sentAt,
        updated_by: userData.user.id,
      })
      .eq('id', estimate.id)
      .eq('current_version', document.version_number);
    if (estimateUpdateError) {
      console.error('Email sent but estimate status update failed', estimateUpdateError);
    }

    return jsonResponse({
      deliveryId,
      status: 'sent',
      recipientEmail,
      providerMessageId,
    }, 200, headers);
  } catch (error) {
    console.error('send-estimate-email failed:', safeErrorMessage(error));
    if (admin && deliveryId) {
      const { error: failedUpdateError } = await admin
        .from('estimate_deliveries')
        .update({
          status: 'failed',
          failed_at: new Date().toISOString(),
          sent_at: null,
          error_message: safeErrorMessage(error),
        })
        .eq('id', deliveryId);
      if (failedUpdateError) {
        console.error('Unable to record failed email delivery', failedUpdateError);
      }
    }
    return jsonResponse({
      deliveryId,
      status: deliveryId ? 'failed' : undefined,
      error: 'Unable to send the estimate email',
    }, 500, headers);
  }
});
