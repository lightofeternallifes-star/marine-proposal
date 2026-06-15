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
        id, estimate_number, current_version, currency, total_cents, validity_days,
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
    const estimatePreviewUrl =
      `https://marineconsolidatedelectronics.com/admin/estimate-preview.html?id=${encodeURIComponent(estimate.id)}`;
    const logoBytes = await Deno.readFile(new URL('./mce-logo.png', import.meta.url));
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
                            <a class="cta-link" href="${escapeHtml(estimatePreviewUrl)}"
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
