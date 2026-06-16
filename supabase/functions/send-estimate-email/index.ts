import nodemailer from 'nodemailer';
import { Buffer } from 'node:buffer';
import { createClient } from 'supabase';

const allowedOrigins = new Set([
  'https://marineconsolidatedelectronics.com',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);

const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const logoBase64 = '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';

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
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object'
      ? JSON.stringify(error)
      : String(error);
  return message.slice(0, 500);
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function createApprovalToken(admin: any, estimate: any, document: any, recipientEmail: string, userId: string) {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = base64Url(tokenBytes);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(
    Date.now() + Number(estimate.validity_days || 30) * 24 * 60 * 60 * 1000,
  ).toISOString();

  await admin
    .from('estimate_approval_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('estimate_id', estimate.id)
    .is('used_at', null)
    .is('revoked_at', null);

  const { error } = await admin
    .from('estimate_approval_tokens')
    .insert({
      estimate_id: estimate.id,
      document_id: document.id,
      token_hash: tokenHash,
      recipient_email: recipientEmail,
      expires_at: expiresAt,
      created_by: userId,
    });
  if (error) throw error;

  return token;
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
        id, estimate_number, customer_id, vessel_id, current_version, currency, total_cents, validity_days,
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
    const subject =
      `Quote ${estimate.estimate_number} - ${vesselName} | Marine Consolidated Electronics`;
    const serviceSummaryHtml = escapeHtml(serviceSummary).replace(/\n/g, '<br>');
    const approvalToken = await createApprovalToken(
      admin,
      estimate,
      document,
      recipientEmail,
      userData.user.id,
    );
    const estimateApprovalUrl =
      `https://marineconsolidatedelectronics.com/quote/approve.html?token=${encodeURIComponent(approvalToken)}`;
    const logoBytes = Uint8Array.from(atob(logoBase64), (character) => character.charCodeAt(0));
    const html = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>${escapeHtml(subject)}</title>
          <style>
            @media only screen and (max-width: 640px) {
              .email-shell { padding: 12px 8px !important; }
              .email-card { width: 100% !important; border-radius: 6px !important; }
              .email-header { padding: 18px 20px !important; }
              .email-body { padding: 24px 20px !important; }
              .brand-name { font-size: 14px !important; }
              .total-label { display: block !important; width: 100% !important; padding: 16px 18px 4px !important; }
              .total-value { display: block !important; width: 100% !important; padding: 0 18px 16px !important; text-align: left !important; }
              .cta-link { display: block !important; width: auto !important; }
              .footer-cell { padding: 18px 20px !important; }
            }
          </style>
        </head>
        <body style="margin:0;padding:0;background:#f3f6f8;color:#172331;font-family:Arial,Helvetica,sans-serif;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
            style="width:100%;background:#f3f6f8;">
            <tr>
              <td class="email-shell" align="center" style="padding:28px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                  class="email-card"
                  style="width:100%;max-width:620px;background:#ffffff;border:1px solid #d9e0e7;border-radius:10px;overflow:hidden;">
                  <tr>
                    <td class="email-header" style="padding:20px 32px;background:#071827;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td width="54" valign="middle" style="width:54px;padding-right:14px;">
                            <img src="cid:mce-logo" width="48" height="48"
                              alt="Marine Consolidated Electronics"
                              style="display:block;width:48px;height:48px;border:0;">
                          </td>
                          <td valign="middle">
                            <strong class="brand-name"
                              style="display:block;color:#ffffff;font-size:16px;line-height:1.25;letter-spacing:0.04em;">
                              MARINE CONSOLIDATED
                            </strong>
                            <span style="display:block;margin-top:3px;color:#D4AF37;font-size:10px;line-height:1.2;letter-spacing:0.22em;">
                              ELECTRONICS
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="email-body" style="padding:32px;font-size:15px;line-height:1.65;">
                      <p style="margin:0 0 18px;">Hello ${escapeHtml(customerName)},</p>
                      <p style="margin:0 0 18px;">
                        Thank you for the opportunity to provide this quote for your vessel,
                        <strong>${escapeHtml(vesselName)}</strong>.
                      </p>
                      <p style="margin:0 0 18px;">
                        We are pleased to provide the following estimate for your review.
                      </p>
                      <div style="margin:0 0 22px;padding:16px 18px;border-left:4px solid #d4af37;background:#f7f9fb;color:#26384a;">
                        ${serviceSummaryHtml}
                      </div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                        style="margin:0 0 22px;background:#071827;border:1px solid #D4AF37;border-radius:8px;box-shadow:0 8px 20px rgba(7,24,39,0.16);">
                        <tr>
                          <td class="total-label"
                            style="padding:18px 20px;color:#D4AF37;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">
                            Quote total
                          </td>
                          <td class="total-value" align="right"
                            style="padding:18px 20px;color:#ffffff;font-size:24px;font-weight:700;">
                            ${escapeHtml(total)}
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 18px;">
                        This estimate is valid for
                        <strong>${estimate.validity_days} days</strong>.
                        If you have any questions or would like to approve the work, simply reply
                        to this email and we will be happy to assist you.
                      </p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0"
                        style="margin:0 0 26px;">
                        <tr>
                          <td align="center" bgcolor="#D4AF37" style="border-radius:6px;">
                            <a class="cta-link" href="${escapeHtml(estimateApprovalUrl)}"
                              style="display:inline-block;padding:13px 24px;color:#071827;font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;">
                              Approve Estimate
                            </a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 24px;">Best regards,</p>

                      <table role="presentation" cellspacing="0" cellpadding="0" border="0"
                        style="border-top:1px solid #d9e0e7;">
                        <tr>
                          <td style="padding-top:20px;font-size:14px;line-height:1.7;color:#34495e;">
                            <strong style="display:block;color:#071827;font-size:16px;">Eduardo Casares</strong>
                            <span style="display:block;margin-bottom:6px;color:#526579;">Marine Consolidated Electronics</span>
                            <span style="display:block;">
                              &#128222;
                              <a href="tel:+17863572397" style="color:#173b56;text-decoration:none;">+1 (786) 357-2397</a>
                            </span>
                            <span style="display:block;">
                              &#127760;
                              <a href="https://marineconsolidatedelectronics.com"
                                style="color:#173b56;text-decoration:none;word-break:break-word;">marineconsolidatedelectronics.com</a>
                            </span>
                            <span style="display:block;">
                              &#128231;
                              <a href="mailto:eduardo.casares@marineconsolidatedelectronics.com"
                                style="color:#173b56;text-decoration:none;word-break:break-all;">eduardo.casares@marineconsolidatedelectronics.com</a>
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="footer-cell" align="center"
                      style="padding:18px 24px;background:#071827;color:#aebdca;font-size:11px;line-height:1.55;">
                      <strong style="display:block;color:#ffffff;font-size:12px;">Marine Consolidated Electronics</strong>
                      <span style="display:block;color:#D4AF37;">Licensed Marine Electrical &amp; Electronics Services</span>
                      <span style="display:block;margin-top:8px;">
                        This estimate is confidential and intended solely for the recipient.
                      </span>
                      <span style="display:block;margin-top:8px;color:#7f93a5;">
                        Quote ${escapeHtml(estimate.estimate_number)}
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
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
      attachments: [{
        filename: fileName,
        content: Buffer.from(pdfBytes),
        contentType: 'application/pdf',
      }, {
        filename: 'mce-logo.png',
        content: Buffer.from(logoBytes),
        contentType: 'image/png',
        cid: 'mce-logo',
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
      throw estimateUpdateError;
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
