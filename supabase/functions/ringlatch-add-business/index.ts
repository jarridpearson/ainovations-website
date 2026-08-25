/**
 * Self-serve add-a-business.
 *
 * One forwarded number gets exactly one account — so an owner with several
 * businesses puts them all on that one account, and the agent asks callers
 * which business they need. This endpoint appends a business to an existing
 * account: the caller proves ownership by knowing both the account email and
 * the forwarded number on file, the profile is updated, and the owner's cell
 * gets a notice. The agent answers for the new business on the very next
 * call — no human in the loop.
 */

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.109.0";

import { buildBusinessAddedSms } from "../_shared/ringlatch/notify.ts";
import { parseProfile } from "../_shared/ringlatch/profile.ts";

const MAX_BUSINESSES = 5;

const CORS = {
  "Access-Control-Allow-Origin": "https://ainovations.net",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function normalizeUsPhone(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  let digits = raw.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  if (digits.length !== 10 || digits[0] === "0" || digits[0] === "1") {
    return null;
  }

  return `+1${digits}`;
}

function cleanString(raw: unknown, max = 200): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim().slice(0, max);

  return trimmed === "" ? null : trimmed;
}

async function sendSms(to: string, from: string, body: string) {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");

  if (!accountSid || !authToken) {
    return;
  }

  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    },
  ).catch((error) => console.error("ringlatch add-business sms failed", error));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Not available right now" }, 500);
    }

    const body = await request.json().catch(() => ({}));

    const email = cleanString(body.email)?.toLowerCase() ?? null;
    const forwardingNumber = normalizeUsPhone(body.forwarding_number);
    const businessName = cleanString(body.business_name, 80);
    const businessType = cleanString(body.business_type, 120);

    if (!email || !forwardingNumber || !businessName || !businessType) {
      return jsonResponse(
        { error: "missing_fields", message: "Please fill in every field." },
        400,
      );
    }

    const admin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: clients } = await admin
      .from("ringlatch_clients")
      .select("id, profile, status, forwarding_number");

    // Ownership = knowing both the account email AND the forwarded number on
    // file. One generic failure message, so nothing can be enumerated.
    let match: { id: string; profile: Record<string, unknown> } | null = null;

    for (const row of clients ?? []) {
      if (row.status === "cancelled") {
        continue;
      }

      try {
        const profile = parseProfile(row.profile);

        const emailMatches = profile.notify.email_to.some((address) =>
          address.trim().toLowerCase() === email
        );
        const numberMatches = row.forwarding_number === forwardingNumber ||
          normalizeUsPhone(profile.phone.main) === forwardingNumber;

        if (emailMatches && numberMatches) {
          match = {
            id: row.id,
            profile: row.profile as Record<string, unknown>,
          };
          break;
        }
      } catch {
        // A malformed profile can't match.
      }
    }

    if (!match) {
      return jsonResponse({
        error: "no_match",
        message:
          "We couldn't find an account with that email and business number.",
      }, 404);
    }

    const profile = parseProfile(match.profile);
    const existing = profile.businesses ?? [];
    const names = [
      profile.business_name.toLowerCase(),
      profile.spoken_name?.toLowerCase(),
      ...existing.map((b) => b.name.toLowerCase()),
    ].filter(Boolean);

    if (names.includes(businessName.toLowerCase())) {
      return jsonResponse({
        error: "duplicate_business",
        message: "That business is already on this line.",
      }, 409);
    }

    if (existing.length + 1 >= MAX_BUSINESSES) {
      return jsonResponse({
        error: "too_many",
        message:
          "This line already answers for the maximum number of businesses.",
      }, 409);
    }

    const updatedProfile = {
      ...match.profile,
      businesses: [
        ...existing,
        { name: businessName, business_type: businessType },
      ],
    };

    const { error: updateError } = await admin
      .from("ringlatch_clients")
      .update({ profile: updatedProfile, updated_at: new Date().toISOString() })
      .eq("id", match.id);

    if (updateError) {
      throw updateError;
    }

    // Tell the owner their line changed — this is also the tamper alarm if
    // someone else somehow knew both identifiers.
    const notice = buildBusinessAddedSms(businessName);

    for (const recipient of profile.notify.sms_to) {
      await sendSms(recipient, profile.phone.ringlatch, notice);
    }

    return jsonResponse({
      ok: true,
      businesses: existing.length + 2,
    });
  } catch (error) {
    console.error("ringlatch add-business failed", error);

    return jsonResponse({
      error: "internal",
      message: "Something went wrong - try again in a minute.",
    }, 500);
  }
});
