// @ts-nocheck
/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_BATCH_SIZE = 100;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(
      { error: 'Supabase environment is not configured.' },
      500
    );
  }

  // This function is only ever meant to be triggered by the pg_cron job
  // (via net.http_post carrying the service role key), never by an app
  // user directly, so it requires the exact service role key rather than
  // just any valid JWT.
  const authorizationHeader = req.headers.get('Authorization') ?? '';

  if (authorizationHeader !== `Bearer ${supabaseServiceRoleKey}`) {
    return jsonResponse({ error: 'Unauthorized.' }, 401);
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

  const nowIso = new Date().toISOString();

  const { data: candidateDecisions, error: decisionsError } = await adminClient
    .from('decisions')
    .select('id, user_id, title, review_date')
    .not('review_date', 'is', null)
    .lte('review_date', nowIso)
    .is('reminder_sent_at', null);

  if (decisionsError) {
    return jsonResponse({ error: decisionsError.message }, 500);
  }

  const decisions = candidateDecisions ?? [];

  if (decisions.length === 0) {
    return jsonResponse({ processed: 0, sent: 0, skipped: 0 });
  }

  const decisionIds = decisions.map((decision) => decision.id);
  const userIds = Array.from(new Set(decisions.map((decision) => decision.user_id)));

  const { data: existingCheckins, error: checkinsError } = await adminClient
    .from('decision_calibration_checkins')
    .select('decision_id')
    .in('decision_id', decisionIds);

  if (checkinsError) {
    return jsonResponse({ error: checkinsError.message }, 500);
  }

  const checkedInDecisionIds = new Set(
    (existingCheckins ?? []).map((checkin) => checkin.decision_id)
  );

  const { data: preferencesData, error: preferencesError } = await adminClient
    .from('notification_preferences')
    .select('user_id, decision_review_reminders_enabled')
    .in('user_id', userIds);

  if (preferencesError) {
    return jsonResponse({ error: preferencesError.message }, 500);
  }

  const reminderEnabledByUserId = new Map<string, boolean>();

  (preferencesData ?? []).forEach((preference) => {
    reminderEnabledByUserId.set(
      preference.user_id,
      preference.decision_review_reminders_enabled !== false
    );
  });

  // No notification_preferences row for a user means reminders default on,
  // matching the column's own DEFAULT true.
  const eligibleDecisions = decisions.filter((decision) => {
    if (checkedInDecisionIds.has(decision.id)) {
      return false;
    }

    return reminderEnabledByUserId.get(decision.user_id) !== false;
  });

  if (eligibleDecisions.length === 0) {
    return jsonResponse({ processed: decisions.length, sent: 0, skipped: decisions.length });
  }

  const eligibleUserIds = Array.from(
    new Set(eligibleDecisions.map((decision) => decision.user_id))
  );

  const { data: tokenRows, error: tokenError } = await adminClient
    .from('user_push_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', eligibleUserIds);

  if (tokenError) {
    return jsonResponse({ error: tokenError.message }, 500);
  }

  const tokensByUserId = new Map<string, string[]>();

  (tokenRows ?? []).forEach((row) => {
    const existing = tokensByUserId.get(row.user_id) ?? [];
    existing.push(row.expo_push_token);
    tokensByUserId.set(row.user_id, existing);
  });

  type ExpoPushMessage = {
    to: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
  };

  const messages: ExpoPushMessage[] = [];
  const decisionIdsToMarkSent: string[] = [];

  for (const decision of eligibleDecisions) {
    const tokens = tokensByUserId.get(decision.user_id) ?? [];

    decisionIdsToMarkSent.push(decision.id);

    for (const token of tokens) {
      messages.push({
        to: token,
        title: 'Time to check in',
        body: `How did "${decision.title}" turn out?`,
        data: {
          everward_notification_type: 'decision_review_reminder',
          decision_id: decision.id,
        },
      });
    }
  }

  let sentCount = 0;

  for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH_SIZE) {
    const batch = messages.slice(i, i + EXPO_PUSH_BATCH_SIZE);

    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(batch),
      });

      if (response.ok) {
        sentCount += batch.length;
      } else {
        console.error('Expo push batch failed:', await response.text());
      }
    } catch (error) {
      console.error(
        'Expo push batch request failed:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // Mark every eligible decision as processed even if it had no push
  // token, so the job doesn't re-query it forever -- the open-loop queue
  // screen still surfaces it inside the app regardless of push delivery.
  const { error: markSentError } = await adminClient
    .from('decisions')
    .update({ reminder_sent_at: nowIso })
    .in('id', decisionIdsToMarkSent);

  if (markSentError) {
    console.error('Failed to mark decisions as reminded:', markSentError.message);
  }

  return jsonResponse({
    processed: decisions.length,
    eligible: eligibleDecisions.length,
    sent: sentCount,
    skipped: decisions.length - eligibleDecisions.length,
  });
});
