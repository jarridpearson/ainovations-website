// @ts-nocheck
/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type CheckinResult = 'yes' | 'partially' | 'no';

type CalibrationDirection = 'overconfident' | 'underconfident' | 'well_calibrated';

type CreditLedger = {
  id: string;
  effective_tier: string | null;
  monthly_allocation: number | null;
  addon_allocation: number | null;
  recurring_addon_allocation: number | null;
  one_time_top_up_balance: number | null;
  used_credits: number | null;
};

type SubscriptionSettings = {
  effective_tier: string | null;
  recurring_addon_allocation: number | null;
};

type CalibrationClassification = {
  calibration_direction: CalibrationDirection;
  category: string;
  reasoning: string;
  actual_outcome_summary: string;
};

const CHECKIN_CREDIT_COST = 1;

function getMonthlyAllocationForTier(tier: string | null) {
  if (tier === 'pro') {
    return 200;
  }

  if (tier === 'starter') {
    return 100;
  }

  return 20;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  const responseBody =
    status >= 400
      ? {
          ...(typeof body === 'object' && body !== null
            ? body
            : { error: String(body) }),
          status,
        }
      : body;

  return new Response(JSON.stringify(responseBody), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeTier(tier: string | null | undefined) {
  if (tier === 'starter' || tier === 'pro') {
    return tier;
  }

  return 'free';
}

function safeJsonParse(text: string): Partial<CalibrationClassification> | null {
  try {
    const parsed = JSON.parse(text);

    if (
      typeof parsed?.calibration_direction === 'string' &&
      typeof parsed?.reasoning === 'string'
    ) {
      return parsed as Partial<CalibrationClassification>;
    }

    return null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const openAiApiKey = Deno.env.get('OPENAI_API_KEY');
  const openAiModel = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(
      { error: 'Supabase environment is not configured.' },
      500
    );
  }

  if (!openAiApiKey) {
    return jsonResponse({ error: 'OPENAI_API_KEY is not configured.' }, 500);
  }

  const authorizationHeader = req.headers.get('Authorization') ?? '';

  if (!authorizationHeader) {
    return jsonResponse({ error: 'Missing authorization header.' }, 401);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authorizationHeader,
      },
    },
  });

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: 'Unauthorized.' }, 401);
  }

  let requestBody: {
    decisionId?: string;
    requestId?: string;
    result?: CheckinResult;
    riskNotes?: string;
    unexpectedNotes?: string;
  };

  try {
    requestBody = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  if (!requestBody.decisionId) {
    return jsonResponse({ error: 'Missing decisionId.' }, 400);
  }

  if (
    requestBody.result !== 'yes' &&
    requestBody.result !== 'partially' &&
    requestBody.result !== 'no'
  ) {
    return jsonResponse(
      { error: 'result must be "yes", "partially", or "no".' },
      400
    );
  }

  const requestId =
    typeof requestBody.requestId === 'string'
      ? requestBody.requestId.trim()
      : '';

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!requestId || !uuidPattern.test(requestId)) {
    return jsonResponse({ error: 'A valid request ID is required.' }, 400);
  }

  const riskNotes =
    typeof requestBody.riskNotes === 'string' ? requestBody.riskNotes.trim() : '';
  const unexpectedNotes =
    typeof requestBody.unexpectedNotes === 'string'
      ? requestBody.unexpectedNotes.trim()
      : '';

  const { data: decisionData, error: decisionError } = await adminClient
    .from('decisions')
    .select(
      'id, title, description, expected_outcome, risks_flagged, tradeoffs_accepted, review_date, priority_id, user_id'
    )
    .eq('id', requestBody.decisionId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (decisionError) {
    return jsonResponse({ error: decisionError.message }, 500);
  }

  if (!decisionData) {
    return jsonResponse({ error: 'Decision not found.' }, 404);
  }

  const { data: existingCheckin, error: existingCheckinError } = await adminClient
    .from('decision_calibration_checkins')
    .select('id')
    .eq('decision_id', decisionData.id)
    .maybeSingle();

  if (existingCheckinError) {
    return jsonResponse({ error: existingCheckinError.message }, 500);
  }

  if (existingCheckin) {
    return jsonResponse(
      { error: 'This decision already has a check-in.' },
      409
    );
  }

  const periodKey = new Date().toISOString().slice(0, 7);

  const { data: settingsData, error: settingsError } = await adminClient
    .from('user_subscription_settings')
    .select('effective_tier, recurring_addon_allocation')
    .eq('user_id', user.id)
    .maybeSingle();

  if (settingsError) {
    return jsonResponse({ error: settingsError.message }, 500);
  }

  let settings = settingsData as SubscriptionSettings | null;

  if (!settings) {
    const { data: previousLedgerData } = await adminClient
      .from('ai_credit_ledger')
      .select('effective_tier, recurring_addon_allocation')
      .eq('user_id', user.id)
      .order('period_key', { ascending: false })
      .limit(1)
      .maybeSingle();

    const fallbackTier = normalizeTier(previousLedgerData?.effective_tier);
    const fallbackRecurringAddon =
      fallbackTier === 'free'
        ? 0
        : previousLedgerData?.recurring_addon_allocation ?? 0;

    const { data: insertedSettings, error: insertSettingsError } =
      await adminClient
        .from('user_subscription_settings')
        .insert({
          user_id: user.id,
          effective_tier: fallbackTier,
          recurring_addon_allocation: fallbackRecurringAddon,
        })
        .select('effective_tier, recurring_addon_allocation')
        .single();

    if (insertSettingsError) {
      return jsonResponse({ error: insertSettingsError.message }, 500);
    }

    settings = insertedSettings as SubscriptionSettings;
  }

  const personalTier = normalizeTier(settings.effective_tier);
  const monthlyAllocation = getMonthlyAllocationForTier(personalTier);
  const recurringAddonAllocation =
    personalTier === 'free' ? 0 : settings.recurring_addon_allocation ?? 0;

  const { data: existingLedgerData, error: existingLedgerError } =
    await adminClient
      .from('ai_credit_ledger')
      .select(
        'id, effective_tier, monthly_allocation, addon_allocation, recurring_addon_allocation, one_time_top_up_balance, used_credits'
      )
      .eq('user_id', user.id)
      .eq('period_key', periodKey)
      .maybeSingle();

  if (existingLedgerError) {
    return jsonResponse({ error: existingLedgerError.message }, 500);
  }

  let ledger: CreditLedger;

  if (existingLedgerData?.id) {
    const { data: updatedLedgerData, error: updateLedgerError } =
      await adminClient
        .from('ai_credit_ledger')
        .update({
          effective_tier: personalTier,
          monthly_allocation: monthlyAllocation,
          recurring_addon_allocation: recurringAddonAllocation,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingLedgerData.id)
        .select(
          'id, effective_tier, monthly_allocation, addon_allocation, recurring_addon_allocation, one_time_top_up_balance, used_credits'
        )
        .single();

    if (updateLedgerError) {
      return jsonResponse({ error: updateLedgerError.message }, 500);
    }

    ledger = updatedLedgerData as CreditLedger;
  } else {
    const { data: insertedLedgerData, error: insertLedgerError } =
      await adminClient
        .from('ai_credit_ledger')
        .insert({
          user_id: user.id,
          period_key: periodKey,
          effective_tier: personalTier,
          monthly_allocation: monthlyAllocation,
          addon_allocation: 0,
          recurring_addon_allocation: recurringAddonAllocation,
          one_time_top_up_balance: 0,
          used_credits: 0,
        })
        .select(
          'id, effective_tier, monthly_allocation, addon_allocation, recurring_addon_allocation, one_time_top_up_balance, used_credits'
        )
        .single();

    if (insertLedgerError) {
      return jsonResponse({ error: insertLedgerError.message }, 500);
    }

    ledger = insertedLedgerData as CreditLedger;
  }

  type EffectiveCreditSummary = {
    credit_source?: 'organization' | 'personal';
    organization_id?: string | null;
    effective_tier?: string | null;
    available_credits?: number;
  };

  const { data: effectiveCreditRows, error: effectiveCreditError } =
    await userClient.rpc('get_effective_app_credit_summary');

  const effectiveCreditSummary =
    (Array.isArray(effectiveCreditRows)
      ? effectiveCreditRows[0]
      : effectiveCreditRows) as EffectiveCreditSummary | null;

  if (effectiveCreditError || !effectiveCreditSummary) {
    return jsonResponse(
      {
        error:
          effectiveCreditError?.message ||
          'The applicable app AI credit pool could not be loaded.',
      },
      402
    );
  }

  const usesOrganizationCredits =
    effectiveCreditSummary.credit_source === 'organization' &&
    Boolean(effectiveCreditSummary.organization_id);

  const effectiveOrganizationId = usesOrganizationCredits
    ? effectiveCreditSummary.organization_id ?? null
    : null;

  if (
    Number(effectiveCreditSummary.available_credits ?? 0) <
    CHECKIN_CREDIT_COST
  ) {
    return jsonResponse(
      {
        error: usesOrganizationCredits
          ? 'The organization shared app AI credit pool does not have the credit this check-in costs.'
          : `You need ${CHECKIN_CREDIT_COST} AI Credit for this check-in. Add credits or wait for your next monthly reset.`,
      },
      402
    );
  }

  const promptPayload = {
    app: 'Everward',
    decision: {
      title: decisionData.title,
      description: decisionData.description,
      expected_outcome: decisionData.expected_outcome,
      risks_flagged: decisionData.risks_flagged,
      tradeoffs_accepted: decisionData.tradeoffs_accepted,
      review_date: decisionData.review_date,
    },
    checkin_answers: {
      result: requestBody.result,
      risk_notes: riskNotes || null,
      unexpected_notes: unexpectedNotes || null,
    },
  };

  const systemPrompt = `
You are Everward's decision calibration engine.

Everward asks users to predict a decision's outcome when they make it, then
check in later on what actually happened. Your job is to classify how well
calibrated the user's original prediction was against the real outcome.

Rules:
- Use only the provided decision and check-in data.
- Do not invent facts, outcomes, or context not present in the data.
- Return valid JSON only.
- Write every sentence in plain, everyday English, speaking directly to the person -- use "you" and "your", never "the user" or third-person phrasing. No jargon. Write like a helpful friend, not a report.

Classification guidance:
- "overconfident": you expected a clearly better/more certain outcome than what actually happened (result is "no" or "partially" despite a confident expected_outcome, or a flagged risk materialized).
- "underconfident": the outcome (result "yes") turned out better or more certain than your expected_outcome or flagged risks suggested you anticipated.
- "well_calibrated": the actual result closely matches what you predicted and flagged, including when you correctly anticipated a partial or negative outcome.
- category: a short lowercase label for the kind of decision this was, inferred from the decision content -- for example "financial", "time_pressured", "deliberate", "relationship", "operational", "career", "health". Pick the single best-fitting label; do not invent a compound label.
- reasoning: one plain sentence, written directly to the person ("You expected X, but Y happened..."), explaining the calibration classification and referencing the specific prediction vs. outcome.
- actual_outcome_summary: one plain sentence, written directly to the person, summarizing what actually happened, written for later reference (this is stored as the decision's record of its real outcome).

Required JSON shape:
{
  "calibration_direction": "overconfident, underconfident, or well_calibrated",
  "category": "short lowercase category label",
  "reasoning": "one sentence",
  "actual_outcome_summary": "one sentence"
}
`.trim();

  const userPrompt = `
Classify this Everward decision check-in.

Data:
${JSON.stringify(promptPayload, null, 2)}
`.trim();

  type CreditReservationResult = {
    app_credits_available?: number;
    app_credits_used?: number;
    already_consumed?: boolean;
  };

  const creditMetadata = {
    analysis_type: 'decision_calibration_checkin',
    decision_id: decisionData.id,
    effective_tier: personalTier,
    credit_source: usesOrganizationCredits ? 'organization' : 'personal',
  };

  const { data: creditRows, error: creditReservationError } =
    usesOrganizationCredits
      ? await adminClient.rpc('consume_organization_app_credits', {
          p_organization_id: effectiveOrganizationId,
          p_user_id: user.id,
          p_credit_cost: CHECKIN_CREDIT_COST,
          p_request_id: requestId,
          p_event_type: 'organization_app_ai_credit_consumed',
          p_feature_key: 'decision_calibration_checkin',
          p_route: 'mobile_app',
          p_metadata: creditMetadata,
        })
      : await adminClient.rpc('consume_personal_app_credits', {
          p_user_id: user.id,
          p_credit_cost: CHECKIN_CREDIT_COST,
          p_request_id: requestId,
          p_event_type: 'personal_app_ai_credit_consumed',
          p_feature_key: 'decision_calibration_checkin',
          p_route: 'mobile_app',
          p_metadata: creditMetadata,
        });

  const creditResult =
    (Array.isArray(creditRows)
      ? creditRows[0]
      : creditRows) as CreditReservationResult | null;

  if (creditReservationError || !creditResult) {
    return jsonResponse(
      {
        error:
          creditReservationError?.message ||
          'The AI credit could not be reserved.',
      },
      402
    );
  }

  if (creditResult.already_consumed) {
    return jsonResponse(
      { error: 'This check-in request has already been processed.' },
      409
    );
  }

  let creditWasReserved = true;

  const refundReservedCredit = async (reason: string) => {
    if (!creditWasReserved) {
      return;
    }

    const { error: refundError } = usesOrganizationCredits
      ? await adminClient.rpc('refund_organization_app_credits', {
          p_organization_id: effectiveOrganizationId,
          p_user_id: user.id,
          p_credit_cost: CHECKIN_CREDIT_COST,
          p_request_id: requestId,
          p_event_type: 'organization_app_ai_credit_refunded',
          p_feature_key: 'decision_calibration_checkin',
          p_route: 'mobile_app',
          p_reason: reason,
          p_metadata: creditMetadata,
        })
      : await adminClient.rpc('refund_personal_app_credits', {
          p_user_id: user.id,
          p_credit_cost: CHECKIN_CREDIT_COST,
          p_request_id: requestId,
          p_event_type: 'personal_app_ai_credit_refunded',
          p_feature_key: 'decision_calibration_checkin',
          p_route: 'mobile_app',
          p_reason: reason,
          p_metadata: creditMetadata,
        });

    if (refundError) {
      console.error('Decision-checkin credit refund failed:', refundError.message);
      return;
    }

    creditWasReserved = false;
  };

  let openAiResponse: Response;

  try {
    openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openAiModel,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });
  } catch (error) {
    await refundReservedCredit('openai_request_failed');

    return jsonResponse(
      {
        error: 'OpenAI request failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      502
    );
  }

  if (!openAiResponse.ok) {
    const errorText = await openAiResponse.text();

    await refundReservedCredit('openai_response_failed');

    return jsonResponse({ error: 'OpenAI request failed.', detail: errorText }, 502);
  }

  let openAiJson: any;

  try {
    openAiJson = await openAiResponse.json();
  } catch {
    await refundReservedCredit('openai_invalid_response');

    return jsonResponse({ error: 'OpenAI returned an invalid response.' }, 502);
  }

  const aiText = openAiJson?.choices?.[0]?.message?.content ?? '';
  const parsedClassification = safeJsonParse(aiText);

  const validDirection =
    parsedClassification?.calibration_direction === 'overconfident' ||
    parsedClassification?.calibration_direction === 'underconfident' ||
    parsedClassification?.calibration_direction === 'well_calibrated'
      ? parsedClassification.calibration_direction
      : 'well_calibrated';

  const classification: CalibrationClassification = {
    calibration_direction: validDirection,
    category:
      typeof parsedClassification?.category === 'string' &&
      parsedClassification.category.trim()
        ? parsedClassification.category.trim().toLowerCase()
        : 'other',
    reasoning:
      typeof parsedClassification?.reasoning === 'string' &&
      parsedClassification.reasoning.trim()
        ? parsedClassification.reasoning.trim()
        : 'Classification generated from limited check-in detail.',
    actual_outcome_summary:
      typeof parsedClassification?.actual_outcome_summary === 'string' &&
      parsedClassification.actual_outcome_summary.trim()
        ? parsedClassification.actual_outcome_summary.trim()
        : unexpectedNotes || riskNotes || `Result: ${requestBody.result}.`,
  };

  const nowIso = new Date().toISOString();

  const { data: checkinData, error: checkinInsertError } = await adminClient
    .from('decision_calibration_checkins')
    .insert({
      decision_id: decisionData.id,
      user_id: user.id,
      result: requestBody.result,
      risk_notes: riskNotes || null,
      unexpected_notes: unexpectedNotes || null,
      ai_calibration_direction: classification.calibration_direction,
      ai_category: classification.category,
      ai_reasoning: classification.reasoning,
    })
    .select('id, result, ai_calibration_direction, ai_category, ai_reasoning, created_at')
    .single();

  if (checkinInsertError) {
    await refundReservedCredit('checkin_save_failed');

    return jsonResponse({ error: checkinInsertError.message }, 500);
  }

  const { error: decisionUpdateError } = await adminClient
    .from('decisions')
    .update({
      actual_outcome: classification.actual_outcome_summary,
      analyzed_at: nowIso,
      direction_label: classification.calibration_direction,
    })
    .eq('id', decisionData.id);

  if (decisionUpdateError) {
    console.error('Failed to update decision with checkin outcome:', decisionUpdateError.message);
  }

  creditWasReserved = false;

  return jsonResponse({
    requestId,
    checkin: checkinData,
    ledger: {
      ...ledger,
      used_credits: Number(
        creditResult.app_credits_used ?? (ledger.used_credits ?? 0) + CHECKIN_CREDIT_COST
      ),
    },
  });
});
