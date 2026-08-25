/**
 * Self-serve billing door. The client proves ownership the same way as
 * add-a-business — account email plus the forwarded number on file — and
 * gets a hosted billing portal session: update card, see invoices, cancel.
 * Cancellation from there flows through the subscription webhook, which
 * tears the whole account down automatically. No humans anywhere.
 */

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.109.0";

import { parseProfile } from "../_shared/ringlatch/profile.ts";

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
      return jsonResponse({ error: "Not available right now" }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : null;
    const forwardingNumber = normalizeUsPhone(body.forwarding_number);

    if (!email || !forwardingNumber) {
      return jsonResponse(
        { error: "missing_fields", message: "Please fill in both fields." },
        400,
      );
    }

    const admin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: clients } = await admin
      .from("ringlatch_clients")
      .select("id, profile, status, forwarding_number, stripe_customer_id");

    let customerId: string | null = null;

    for (const row of clients ?? []) {
      if (row.status === "cancelled" || !row.stripe_customer_id) {
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
          customerId = row.stripe_customer_id;
          break;
        }
      } catch {
        // Can't match.
      }
    }

    if (!customerId) {
      return jsonResponse({
        error: "no_match",
        message:
          "We couldn't find an account with that email and business number.",
      }, 404);
    }

    const params = new URLSearchParams({
      customer: customerId,
      return_url: "https://ainovations.net/ringlatch",
    });
    const configuration = Deno.env.get("RINGLATCH_PORTAL_CONFIG");

    if (configuration) {
      params.set("configuration", configuration);
    }

    const response = await fetch(
      "https://api.stripe.com/v1/billing_portal/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    const session = await response.json().catch(() => ({}));

    if (!response.ok || !session.url) {
      console.error("ringlatch portal session failed", session?.error?.message);

      return jsonResponse({
        error: "portal_unavailable",
        message: "Billing is unavailable right now - try again in a minute.",
      }, 502);
    }

    return jsonResponse({ url: session.url });
  } catch (error) {
    console.error("ringlatch portal failed", error);

    return jsonResponse({
      error: "internal",
      message: "Something went wrong - try again in a minute.",
    }, 500);
  }
});
