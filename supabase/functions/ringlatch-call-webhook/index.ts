/**
 * Ringlatch call webhook.
 *
 * Retell posts here when a call ends. This function is the entire post-call
 * pipeline: verify, look up the client by the number that was dialed, screen
 * spam, classify urgency, persist the call and lead, then fire the owner's SMS
 * and email. It must be idempotent — Retell retries on any non-2xx.
 */

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.109.0";

import {
  type ClientProfile,
  parseProfile,
} from "../_shared/ringlatch/profile.ts";
import { classifyUrgency, screenForSpam } from "../_shared/ringlatch/triage.ts";
import {
  billableSeconds,
  type CallMode,
  decideCallMode,
  MINUTE_PACK,
  type PlanKey,
  PLANS,
  purchasedDrawSeconds,
} from "../_shared/ringlatch/limits.ts";
import {
  buildAutoRefillFailedSms,
  buildAutoRefillSms,
  buildBalanceEmptySms,
  buildCallerTextBack,
  buildCapReachedSms,
  buildCapWarningSms,
  buildOwnerEmail,
  buildOwnerSms,
  buildPurchasedStartedSms,
  type CallOutcome,
  type CallRecord,
  type CapturedLead,
} from "../_shared/ringlatch/notify.ts";
import { verifySignature } from "../_shared/ringlatch/verify.ts";

type AdminClient = SupabaseClient;

type RetellCallPayload = {
  event?: string;
  call?: {
    call_id?: string;
    from_number?: string;
    to_number?: string;
    start_timestamp?: number;
    end_timestamp?: number;
    disconnection_reason?: string;
    transcript?: string;
    retell_llm_dynamic_variables?: Record<string, unknown>;
    transcript_object?: { role?: string; content?: string }[];
    recording_url?: string;
    public_log_url?: string;
    call_analysis?: {
      custom_analysis_data?: Record<string, unknown>;
    };
  };
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
    ? error
    : "The Ringlatch webhook could not be processed.";

  return message
    .replace(/key_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/SK[0-9a-f]{32}/g, "[redacted]")
    .replace(/re_[A-Za-z0-9_]+/g, "[redacted]")
    .slice(0, 1200);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === "" || trimmed.toLowerCase() === "unknown" ? null : trimmed;
}

/** Pulls the structured lead out of Retell's post-call analysis. */
function extractLead(payload: RetellCallPayload): CapturedLead {
  const data = payload.call?.call_analysis?.custom_analysis_data ?? {};

  return {
    caller_name: asString(data.caller_name),
    callback_number: asString(data.callback_number),
    town: asString(data.town),
    address: asString(data.service_address),
    job_description: asString(data.job_description),
    urgency_note: asString(data.urgency_note),
  };
}

/** Only what the caller said — the agent's own words must never be screened. */
function callerUtterances(payload: RetellCallPayload): string[] {
  const turns = payload.call?.transcript_object ?? [];

  return turns
    .filter((turn) => turn.role === "user")
    .map((turn) => (turn.content ?? "").trim())
    .filter(Boolean);
}

async function sendSms(
  to: string,
  from: string,
  body: string,
): Promise<{ ok: boolean; id: string | null; error: string | null }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");

  if (!accountSid || !authToken) {
    return { ok: false, id: null, error: "Twilio credentials are not set" };
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    },
  );

  const result = await response.json().catch(() => ({}));

  return response.ok
    ? { ok: true, id: result.sid ?? null, error: null }
    : { ok: false, id: null, error: sanitizeError(result.message) };
}

async function sendEmail(
  to: string[],
  subject: string,
  text: string,
): Promise<{ ok: boolean; id: string | null; error: string | null }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RINGLATCH_EMAIL_FROM");

  if (!apiKey || !from || to.length === 0) {
    return { ok: false, id: null, error: "Email is not configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });

  const result = await response.json().catch(() => ({}));

  return response.ok
    ? { ok: true, id: result.id ?? null, error: null }
    : { ok: false, id: null, error: sanitizeError(result.message) };
}

async function recordNotification(
  admin: AdminClient,
  row: Record<string, unknown>,
) {
  const { error } = await admin.from("ringlatch_notifications").insert(row);

  if (error) {
    console.error("ringlatch: notification log failed", error.message);
  }
}

/** Internal alert to the operator. Best-effort on both channels. */
async function opsAlert(subject: string, text: string) {
  const opsCell = Deno.env.get("RINGLATCH_OPS_CELL") ?? "+13152228853";
  const opsFrom = Deno.env.get("RINGLATCH_OPS_FROM") ?? "+13159076170";
  const opsEmail = Deno.env.get("RINGLATCH_OPS_EMAIL") ?? "jp@ainovations.net";

  await sendSms(opsCell, opsFrom, `Ringlatch ops: ${subject}`).catch(() => {});
  await sendEmail([opsEmail], `Ringlatch ops — ${subject}`, text)
    .catch(() => {});
}

/**
 * Buys one minute pack off-session against the client's saved card. Called
 * only the first time the combined balance hits zero in a period, and only
 * for clients who opted in. Never throws: a failed refill degrades to brief
 * mode, it must not break call processing.
 */
async function attemptAutoRefill(
  stripeCustomerId: string,
  idempotencyKey: string,
): Promise<
  { ok: boolean; payment_intent: string | null; error: string | null }
> {
  try {
    return await attemptAutoRefillInner(stripeCustomerId, idempotencyKey);
  } catch (error) {
    // Genuinely never throws: a network failure here must degrade to brief
    // mode, not break call processing. The idempotency key makes any retry
    // of an ambiguous charge safe.
    return {
      ok: false,
      payment_intent: null,
      error: sanitizeError(error),
    };
  }
}

async function attemptAutoRefillInner(
  stripeCustomerId: string,
  idempotencyKey: string,
): Promise<
  { ok: boolean; payment_intent: string | null; error: string | null }
> {
  const key = Deno.env.get("STRIPE_SECRET_KEY");

  if (!key) {
    return {
      ok: false,
      payment_intent: null,
      error: "Billing is not configured",
    };
  }

  const auth = { Authorization: `Bearer ${key}` };

  const customerResponse = await fetch(
    `https://api.stripe.com/v1/customers/${stripeCustomerId}`,
    { headers: auth },
  );
  const customer = await customerResponse.json().catch(() => ({}));

  let paymentMethod: string | null =
    customer?.invoice_settings?.default_payment_method ?? null;

  if (!paymentMethod) {
    const methodsResponse = await fetch(
      `https://api.stripe.com/v1/payment_methods?customer=${stripeCustomerId}&type=card&limit=1`,
      { headers: auth },
    );
    const methods = await methodsResponse.json().catch(() => ({}));

    paymentMethod = methods?.data?.[0]?.id ?? null;
  }

  if (!paymentMethod) {
    return {
      ok: false,
      payment_intent: null,
      error: "No saved payment method",
    };
  }

  const body = new URLSearchParams({
    amount: String(MINUTE_PACK.price_cents),
    currency: "usd",
    customer: stripeCustomerId,
    payment_method: paymentMethod,
    off_session: "true",
    confirm: "true",
    description: "Ringlatch minute pack (auto-refill)",
  });

  const intentResponse = await fetch(
    "https://api.stripe.com/v1/payment_intents",
    {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/x-www-form-urlencoded",
        // One refill per client per period: if the response is lost and the
        // charge is ever retried, Stripe returns the same intent instead of
        // charging twice.
        "Idempotency-Key": idempotencyKey,
      },
      body,
    },
  );
  const intent = await intentResponse.json().catch(() => ({}));

  if (intentResponse.ok && intent.status === "succeeded") {
    return { ok: true, payment_intent: intent.id, error: null };
  }

  return {
    ok: false,
    payment_intent: intent?.id ?? null,
    error: sanitizeError(
      intent?.error?.message ?? intent?.last_payment_error?.message ??
        "Charge failed",
    ),
  };
}

const ALERT_STAGES = ["none", "warn", "purchased", "empty", "closed"] as const;
type AlertStage = (typeof ALERT_STAGES)[number];

function stageRank(stage: string | null | undefined): number {
  const index = ALERT_STAGES.indexOf((stage ?? "none") as AlertStage);

  return index < 0 ? 0 : index;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const retellSecret = Deno.env.get("RETELL_WEBHOOK_SECRET");

    if (!supabaseUrl || !serviceRoleKey || !retellSecret) {
      return jsonResponse({ error: "Ringlatch is not configured" }, 500);
    }

    const rawBody = await request.text();
    const signature = request.headers.get("x-retell-signature");

    if (!await verifySignature(rawBody, signature, retellSecret)) {
      return jsonResponse({ error: "Invalid signature" }, 401);
    }

    const payload = JSON.parse(rawBody) as RetellCallPayload;

    // call_analyzed carries the structured lead; call_ended does not.
    if (payload.event && payload.event !== "call_analyzed") {
      return jsonResponse({ ignored: payload.event });
    }

    const call = payload.call ?? {};
    const providerCallId = asString(call.call_id);
    const toNumber = asString(call.to_number);
    const fromNumber = asString(call.from_number) ?? "unknown";

    if (!providerCallId || !toNumber) {
      return jsonResponse({ error: "Missing call_id or to_number" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Idempotency: Retell retries, and a duplicate must never re-text an owner.
    const { data: existing } = await admin
      .from("ringlatch_calls")
      .select("id")
      .eq("provider_call_id", providerCallId)
      .maybeSingle();

    if (existing) {
      return jsonResponse({ ok: true, duplicate: true });
    }

    const { data: clientRow, error: clientError } = await admin
      .from("ringlatch_clients")
      .select(
        "id, profile, status, plan_key, included_minutes, cap_alert_sent_for_period, cap_alert_stage, purchased_seconds, auto_refill, stripe_customer_id",
      )
      .eq("ringlatch_number", toNumber)
      .maybeSingle();

    if (clientError) {
      throw clientError;
    }

    if (!clientRow) {
      return jsonResponse(
        { error: "No Ringlatch client for that number" },
        404,
      );
    }

    let profile: ClientProfile;

    try {
      profile = parseProfile(clientRow.profile);
    } catch (error) {
      return jsonResponse({ error: sanitizeError(error) }, 422);
    }

    const startedAt = call.start_timestamp
      ? new Date(call.start_timestamp)
      : new Date();
    const endedAt = call.end_timestamp ? new Date(call.end_timestamp) : null;
    const durationSeconds = endedAt
      ? Math.max(
        0,
        Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
      )
      : 0;

    const utterances = callerUtterances(payload);
    const spam = screenForSpam(utterances.slice(0, 2));
    const urgency = classifyUrgency(profile, utterances.join(" "), startedAt);
    const lead = extractLead(payload);

    const hungUp = call.disconnection_reason === "user_hangup" &&
      !lead.callback_number;

    const outcome: CallOutcome = spam.is_spam
      ? "spam_screened"
      : hungUp
      ? "caller_hung_up"
      : "lead_captured";

    // The mode Retell ran this call in, set by the inbound webhook.
    const callMode =
      (call.retell_llm_dynamic_variables?.call_mode as CallMode | undefined) ??
        "full";

    // Screened spam never bills, and the per-call ceiling means one stuck or
    // looping call cannot eat a client's whole month.
    const billable = billableSeconds(durationSeconds, spam.is_spam, callMode);

    const { data: insertedCall, error: insertError } = await admin
      .from("ringlatch_calls")
      .insert({
        client_id: clientRow.id,
        provider_call_id: providerCallId,
        from_number: fromNumber,
        started_at: startedAt.toISOString(),
        ended_at: endedAt?.toISOString() ?? null,
        duration_seconds: durationSeconds,
        billable_seconds: billable,
        outcome,
        urgency_level: spam.is_spam ? "routine" : urgency.level,
        urgency_matched: spam.is_spam ? [] : urgency.matched,
        spam_screened: spam.is_spam,
        spam_reason: spam.reason,
        transcript: call.transcript ?? null,
        transcript_url: call.public_log_url ?? null,
        recording_url: call.recording_url ?? null,
      })
      .select("id")
      .single();

    if (insertError) {
      throw insertError;
    }

    const callId = insertedCall.id;

    // A screened robocall is the end of the line — never wake the owner for it.
    if (spam.is_spam) {
      return jsonResponse({ ok: true, outcome, spam_reason: spam.reason });
    }

    if (outcome === "lead_captured") {
      const { error: leadError } = await admin.from("ringlatch_leads").insert({
        client_id: clientRow.id,
        call_id: callId,
        caller_name: lead.caller_name,
        callback_number: lead.callback_number,
        town: lead.town,
        address: lead.address,
        job_description: lead.job_description,
        urgency_note: lead.urgency_note,
      });

      if (leadError) {
        throw leadError;
      }
    }

    const record: CallRecord = {
      client_slug: profile.slug,
      call_id: providerCallId,
      from_number: fromNumber,
      started_at: startedAt,
      duration_seconds: durationSeconds,
      outcome,
      lead,
      urgency,
      transcript_url: call.public_log_url ?? null,
    };

    const ownerSms = buildOwnerSms(profile, record);
    const ownerEmail = buildOwnerEmail(profile, record);
    const ringlatchNumber = profile.phone.ringlatch;

    let ownerSmsSent = false;

    for (const recipient of profile.notify.sms_to) {
      const result = await sendSms(recipient, ringlatchNumber, ownerSms);
      ownerSmsSent = ownerSmsSent || result.ok;

      await recordNotification(admin, {
        client_id: clientRow.id,
        call_id: callId,
        channel: "sms",
        purpose: "owner_alert",
        recipient,
        body: ownerSms,
        status: result.ok ? "sent" : "failed",
        provider_message_id: result.id,
        error_message: result.error,
        delivered_at: result.ok ? new Date().toISOString() : null,
      });
    }

    // The caller who gave up early is the whole reason this product exists.
    let textBackSent = false;

    // Caller text-backs message consumers who never opted in. That traffic is
    // Campaign B, which has not been filed or approved - so it is hard-gated
    // behind an env flag that stays unset until that campaign is live.
    // Sending it under Campaign A would misrepresent the registered use case.
    const textBackApproved =
      Deno.env.get("RINGLATCH_TEXT_BACK_APPROVED") === "true";

    const owesTextBack = textBackApproved &&
      (outcome === "caller_hung_up" || callMode === "closed");

    if (owesTextBack && fromNumber !== "unknown") {
      const result = await sendSms(
        fromNumber,
        ringlatchNumber,
        buildCallerTextBack(profile),
      );

      textBackSent = result.ok;

      await recordNotification(admin, {
        client_id: clientRow.id,
        call_id: callId,
        channel: "sms",
        purpose: "caller_text_back",
        recipient: fromNumber,
        body: buildCallerTextBack(profile),
        status: result.ok ? "sent" : "failed",
        provider_message_id: result.id,
        error_message: result.error,
        delivered_at: result.ok ? new Date().toISOString() : null,
      });
    }

    let ownerEmailSent = false;

    if (profile.notify.email_to.length > 0) {
      const result = await sendEmail(
        profile.notify.email_to,
        ownerEmail.subject,
        ownerEmail.text,
      );

      ownerEmailSent = result.ok;

      await recordNotification(admin, {
        client_id: clientRow.id,
        call_id: callId,
        channel: "email",
        purpose: "owner_summary",
        recipient: profile.notify.email_to.join(", "),
        body: ownerEmail.text,
        status: result.ok ? "sent" : "failed",
        provider_message_id: result.id,
        error_message: result.error,
        delivered_at: result.ok ? new Date().toISOString() : null,
      });
    }

    await admin
      .from("ringlatch_calls")
      .update({
        owner_sms_sent: ownerSmsSent,
        owner_email_sent: ownerEmailSent,
        text_back_sent: textBackSent,
      })
      .eq("id", callId);

    // ---- Minutes accounting: plan minutes first, then the purchased
    // rollover balance. Plan minutes reset each period; the balance persists.
    // The degrade ladder (brief/closed) is measured against PLAN usage only —
    // minutes a client paid for via packs must never push them toward closed.
    const period = new Date(
      Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), 1),
    ).toISOString().slice(0, 10);

    const plan = PLANS[clientRow.plan_key as PlanKey] ?? PLANS.standard;
    const included = clientRow.included_minutes ?? plan.included_minutes;

    const { data: usageRows } = await admin.rpc(
      "ringlatch_period_usage",
      { target_client_id: clientRow.id, period_start: period },
    );

    const usage = Array.isArray(usageRows) ? usageRows[0] : usageRows;
    const totalSeconds = Number(usage?.total_seconds ?? 0);
    const drawnBefore = Number(usage?.drawn_seconds ?? 0);

    // How much of THIS call spilled past the plan allowance (this call's own
    // drawn column is still zero, so total minus drawn is plan usage so far).
    const balanceBefore = Number(clientRow.purchased_seconds ?? 0);
    const spill = purchasedDrawSeconds(
      billable,
      totalSeconds - drawnBefore,
      included,
    );
    const draw = Math.min(spill, balanceBefore);

    let balanceSeconds = balanceBefore;

    if (draw > 0) {
      const { data: afterDraw, error: drawError } = await admin.rpc(
        "ringlatch_draw_purchased_seconds",
        { target_client_id: clientRow.id, draw_seconds: draw },
      );

      if (drawError) {
        console.error("ringlatch: balance draw failed", drawError.message);
      } else {
        balanceSeconds = Number(afterDraw ?? 0);

        await admin
          .from("ringlatch_calls")
          .update({ purchased_seconds_drawn: draw })
          .eq("id", callId);
      }
    }

    const planSeconds = Math.max(0, totalSeconds - drawnBefore - draw);
    const planMinutes = Math.ceil(planSeconds / 60);
    const balanceMinutes = Math.floor(balanceSeconds / 60);

    // Each alert fires once per period, in ladder order, never twice.
    const storedStage: string = clientRow.cap_alert_sent_for_period === period
      ? (clientRow.cap_alert_stage ?? "none")
      : "none";

    // Refill the moment plan and purchased minutes are both effectively gone,
    // before deciding what to tell the owner, so full answering resumes with
    // no human in the loop. The claim RPC is atomic: exactly one attempt per
    // period even with concurrent calls, and a failing card degrades to brief
    // mode instead of hammering the charge endpoint.
    let refillFailed = false;
    let refillSucceeded = false;

    const wouldDegrade = decideCallMode(
      { ...plan, included_minutes: included },
      planMinutes,
      balanceMinutes,
    ).mode !== "full";

    if (wouldDegrade && clientRow.auto_refill) {
      const { data: claimed } = await admin.rpc(
        "ringlatch_claim_refill",
        { target_client_id: clientRow.id, period_start: period },
      );

      if (claimed === true) {
        const refill = clientRow.stripe_customer_id
          ? await attemptAutoRefill(
            clientRow.stripe_customer_id,
            `ringlatch-refill-${clientRow.id}-${period}`,
          )
          : {
            ok: false,
            payment_intent: null,
            error: "No billing profile on file",
          };

        if (refill.ok) {
          const packSeconds = MINUTE_PACK.minutes * 60;

          const { data: afterAdd, error: creditError } = await admin.rpc(
            "ringlatch_add_purchased_seconds",
            { target_client_id: clientRow.id, add_seconds: packSeconds },
          );

          if (creditError) {
            // The card WAS charged. Never pretend the credit landed — get a
            // human on it and keep the client in degraded mode until fixed.
            console.error(
              "ringlatch: REFILL CHARGED BUT CREDIT FAILED",
              clientRow.id,
              refill.payment_intent,
              creditError.message,
            );
            await opsAlert(
              "auto-refill charged but credit FAILED",
              `Client ${clientRow.id} was charged (${refill.payment_intent}) ` +
                `but the balance credit failed: ${creditError.message}. ` +
                `Add ${packSeconds} purchased_seconds manually.`,
            );
            refillFailed = true;
          } else {
            refillSucceeded = true;
            balanceSeconds = Number(afterAdd ?? packSeconds);

            await admin.from("ringlatch_minute_purchases").insert({
              client_id: clientRow.id,
              seconds: packSeconds,
              amount_cents: MINUTE_PACK.price_cents,
              source: "auto_refill",
              stripe_payment_intent: refill.payment_intent,
            });

            const receipt = buildAutoRefillSms(
              MINUTE_PACK.minutes,
              MINUTE_PACK.price_cents,
            );

            for (const recipient of profile.notify.sms_to) {
              const result = await sendSms(recipient, ringlatchNumber, receipt);

              await recordNotification(admin, {
                client_id: clientRow.id,
                call_id: callId,
                channel: "sms",
                purpose: "auto_refill",
                recipient,
                body: receipt,
                status: result.ok ? "sent" : "failed",
                provider_message_id: result.id,
                error_message: result.error,
                delivered_at: result.ok ? new Date().toISOString() : null,
              });
            }
          }
        } else {
          console.error("ringlatch: auto-refill failed", refill.error);
          await opsAlert(
            "auto-refill charge failed",
            `Client ${clientRow.id}: ${refill.error ?? "charge failed"}. ` +
              `They are in name-and-number mode until they buy minutes.`,
          );
          refillFailed = true;
        }
      }
    }

    const decision = decideCallMode(
      { ...plan, included_minutes: included },
      planMinutes,
      Math.floor(balanceSeconds / 60),
    );

    const currentStage: AlertStage = decision.mode === "closed"
      ? "closed"
      : decision.mode === "brief"
      ? "empty"
      : planMinutes >= included
      ? "purchased"
      : decision.warn_owner
      ? "warn"
      : "none";

    if (stageRank(currentStage) > stageRank(storedStage)) {
      // A successful refill already produced its own receipt; announcing the
      // switch to purchased minutes on top of it would be noise.
      const suppress = refillSucceeded && currentStage === "purchased";

      if (!suppress) {
        const body = currentStage === "closed"
          ? buildCapReachedSms(included)
          : currentStage === "empty"
          ? (refillFailed ? buildAutoRefillFailedSms() : buildBalanceEmptySms())
          : currentStage === "purchased"
          ? buildPurchasedStartedSms(Math.floor(balanceSeconds / 60))
          : buildCapWarningSms(planMinutes, included);

        for (const recipient of profile.notify.sms_to) {
          const result = await sendSms(recipient, ringlatchNumber, body);

          await recordNotification(admin, {
            client_id: clientRow.id,
            call_id: callId,
            channel: "sms",
            purpose: "cap_warning",
            recipient,
            body,
            status: result.ok ? "sent" : "failed",
            provider_message_id: result.id,
            error_message: result.error,
            delivered_at: result.ok ? new Date().toISOString() : null,
          });
        }
      }

      await admin
        .from("ringlatch_clients")
        .update({
          cap_alert_sent_for_period: period,
          cap_alert_stage: currentStage,
        })
        .eq("id", clientRow.id);
    }

    return jsonResponse({
      ok: true,
      outcome,
      urgency: urgency.level,
      owner_sms_sent: ownerSmsSent,
      text_back_sent: textBackSent,
    });
  } catch (error) {
    console.error("ringlatch webhook failed", error);

    // 500 so Retell retries; the idempotency guard makes that safe.
    return jsonResponse({ error: sanitizeError(error) }, 500);
  }
});
