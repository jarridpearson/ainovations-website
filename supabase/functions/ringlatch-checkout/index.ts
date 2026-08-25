/**
 * Ringlatch checkout gatekeeper.
 *
 * The signup form posts here, the hard rules run here, and only a signup that
 * passes them gets a Stripe Checkout session. Rules, in the owner's words:
 *
 *   - One forwarded business number = one account. EVER. A number that
 *     already has an account is blocked at the form and pointed at the
 *     add-a-business path instead — never a second account.
 *   - One account = one subscription. An existing subscriber cannot reach
 *     checkout again.
 *
 * Blocking happens BEFORE payment. Nothing here ever creates manual refund
 * work.
 */

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.109.0";

import { parseProfile } from "../_shared/ringlatch/profile.ts";

const PRICE_IDS: Record<string, string> = {
  standard: "price_1U7dEWDBB5irv1eW18VwV7MP",
  busy: "price_1U7dEYDBB5irv1eW50OqJ9rJ",
};

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

/** US numbers only for now: ten digits, optional leading 1, to E.164. */
export function normalizeUsPhone(raw: unknown): string | null {
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

interface OwnedNumbers {
  forwarding: Set<string>;
  ringlatch: Set<string>;
  subscribedEmails: Set<string>;
}

/** Every number and subscribed email the platform already accounts for. */
async function loadOwned(admin: SupabaseClient): Promise<OwnedNumbers> {
  const owned: OwnedNumbers = {
    forwarding: new Set(),
    ringlatch: new Set(),
    subscribedEmails: new Set(),
  };

  const { data: clients } = await admin
    .from("ringlatch_clients")
    .select(
      "profile, ringlatch_number, forwarding_number, stripe_subscription_id, status",
    );

  for (const row of clients ?? []) {
    if (row.status === "cancelled") {
      continue;
    }

    if (row.forwarding_number) {
      owned.forwarding.add(row.forwarding_number);
    }

    if (row.ringlatch_number) {
      owned.ringlatch.add(row.ringlatch_number);
    }

    try {
      const profile = parseProfile(row.profile);
      const main = normalizeUsPhone(profile.phone.main);

      if (main) {
        owned.forwarding.add(main);
      }

      if (row.stripe_subscription_id) {
        for (const address of profile.notify.email_to) {
          owned.subscribedEmails.add(address.trim().toLowerCase());
        }
      }
    } catch {
      // A malformed profile cannot widen or narrow the rules.
    }
  }

  const { data: paidSignups } = await admin
    .from("ringlatch_signups")
    .select("forwarding_number, email")
    .in("status", ["paid", "provisioning", "provisioned", "failed"]);

  for (const row of paidSignups ?? []) {
    if (row.forwarding_number) {
      owned.forwarding.add(row.forwarding_number);
    }

    if (row.email) {
      owned.subscribedEmails.add(String(row.email).trim().toLowerCase());
    }
  }

  return owned;
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
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !serviceRoleKey || !stripeKey) {
      return jsonResponse({ error: "Signup is not available right now" }, 500);
    }

    const body = await request.json().catch(() => ({}));

    const plan = body.plan === "busy" ? "busy" : "standard";
    const businessName = cleanString(body.business_name);
    const businessType = cleanString(body.business_type);
    const contactName = cleanString(body.contact_name);
    const email = cleanString(body.email)?.toLowerCase() ?? null;
    const ownerCell = normalizeUsPhone(body.mobile);
    const forwardingNumber = normalizeUsPhone(body.forwarding_number);
    const notes = cleanString(body.notes, 2000);
    const smsConsent = body.sms_consent === true;
    const consentText = cleanString(body.consent_text, 1000);

    if (!businessName || !businessType || !contactName || !email) {
      return jsonResponse(
        { error: "missing_fields", message: "Please fill in every field." },
        400,
      );
    }

    if (!ownerCell) {
      return jsonResponse({
        error: "bad_mobile",
        message: "That mobile number doesn't look right - use a US number.",
      }, 400);
    }

    if (!forwardingNumber) {
      return jsonResponse({
        error: "bad_forwarding",
        message:
          "That business number doesn't look right - use a US number.",
      }, 400);
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return jsonResponse(
        { error: "bad_email", message: "That email doesn't look right." },
        400,
      );
    }

    const admin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const owned = await loadOwned(admin);

    // THE rule: one forwarded number, one account, ever.
    if (
      owned.forwarding.has(forwardingNumber) ||
      owned.ringlatch.has(forwardingNumber)
    ) {
      return jsonResponse({
        error: "number_taken",
        message:
          "That business number already has a Ringlatch account. One " +
          "number, one account - but one account can answer for all your " +
          "businesses on that line.",
      }, 409);
    }

    // One account = one subscription.
    if (owned.subscribedEmails.has(email)) {
      return jsonResponse({
        error: "already_subscribed",
        message:
          "This email already has an active Ringlatch subscription. To put " +
          "another business on your existing line, add it to your account - " +
          "don't sign up twice.",
      }, 409);
    }

    // A newer attempt supersedes any unpaid one for the same number.
    await admin
      .from("ringlatch_signups")
      .update({ status: "abandoned", updated_at: new Date().toISOString() })
      .eq("forwarding_number", forwardingNumber)
      .eq("status", "pending");

    const { data: signup, error: signupError } = await admin
      .from("ringlatch_signups")
      .insert({
        business_name: businessName,
        business_type: businessType,
        contact_name: contactName,
        owner_cell: ownerCell,
        email,
        forwarding_number: forwardingNumber,
        plan_key: plan,
        notes,
        sms_consent: smsConsent,
        consent_text: smsConsent ? consentText : null,
        consent_ip: smsConsent
          ? (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            null)
          : null,
        consent_at: smsConsent ? new Date().toISOString() : null,
      })
      .select("id")
      .single();

    if (signupError) {
      throw signupError;
    }

    const session = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": PRICE_IDS[plan],
      "line_items[0][quantity]": "1",
      allow_promotion_codes: "true",
      customer_email: email,
      client_reference_id: signup.id,
      "metadata[ringlatch]": plan,
      "metadata[signup_id]": signup.id,
      "subscription_data[metadata][signup_id]": signup.id,
      success_url: "https://ainovations.net/ringlatch-welcome",
      cancel_url: "https://ainovations.net/ringlatch-signup",
    });

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `ringlatch-signup-${signup.id}`,
        },
        body: session,
      },
    );

    const checkout = await stripeResponse.json().catch(() => ({}));

    if (!stripeResponse.ok || !checkout.url) {
      console.error(
        "ringlatch checkout session failed",
        checkout?.error?.message,
      );

      return jsonResponse({
        error: "checkout_unavailable",
        message: "Checkout is unavailable right now - try again in a minute.",
      }, 502);
    }

    await admin
      .from("ringlatch_signups")
      .update({
        stripe_session_id: checkout.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", signup.id);

    return jsonResponse({ url: checkout.url });
  } catch (error) {
    console.error("ringlatch checkout failed", error);

    return jsonResponse({
      error: "internal",
      message: "Something went wrong - try again in a minute.",
    }, 500);
  }
});
