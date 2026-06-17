import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0';

const allowedOrigins = new Set([
  'https://marineconsolidatedelectronics.com',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);

const questions = [
  {
    key: 'customer_name',
    stage: 'NEW_LEAD',
    nextStage: 'LOCATION',
    question: `Hello 👋

My name is Natalie.

I am the virtual customer coordinator for Marine Consolidated Electronics.

May I have your name?`,
  },
  {
    key: 'location',
    stage: 'LOCATION',
    nextStage: 'VESSEL_INFO',
    question: 'Thank you.\n\nWhat marina, city, or country is the vessel currently located in?',
  },
  {
    key: 'vessel_type',
    stage: 'VESSEL_INFO',
    nextStage: 'VESSEL_INFO',
    question: `What type of vessel is it?

Examples:

- Yacht
- Sportfish
- Center Console
- Sailboat
- Catamaran
- Commercial Vessel`,
  },
  {
    key: 'manufacturer_model',
    stage: 'VESSEL_INFO',
    nextStage: 'PROBLEM_DESCRIPTION',
    question: `What is the manufacturer and model?

Example:

Sea Ray 420
Viking 58
Azimut 50`,
  },
  {
    key: 'problem_description',
    stage: 'PROBLEM_DESCRIPTION',
    nextStage: 'APPOINTMENT_REQUESTED',
    question: 'Briefly describe the electrical or electronic issue you are experiencing.',
  },
  {
    key: 'preferred_inspection_window',
    stage: 'APPOINTMENT_REQUESTED',
    nextStage: 'COMPLETED',
    question: `When would you like an inspection?

Morning
Afternoon
Evening`,
  },
] as const;

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin)
    ? origin
    : 'https://marineconsolidatedelectronics.com';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
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

function splitManufacturerModel(value: string) {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { manufacturer: value || null, model: null };
  }
  return {
    manufacturer: parts[0],
    model: parts.slice(1).join(' '),
  };
}

function questionIndexForKey(key: string | null) {
  const index = questions.findIndex((question) => question.key === key);
  return index >= 0 ? index : 0;
}

function qualificationStateForStage(stage: string) {
  const states: Record<string, string> = {
    NEW_LEAD: 'started',
    LOCATION: 'location_details_requested',
    VESSEL_INFO: 'vessel_type_requested',
    PROBLEM_DESCRIPTION: 'operability_requested',
    QUALIFIED: 'complete',
    APPOINTMENT_REQUESTED: 'appointment_requested',
    COMPLETED: 'complete',
  };
  return states[stage] || 'started';
}

async function getActiveProfile(client: any, userId: string) {
  const { data, error } = await client
    .from('profiles')
    .select('id, active')
    .eq('id', userId)
    .single();
  if (error || !data?.active) return null;
  return data;
}

async function createNatalieMessage(admin: any, conversation: any, body: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      lead_id: conversation.lead_id,
      customer_id: conversation.customer_id,
      direction: 'outbound',
      sender_type: 'natalie',
      channel: conversation.channel,
      body,
      structured_payload: payload,
      delivery_status: 'sent',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

async function createCustomerMessage(admin: any, conversation: any, body: string, key: string) {
  const { data, error } = await admin
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      lead_id: conversation.lead_id,
      customer_id: conversation.customer_id,
      direction: 'inbound',
      sender_type: 'customer',
      channel: conversation.channel,
      body,
      structured_payload: { intake_key: key },
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

async function loadConversation(admin: any, conversationId: string) {
  const { data, error } = await admin
    .from('conversations')
    .select(`
      *,
      leads(*),
      customers(contact_name, company_name, email, phone),
      vessels(vessel_name, vessel_type, location)
    `)
    .eq('id', conversationId)
    .single();
  if (error || !data) throw error || new Error('Conversation not found');
  return data;
}

async function startConversation(admin: any, body: any, userId: string) {
  const leadId = typeof body?.leadId === 'string' ? body.leadId : null;
  let lead: any = null;

  if (leadId) {
    const { data, error } = await admin
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();
    if (error || !data) throw error || new Error('Lead not found');
    lead = data;
  }

  const { data: conversation, error } = await admin
    .from('conversations')
    .insert({
      lead_id: lead?.id || null,
      customer_id: lead?.customer_id || null,
      vessel_id: lead?.vessel_id || null,
      pipeline_id: lead?.pipeline_id || null,
      channel: 'web',
      external_contact_id: lead?.phone || lead?.email || null,
      status: 'active',
      qualification_state: 'started',
      current_question_key: questions[0].key,
      assigned_to: userId,
      intake_stage: 'NEW_LEAD',
      intake_data: {
        source: 'natalie_admin_intake',
        lead_id: lead?.id || null,
      },
      qualification_summary: {
        source: 'natalie_admin_intake',
      },
    })
    .select('*')
    .single();
  if (error || !conversation) throw error || new Error('Unable to create conversation');

  await createNatalieMessage(admin, conversation, questions[0].question, {
    intake_key: questions[0].key,
    intake_stage: questions[0].stage,
  });

  return {
    conversationId: conversation.id,
    stage: conversation.intake_stage,
    nextQuestion: questions[0].question,
    completed: false,
  };
}

async function createAppointment(admin: any, conversation: any, intakeData: Record<string, string>) {
  if (!conversation.customer_id) {
    return null;
  }

  const { manufacturer, model } = splitManufacturerModel(intakeData.manufacturer_model || '');
  const { data, error } = await admin
    .from('appointments')
    .insert({
      lead_id: conversation.lead_id,
      customer_id: conversation.customer_id,
      vessel_id: conversation.vessel_id,
      pipeline_id: conversation.pipeline_id,
      conversation_id: conversation.id,
      requested_time_text: intakeData.preferred_inspection_window || null,
      timezone: 'America/New_York',
      location_type: null,
      marina_name: intakeData.location || null,
      city: null,
      state_province: null,
      country: null,
      status: 'requested',
      customer_name: intakeData.customer_name || conversation.customers?.contact_name || null,
      vessel_type: intakeData.vessel_type || conversation.vessels?.vessel_type || null,
      manufacturer,
      model,
      problem_description: intakeData.problem_description || null,
      preferred_inspection_window: intakeData.preferred_inspection_window || null,
      notes: 'Created automatically by Natalie intake engine.',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

async function advanceConversation(admin: any, body: any) {
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
  const answer = cleanText(body?.answer, 3000);
  if (!conversationId) {
    throw new Error('conversationId is required');
  }
  if (answer.length < 1) {
    throw new Error('Answer is required');
  }

  const conversation = await loadConversation(admin, conversationId);
  if (conversation.intake_stage === 'COMPLETED') {
    return {
      conversationId: conversation.id,
      stage: conversation.intake_stage,
      completed: true,
      message: 'This Natalie intake conversation is already complete.',
    };
  }

  const index = questionIndexForKey(conversation.current_question_key);
  const activeQuestion = questions[index];
  const intakeData = {
    ...(conversation.intake_data || {}),
    [activeQuestion.key]: answer,
  };

  await createCustomerMessage(admin, conversation, answer, activeQuestion.key);

  const nextQuestion = questions[index + 1];
  if (!nextQuestion) {
    const appointment = await createAppointment(admin, conversation, intakeData);
    const completionMessage = 'Thank you. I have collected the service details and requested inspection window. Marine Consolidated Electronics will review and follow up.';

    await admin
      .from('conversations')
      .update({
        status: 'qualified',
        qualification_state: 'complete',
        current_question_key: null,
        intake_stage: 'COMPLETED',
        intake_data: intakeData,
        qualification_summary: intakeData,
        completed_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);

    await createNatalieMessage(admin, { ...conversation, intake_stage: 'COMPLETED' }, completionMessage, {
      intake_stage: 'COMPLETED',
      appointment_id: appointment?.id || null,
    });

    return {
      conversationId: conversation.id,
      stage: 'COMPLETED',
      completed: true,
      appointmentId: appointment?.id || null,
      nextQuestion: completionMessage,
    };
  }

  const updatedStage = nextQuestion.stage;
  await admin
    .from('conversations')
    .update({
      status: updatedStage === 'APPOINTMENT_REQUESTED' ? 'appointment_requested' : 'active',
      qualification_state: qualificationStateForStage(updatedStage),
      current_question_key: nextQuestion.key,
      intake_stage: updatedStage,
      intake_data: intakeData,
      qualification_summary: intakeData,
    })
    .eq('id', conversation.id);

  await createNatalieMessage(admin, { ...conversation, intake_stage: updatedStage }, nextQuestion.question, {
    intake_key: nextQuestion.key,
    intake_stage: updatedStage,
  });

  return {
    conversationId: conversation.id,
    stage: updatedStage,
    completed: false,
    nextQuestion: nextQuestion.question,
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

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: 'Authentication required' }, 401, headers);
    }
    const profile = await getActiveProfile(supabase, userData.user.id);
    if (!profile) {
      return jsonResponse({ error: 'Account is not active' }, 403, headers);
    }

    const body = await request.json();
    const action = cleanText(body?.action, 40);
    let result;
    if (action === 'start') {
      result = await startConversation(admin, body, userData.user.id);
    } else if (action === 'answer') {
      result = await advanceConversation(admin, body);
    } else {
      return jsonResponse({ error: 'Unsupported Natalie intake action' }, 400, headers);
    }

    return jsonResponse({ ok: true, ...result }, 200, headers);
  } catch (error) {
    console.error('[natalie-intake]', error);
    const message = error instanceof Error ? error.message : 'Unable to process Natalie intake.';
    return jsonResponse({ error: message }, 500, headers);
  }
});
