/**
 * Ringlatch inbound webhook.
 *
 * Retell calls this the moment a call arrives, before the agent speaks. It is
 * where the caps and the on/off switch actually take effect:
 *
 *   - paused                          -> one line, then hang up
 *   - plan gone, purchased balance    -> the full agent, on purchased minutes
 *   - plan 1.5x gone, no balance      -> one line, then hang up
 *   - plan gone, no balance           -> brief mode, name and number only
 *   - otherwise                       -> the full agent
 *
 * Anything that goes wrong here fails OPEN: a client whose usage we cannot read
 * gets the full agent. Losing a lead is worse than a few cents of minutes.
 */

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.109.0";

import { parseProfile } from "../_shared/ringlatch/profile.ts";
import {
  buildBriefPrompt,
  buildClosedPrompt,
  buildGreeting,
  buildSystemPrompt,
} from "../_shared/ringlatch/prompt.ts";
import {
  BRIEF_CALL_SECONDS_CAP,
  type CallMode,
  decideCallMode,
  PER_CALL_SECONDS_CAP,
  type PlanKey,
  PLANS,
} from "../_shared/ringlatch/limits.ts";
import { verifySignature } from "../_shared/ringlatch/verify.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Retell's expected inbound response. Dynamic variables are interpolated into
 * the agent at call time, which is what lets one agent serve every client.
 */
function retellResponse(vars: Record<string, string>) {
  return jsonResponse({ call_inbound: { dynamic_variables: vars } });
}

/** First day of the client's current billing period. */
function periodStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function promptFor(
  mode: CallMode,
  profile: ReturnType<typeof parseProfile>,
): string {
  switch (mode) {
    case "brief":
      return buildBriefPrompt(profile);
    case "closed":
      return buildClosedPrompt(profile);
    default:
      return buildSystemPrompt(profile);
  }
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

    // This response contains the client's config, including the owner's
    // personal cell. Only the signed voice backbone may have it — fail-open
    // applies to usage lookups below, never to authentication.
    const rawBody = await request.text();
    const signature = request.headers.get("x-retell-signature");

    if (!await verifySignature(rawBody, signature, retellSecret)) {
      return jsonResponse({ error: "Invalid signature" }, 401);
    }

    const payload = JSON.parse(rawBody);
    const inbound = payload?.call_inbound ?? payload ?? {};
    const toNumber: string | undefined = inbound.to_number;

    if (!toNumber) {
      return jsonResponse({ error: "Missing to_number" }, 400);
    }

    const admin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: client } = await admin
      .from("ringlatch_clients")
      .select(
        "id, profile, status, plan_key, included_minutes, purchased_seconds",
      )
      .eq("ringlatch_number", toNumber)
      .maybeSingle();

    if (!client) {
      return jsonResponse(
        { error: "No Ringlatch client for that number" },
        404,
      );
    }

    const profile = parseProfile(client.profile);

    // The portal switch. Paused means paused — say one line and stop.
    if (client.status === "paused" || client.status === "cancelled") {
      return retellResponse({
        business_name: profile.business_name,
        greeting:
          `Thanks for calling ${profile.business_name}. Please leave a message or try again later.`,
        agent_prompt: buildClosedPrompt(profile),
        call_mode: "closed",
        max_call_seconds: "20",
      });
    }

    const plan = PLANS[client.plan_key as PlanKey] ?? PLANS.standard;

    // Included minutes can be overridden per client; the caps scale with it.
    const effectivePlan = {
      ...plan,
      included_minutes: client.included_minutes ?? plan.included_minutes,
    };

    const { data: usageRows, error: usageError } = await admin.rpc(
      "ringlatch_period_usage",
      {
        target_client_id: client.id,
        period_start: periodStart(new Date()),
      },
    );

    // Fail open: if usage is unreadable, give them the full agent.
    if (usageError) {
      console.error("ringlatch: usage lookup failed", usageError.message);
    }

    // The ladder runs on PLAN usage only: minutes served from purchased packs
    // never count toward brief/closed. Packs are a rollover balance drawn
    // only after plan minutes.
    const usage = Array.isArray(usageRows) ? usageRows[0] : usageRows;
    const planSeconds = Math.max(
      0,
      Number(usage?.total_seconds ?? 0) - Number(usage?.drawn_seconds ?? 0),
    );

    const decision = decideCallMode(
      effectivePlan,
      usageError ? 0 : Math.ceil(planSeconds / 60),
      Math.floor((client.purchased_seconds ?? 0) / 60),
    );

    return retellResponse({
      business_name: profile.business_name,
      greeting: decision.mode === "full"
        ? buildGreeting(profile)
        : `Thanks for calling ${profile.business_name}.`,
      agent_prompt: promptFor(decision.mode, profile),
      call_mode: decision.mode,
      max_call_seconds: String(
        decision.mode === "brief"
          ? BRIEF_CALL_SECONDS_CAP
          : decision.mode === "closed"
          ? 20
          : PER_CALL_SECONDS_CAP,
      ),
      owner_cell: profile.phone.owner_cell,
      transfer_allowed: String(
        decision.mode === "full" && profile.urgency.live_transfer,
      ),
    });
  } catch (error) {
    console.error("ringlatch inbound failed", error);

    // Never drop a call because of our own error.
    return jsonResponse({ call_inbound: { dynamic_variables: {} } });
  }
});
