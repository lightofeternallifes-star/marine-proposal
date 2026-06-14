import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0';
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from 'https://esm.sh/pdf-lib@1.17.1';

const allowedOrigins = new Set([
  'https://marineconsolidatedelectronics.com',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);

type EstimateRecord = {
  id: string;
  estimate_number: string;
  current_version: number;
  job_description: string | null;
  recommended_work: string | null;
  customer_notes: string | null;
  currency: string;
  materials_subtotal_cents: number;
  labor_subtotal_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  tax_rate: number;
  tax_cents: number;
  total_cents: number;
  validity_days: number;
  customers: {
    contact_name: string;
    company_name: string | null;
    email: string | null;
    phone: string | null;
    billing_address: Record<string, string | null>;
  };
  vessels: {
    vessel_name: string | null;
    vessel_type: string | null;
    manufacturer: string | null;
    model: string | null;
    year: number | null;
    length_feet: number | null;
    registration_number: string | null;
    location: string | null;
  };
  estimate_materials: Array<{
    description: string;
    quantity: number;
    unit: string;
    unit_price_cents: number;
    markup_percent: number;
    line_total_cents: number;
    sort_order: number;
  }>;
  estimate_labor: Array<{
    description: string;
    hours: number;
    hourly_rate_cents: number;
    line_total_cents: number;
    sort_order: number;
  }>;
};

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

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function cleanFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

async function createEstimatePdf(estimate: EstimateRecord) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.02, 0.07, 0.12);
  const red = rgb(0.85, 0.18, 0.21);
  const gold = rgb(0.83, 0.69, 0.22);
  const gray = rgb(0.36, 0.42, 0.48);
  const light = rgb(0.93, 0.95, 0.97);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  let page!: PDFPage;
  let y!: number;
  let pageHasEstimateContent = false;

  const addPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    pageHasEstimateContent = false;
    page.drawRectangle({ x: 0, y: pageHeight - 24, width: pageWidth, height: 24, color: navy });
    page.drawText('MARINE CONSOLIDATED ELECTRONICS', {
      x: margin,
      y: pageHeight - 19,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    });
    page.drawText(estimate.estimate_number, {
      x: pageWidth - margin - bold.widthOfTextAtSize(estimate.estimate_number, 9),
      y: pageHeight - 19,
      size: 9,
      font: bold,
      color: gold,
    });
    y = pageHeight - 54;
  };

  const ensureSpace = (height: number) => {
    if (y - height < 54) addPage();
  };

  const drawHeading = (title: string) => {
    ensureSpace(34);
    pageHasEstimateContent = true;
    page.drawRectangle({ x: margin, y: y - 19, width: pageWidth - margin * 2, height: 25, color: navy });
    page.drawText(title.toUpperCase(), {
      x: margin + 10,
      y: y - 12,
      size: 10,
      font: bold,
      color: rgb(1, 1, 1),
    });
    y -= 34;
  };

  const drawParagraph = (text: string | null) => {
    if (!text) return;
    const lines = wrapText(text, regular, 10, pageWidth - margin * 2);
    ensureSpace(lines.length * 14 + 8);
    pageHasEstimateContent = true;
    for (const line of lines) {
      page.drawText(line, { x: margin, y, size: 10, font: regular, color: navy });
      y -= 14;
    }
    y -= 8;
  };

  const drawLabelValue = (label: string, value: string) => {
    ensureSpace(18);
    pageHasEstimateContent = true;
    page.drawText(label, { x: margin, y, size: 9, font: bold, color: gray });
    page.drawText(value || '-', { x: margin + 118, y, size: 9, font: regular, color: navy });
    y -= 16;
  };

  addPage();
  pageHasEstimateContent = true;
  page.drawText('ESTIMATE', { x: margin, y, size: 30, font: bold, color: red });
  page.drawText(`Generated ${new Date().toLocaleDateString('en-US')}`, {
    x: pageWidth - margin - 130,
    y: y + 5,
    size: 9,
    font: regular,
    color: gray,
  });
  y -= 42;

  drawHeading('Customer Information');
  drawLabelValue('Customer', estimate.customers.company_name || estimate.customers.contact_name);
  if (estimate.customers.company_name) drawLabelValue('Contact', estimate.customers.contact_name);
  drawLabelValue('Email', estimate.customers.email || '-');
  drawLabelValue('Phone', estimate.customers.phone || '-');

  drawHeading('Vessel Information');
  const vesselName = estimate.vessels.vessel_name
    || [estimate.vessels.manufacturer, estimate.vessels.model].filter(Boolean).join(' ')
    || estimate.vessels.registration_number
    || 'Vessel';
  drawLabelValue('Vessel', vesselName);
  drawLabelValue('Type', estimate.vessels.vessel_type || '-');
  drawLabelValue(
    'Manufacturer / Model',
    [estimate.vessels.manufacturer, estimate.vessels.model].filter(Boolean).join(' ') || '-',
  );
  drawLabelValue('Location', estimate.vessels.location || '-');

  drawHeading('Job Description');
  drawParagraph(estimate.job_description || 'No job description provided.');
  drawHeading('Recommended Work');
  drawParagraph(estimate.recommended_work || 'No recommended work provided.');

  const drawTableHeader = (columns: Array<{ label: string; x: number }>) => {
    ensureSpace(25);
    pageHasEstimateContent = true;
    page.drawRectangle({ x: margin, y: y - 7, width: pageWidth - margin * 2, height: 20, color: light });
    for (const column of columns) {
      page.drawText(column.label, { x: column.x, y, size: 8, font: bold, color: navy });
    }
    y -= 23;
  };

  drawHeading('Materials');
  drawTableHeader([
    { label: 'DESCRIPTION', x: margin + 4 },
    { label: 'QTY', x: 330 },
    { label: 'UNIT PRICE', x: 385 },
    { label: 'TOTAL', x: 495 },
  ]);
  for (const item of estimate.estimate_materials.sort((a, b) => a.sort_order - b.sort_order)) {
    ensureSpace(20);
    pageHasEstimateContent = true;
    const description = wrapText(item.description, regular, 8, 250)[0];
    page.drawText(description, { x: margin + 4, y, size: 8, font: regular, color: navy });
    page.drawText(`${item.quantity} ${item.unit}`, { x: 330, y, size: 8, font: regular, color: navy });
    page.drawText(formatMoney(item.unit_price_cents, estimate.currency), {
      x: 385, y, size: 8, font: regular, color: navy,
    });
    page.drawText(formatMoney(item.line_total_cents, estimate.currency), {
      x: 495, y, size: 8, font: regular, color: navy,
    });
    y -= 18;
  }

  drawHeading('Labor');
  drawTableHeader([
    { label: 'DESCRIPTION', x: margin + 4 },
    { label: 'HOURS', x: 360 },
    { label: 'RATE', x: 420 },
    { label: 'TOTAL', x: 495 },
  ]);
  for (const item of estimate.estimate_labor.sort((a, b) => a.sort_order - b.sort_order)) {
    ensureSpace(20);
    pageHasEstimateContent = true;
    const description = wrapText(item.description, regular, 8, 275)[0];
    page.drawText(description, { x: margin + 4, y, size: 8, font: regular, color: navy });
    page.drawText(String(item.hours), { x: 360, y, size: 8, font: regular, color: navy });
    page.drawText(formatMoney(item.hourly_rate_cents, estimate.currency), {
      x: 420, y, size: 8, font: regular, color: navy,
    });
    page.drawText(formatMoney(item.line_total_cents, estimate.currency), {
      x: 495, y, size: 8, font: regular, color: navy,
    });
    y -= 18;
  }

  const totalsHeight = 64;
  ensureSpace(totalsHeight);
  pageHasEstimateContent = true;
  y -= 8;
  const drawTotal = (
    label: string,
    cents: number,
    labelX: number,
    valueRightX: number,
    emphasized = false,
  ) => {
    page.drawText(label, {
      x: labelX,
      y,
      size: emphasized ? 12 : 9,
      font: emphasized ? bold : regular,
      color: emphasized ? red : gray,
    });
    const value = formatMoney(cents, estimate.currency);
    page.drawText(value, {
      x: valueRightX
        - (emphasized ? bold : regular).widthOfTextAtSize(value, emphasized ? 12 : 9),
      y,
      size: emphasized ? 12 : 9,
      font: emphasized ? bold : regular,
      color: emphasized ? red : navy,
    });
  };
  drawTotal('Materials', estimate.materials_subtotal_cents, margin, 248);
  drawTotal('Discount', -estimate.discount_cents, 330, pageWidth - margin);
  y -= 17;
  drawTotal('Labor', estimate.labor_subtotal_cents, margin, 248);
  drawTotal(`Tax (${estimate.tax_rate}%)`, estimate.tax_cents, 330, pageWidth - margin);
  y -= 17;
  drawTotal('Subtotal', estimate.subtotal_cents, margin, 248);
  drawTotal('ESTIMATE TOTAL', estimate.total_cents, 330, pageWidth - margin, true);
  y -= 22;

  if (estimate.customer_notes) {
    const noteLines = wrapText(estimate.customer_notes, regular, 10, pageWidth - margin * 2);
    ensureSpace(34 + noteLines.length * 14 + 8);
    drawHeading('Notes');
    drawParagraph(estimate.customer_notes);
  }

  if (!pageHasEstimateContent && pdf.getPageCount() > 1) {
    pdf.removePage(pdf.getPageCount() - 1);
    page = pdf.getPages().at(-1)!;
  }
  page.drawText(`This estimate is valid for ${estimate.validity_days} days from the generated date.`, {
    x: margin,
    y: 34,
    size: 8,
    font: regular,
    color: gray,
  });

  return pdf.save();
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
    const authorization = request.headers.get('authorization');
    if (!authorization) {
      return jsonResponse({ error: 'Authentication required' }, 401, headers);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) {
      throw new Error('Supabase runtime configuration is missing');
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
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
    if (!estimateId) {
      return jsonResponse({ error: 'estimateId is required' }, 400, headers);
    }

    const { data, error } = await supabase
      .from('estimates')
      .select(`
        *,
        customers(contact_name, company_name, email, phone, billing_address),
        vessels(vessel_name, vessel_type, manufacturer, model, year, length_feet, registration_number, location),
        estimate_materials(description, quantity, unit, unit_price_cents, markup_percent, line_total_cents, sort_order),
        estimate_labor(description, hours, hourly_rate_cents, line_total_cents, sort_order)
      `)
      .eq('id', estimateId)
      .single();
    if (error || !data) {
      return jsonResponse({ error: 'Estimate not found' }, 404, headers);
    }

    const estimate = data as unknown as EstimateRecord;
    if (estimate.current_version < 1) {
      return jsonResponse({ error: 'Save the estimate before generating a PDF' }, 409, headers);
    }

    const pdfBytes = await createEstimatePdf(estimate);
    const fileName = `${cleanFileName(estimate.estimate_number)}.pdf`;
    const storagePath = `${estimate.id}/v${estimate.current_version}/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from('estimate-pdfs')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { error: documentError } = await supabase
      .from('estimate_documents')
      .upsert({
        estimate_id: estimate.id,
        version_number: estimate.current_version,
        storage_path: storagePath,
        generated_by: userData.user.id,
      }, { onConflict: 'estimate_id,version_number' });
    if (documentError) throw documentError;

    const { error: updateError } = await supabase
      .from('estimates')
      .update({
        status: 'generated',
        generated_at: new Date().toISOString(),
        updated_by: userData.user.id,
      })
      .eq('id', estimate.id)
      .eq('current_version', estimate.current_version);
    if (updateError) throw updateError;

    const { data: signedData, error: signedError } = await supabase.storage
      .from('estimate-pdfs')
      .createSignedUrl(storagePath, 600);
    if (signedError) throw signedError;

    return jsonResponse({
      estimateNumber: estimate.estimate_number,
      version: estimate.current_version,
      signedUrl: signedData.signedUrl,
    }, 200, headers);
  } catch (error) {
    console.error('generate-estimate-pdf failed', error);
    return jsonResponse({ error: 'Unable to generate the estimate PDF' }, 500, headers);
  }
});
