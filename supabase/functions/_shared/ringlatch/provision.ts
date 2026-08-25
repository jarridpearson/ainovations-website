/**
 * Zero-touch provisioning: a paid signup becomes a live, answering Ringlatch
 * line with no human involved — not the client's, not ours.
 *
 *   payment confirmed
 *     -> buy a number (client's own area code when available)
 *     -> attach it to the voice trunk and the messaging service
 *     -> register it with the voice backbone, bound to the agent
 *     -> create the client record with a working default profile
 *     -> send the client their number and forwarding steps
 *
 * Every step reports which step failed, because the ONLY acceptable manual
 * work is the exception path.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.109.0";

import { OPT_OUT } from "./notify.ts";
import { type PlanKey, PLANS } from "./limits.ts";
import { parseProfile } from "./profile.ts";

export interface PaidSignup {
  id: string;
  business_name: string;
  business_type: string;
  contact_name: string;
  owner_cell: string;
  email: string;
  forwarding_number: string;
  plan_key: string;
  sms_consent: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

export class ProvisionError extends Error {
  constructor(public step: string, detail: string) {
    super(`${step}: ${detail}`);
  }
}

function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "").slice(-10);

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40) || "client";

  return `${base}-${crypto.randomUUID().slice(0, 4)}`;
}

/** Rough mapping from the owner's own words to an urgency pack. */
function urgencyPack(businessType: string): string {
  const type = businessType.toLowerCase();

  if (/plumb|hvac|heat|electric|excavat|tree|roof|contract/.test(type)) {
    return "trades";
  }

  if (/dent|clinic|vet|medic|counsel|therap/.test(type)) {
    return "clinic";
  }

  if (/auto|repair shop|mechanic|tow/.test(type)) {
    return "auto";
  }

  if (/property|landlord|real estate|rental/.test(type)) {
    return "property";
  }

  if (/salon|barber|spa|law|account|appoint/.test(type)) {
    return "appointment";
  }

  return "general";
}

/**
 * A working day-one profile from nothing but the signup form. 24/7 coverage
 * and honest generic answers; owners refine it later without breaking it.
 */
export function buildDefaultProfile(
  signup: PaidSignup,
  ringlatchNumber: string,
): Record<string, unknown> {
  const allDay = { open: "00:00", close: "23:59" };

  return {
    slug: slugify(signup.business_name),
    business_name: signup.business_name,
    business_type: signup.business_type,
    timezone: "America/New_York",
    coverage_mode: "full_answering",
    phone: {
      main: signup.forwarding_number,
      ringlatch: ringlatchNumber,
      owner_cell: signup.owner_cell,
    },
    hours: {
      monday: allDay,
      tuesday: allDay,
      wednesday: allDay,
      thursday: allDay,
      friday: allDay,
      saturday: allDay,
      sunday: allDay,
    },
    services: [signup.business_type],
    service_area: ["United States"],
    pricing_notes: [],
    faqs: [],
    urgency: {
      enabled: true,
      packs: [urgencyPack(signup.business_type)],
      keywords: [],
      live_transfer: true,
      transfer_after_hours: false,
    },
    notify: {
      sms_to: signup.sms_consent ? [signup.owner_cell] : [],
      email_to: [signup.email],
    },
  };
}

function twilioAuth(): { sid: string; header: string } {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const token = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";

  return { sid, header: `Basic ${btoa(`${sid}:${token}`)}` };
}

/** Buy a voice+SMS number, preferring the client's own area code. */
async function buyNumber(signup: PaidSignup): Promise<string> {
  const { sid, header } = twilioAuth();
  const trunkSid = Deno.env.get("RINGLATCH_TRUNK_SID");

  if (!sid || !trunkSid) {
    throw new ProvisionError("buy-number", "telephony is not configured");
  }

  const areaCode = signup.forwarding_number.slice(2, 5);
  let candidate: string | null = null;

  for (const query of [`&AreaCode=${areaCode}`, ""]) {
    const search = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&VoiceEnabled=true&PageSize=1${query}`,
      { headers: { Authorization: header } },
    );
    const found = await search.json().catch(() => ({}));

    candidate = found?.available_phone_numbers?.[0]?.phone_number ?? null;

    if (candidate) {
      break;
    }
  }

  if (!candidate) {
    throw new ProvisionError("buy-number", "no numbers available");
  }

  const buy = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`,
    {
      method: "POST",
      headers: {
        Authorization: header,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        PhoneNumber: candidate,
        FriendlyName: `Ringlatch - ${signup.business_name}`.slice(0, 60),
        TrunkSid: trunkSid,
      }),
    },
  );
  const bought = await buy.json().catch(() => ({}));

  if (!buy.ok || !bought.phone_number) {
    throw new ProvisionError(
      "buy-number",
      bought?.message ?? `purchase failed (${buy.status})`,
    );
  }

  const messagingService = Deno.env.get("RINGLATCH_MESSAGING_SERVICE_SID");

  if (messagingService && bought.sid) {
    const attach = await fetch(
      `https://messaging.twilio.com/v1/Services/${messagingService}/PhoneNumbers`,
      {
        method: "POST",
        headers: {
          Authorization: header,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ PhoneNumberSid: bought.sid }),
      },
    );

    if (!attach.ok) {
      const detail = await attach.json().catch(() => ({}));

      throw new ProvisionError(
        "messaging-service",
        detail?.message ?? `attach failed (${attach.status})`,
      );
    }
  }

  return bought.phone_number;
}

/** Register the number with the voice backbone, bound to the shared agent. */
async function registerNumber(
  signup: PaidSignup,
  ringlatchNumber: string,
): Promise<void> {
  const key = Deno.env.get("RETELL_WEBHOOK_SECRET");
  const agentId = Deno.env.get("RINGLATCH_AGENT_ID");
  const sipPassword = Deno.env.get("RINGLATCH_SIP_PASSWORD");
  const terminationUri = Deno.env.get("RINGLATCH_TERMINATION_URI") ??
    "ringlatch.pstn.twilio.com";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!key || !agentId || !sipPassword || !supabaseUrl) {
    throw new ProvisionError("register-number", "backbone is not configured");
  }

  const response = await fetch("https://api.retellai.com/import-phone-number", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone_number: ringlatchNumber,
      termination_uri: terminationUri,
      sip_trunk_auth_username: "ringlatch",
      sip_trunk_auth_password: sipPassword,
      inbound_agents: [
        { agent_id: agentId, agent_version: "latest_published", weight: 1 },
      ],
      inbound_webhook_url: `${supabaseUrl}/functions/v1/ringlatch-inbound`,
      nickname: signup.business_name.slice(0, 60),
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));

    throw new ProvisionError(
      "register-number",
      detail?.error_message ?? detail?.message ?? `status ${response.status}`,
    );
  }
}

async function sendWelcomeEmail(signup: PaidSignup, ringlatchNumber: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RINGLATCH_EMAIL_FROM");

  if (!apiKey || !from) {
    return;
  }

  const pretty = formatPhone(ringlatchNumber);

  const text = [
    `${signup.contact_name.split(" ")[0]}, your Ringlatch line is live.`,
    "",
    `Your Ringlatch number: ${pretty}`,
    "",
    "One step left, from the business phone you told us about:",
    "",
    "Forward calls you can't answer to your Ringlatch number:",
    `  - Verizon cell: dial *71 then ${pretty.replace(/\D/g, "")}`,
    `  - AT&T or T-Mobile cell: dial **004*1${
      ringlatchNumber.replace(/\D/g, "").slice(-10)
    }#`,
    `  - Most landlines: dial *92 then ${pretty.replace(/\D/g, "")}`,
    "",
    "Then call your own business number and let it ring - Ringlatch should",
    "answer. Every call after that lands in your texts and email.",
    "",
    "To undo forwarding any time: *73 (Verizon), ##004# (AT&T/T-Mobile),",
    "*93 (landlines).",
    "",
    "Need anything? https://ainovations.net/ringlatch-help",
    "Manage billing or your plan any time: https://ainovations.net/ringlatch-account",
  ].join("\n");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [signup.email],
      subject: "Your Ringlatch number is live",
      text,
    }),
  }).catch((error) => console.error("ringlatch welcome email failed", error));
}

async function sendWelcomeSms(signup: PaidSignup, ringlatchNumber: string) {
  if (!signup.sms_consent) {
    return;
  }

  const { sid, header } = twilioAuth();
  const from = Deno.env.get("RINGLATCH_OPS_FROM") ?? "+13159076170";

  if (!sid) {
    return;
  }

  const body = `Ringlatch: you're live. Your Ringlatch number is ${
    formatPhone(ringlatchNumber)
  } and forwarding steps just landed in your email. ${OPT_OUT}`;

  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: header,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: signup.owner_cell,
        From: from,
        Body: body,
      }),
    },
  ).catch((error) => console.error("ringlatch welcome sms failed", error));
}

/**
 * Full teardown of a cancelled client's telephony. Idempotent: a number
 * that is already gone (either side) is treated as done.
 */
export async function releaseNumber(ringlatchNumber: string): Promise<void> {
  const key = Deno.env.get("RETELL_WEBHOOK_SECRET");

  if (key) {
    const response = await fetch(
      `https://api.retellai.com/delete-phone-number/${
        encodeURIComponent(ringlatchNumber)
      }`,
      { method: "DELETE", headers: { Authorization: `Bearer ${key}` } },
    ).catch(() => null);

    if (response && !response.ok && response.status !== 404) {
      const detail = await response.json().catch(() => ({}));

      throw new ProvisionError(
        "backbone-release",
        detail?.error_message ?? `status ${response.status}`,
      );
    }
  }

  const { sid, header } = twilioAuth();

  if (!sid) {
    return;
  }

  const lookup = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${
      encodeURIComponent(ringlatchNumber)
    }`,
    { headers: { Authorization: header } },
  );
  const owned = await lookup.json().catch(() => ({}));
  const numberSid = owned?.incoming_phone_numbers?.[0]?.sid ?? null;

  if (!numberSid) {
    return;
  }

  const release = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${numberSid}.json`,
    { method: "DELETE", headers: { Authorization: header } },
  );

  if (!release.ok && release.status !== 404) {
    throw new ProvisionError("number-release", `status ${release.status}`);
  }
}

/** Plain goodbye. States what happened; invents no policy. */
export async function sendGoodbyeEmail(
  email: string,
  businessName: string,
): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RINGLATCH_EMAIL_FROM");

  if (!apiKey || !from) {
    return;
  }

  const text = [
    `Your Ringlatch service for ${businessName} has ended.`,
    "",
    "Your Ringlatch number has been released and calls are no longer being",
    "answered. If you still have call forwarding turned on, dial your",
    "carrier's cancel code (*73 on Verizon, ##004# on AT&T/T-Mobile, *93 on",
    "most landlines) so calls ring your phone again.",
    "",
    "Want Ringlatch back later? Sign up again any time:",
    "https://ainovations.net/ringlatch-signup",
    "",
    "Questions: https://ainovations.net/ringlatch-help",
  ].join("\n");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Ringlatch service has ended",
      text,
    }),
  }).catch((error) => console.error("ringlatch goodbye email failed", error));
}

/**
 * The whole pipeline. Throws ProvisionError naming the failed step; the
 * caller records the failure and pages ops — that is the exception path,
 * never the normal one.
 */
export async function provisionSignup(
  admin: SupabaseClient,
  signup: PaidSignup,
): Promise<{ ringlatch_number: string; slug: string }> {
  const ringlatchNumber = await buyNumber(signup);

  await registerNumber(signup, ringlatchNumber);

  const profile = buildDefaultProfile(signup, ringlatchNumber);

  // Never store a profile the runtime would refuse to parse.
  parseProfile(profile);

  const plan = PLANS[signup.plan_key as PlanKey] ?? PLANS.standard;

  const { error: insertError } = await admin.from("ringlatch_clients").insert({
    slug: profile.slug,
    business_name: signup.business_name,
    profile,
    coverage_mode: "full_answering",
    plan_key: plan.key,
    status: "active",
    ringlatch_number: ringlatchNumber,
    owner_cell: signup.owner_cell,
    included_minutes: plan.included_minutes,
    forwarding_number: signup.forwarding_number,
    stripe_customer_id: signup.stripe_customer_id,
    stripe_subscription_id: signup.stripe_subscription_id,
    activated_at: new Date().toISOString(),
  });

  if (insertError) {
    throw new ProvisionError("client-record", insertError.message);
  }

  await sendWelcomeEmail(signup, ringlatchNumber);
  await sendWelcomeSms(signup, ringlatchNumber);

  return { ringlatch_number: ringlatchNumber, slug: String(profile.slug) };
}
