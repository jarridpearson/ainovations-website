/**
 * Ringlatch billing webhook.
 *
 * Stripe calls this when a checkout completes — a new subscription (Standard
 * or Busy) or a one-time minute pack. Which product it was rides in on the
 * payment link's metadata, so no Stripe API round-trip is needed to route it.
 *
 *   - minute pack, matched to a client  -> credit the rollover balance,
 *     text the client a receipt, alert ops
 *   - minute pack, unmatched            -> alert ops to apply it by hand
 *   - subscription                      -> stamp billing ids on a matching
 *     client if one exists, alert ops to provision the new signup
 *
 * Every event is recorded once (unique on the Stripe event id), so retries
 * and replays are no-ops.
 */

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.109.0";

import { MINUTE_PACK, type PlanKey, PLANS } from "../_shared/ringlatch/limits.ts";
import { buildPackPurchasedSms } from "../_shared/ringlatch/notify.ts";
import { parseProfile } from "../_shared/ringlatch/profile.ts";
import {
  type PaidSignup,
  ProvisionError,
  provisionSignup,
  releaseNumber,
  sendGoodbyeEmail,
} from "../_shared/ringlatch/provision.ts";

declare const EdgeRuntime:
  | { waitUntil(promise: Promise<unknown>): void }
  | undefined;

const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stripe signs `${t}.${rawBody}` with the endpoint secret, HMAC-SHA256 hex,
 * delivered as `t=...,v1=...`. Constant-time compare, five-minute replay
 * window, and any of several v1 entries may match during secret rotation.
 */
async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) {
    return false;
  }

  const parts = new Map<string, string[]>();

  for (const piece of header.split(",")) {
    const [key, value] = piece.split("=", 2);

    if (!key || !value) {
      continue;
    }

    parts.set(key.trim(), [...(parts.get(key.trim()) ?? []), value.trim()]);
  }

  const timestamp = Number(parts.get("t")?.[0]);
  const candidates = parts.get("v1") ?? [];

  if (!Number.isFinite(timestamp) || candidates.length === 0) {
    return false;
  }

  if (
    Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_MAX_AGE_SECONDS
  ) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );

  const expected = Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  for (const candidate of candidates) {
    const provided = candidate.toLowerCase();

    if (provided.length !== expected.length) {
      continue;
    }

    let mismatch = 0;

    for (let index = 0; index < expected.length; index += 1) {
      mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
    }

    if (mismatch === 0) {
      return true;
    }
  }

  return false;
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
  ).catch((error) => console.error("ringlatch billing sms failed", error));
}

async function sendOpsEmail(subject: string, text: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RINGLATCH_EMAIL_FROM");
  const to = Deno.env.get("RINGLATCH_OPS_EMAIL") ?? "jp@ainovations.net";

  if (!apiKey || !from) {
    return;
  }

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  }).catch((error) => console.error("ringlatch billing email failed", error));
}

async function alertOps(subject: string, text: string) {
  const opsCell = Deno.env.get("RINGLATCH_OPS_CELL") ?? "+13152228853";
  const opsFrom = Deno.env.get("RINGLATCH_OPS_FROM") ?? "+13159076170";

  await sendSms(opsCell, opsFrom, `Ringlatch: ${subject}`);
  await sendOpsEmail(`Ringlatch — ${subject}`, text);
}

interface MatchedClient {
  id: string;
  profile: unknown;
  ringlatch_number: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

/** Match by Stripe customer first, then by the email the buyer typed. */
async function findClient(
  admin: SupabaseClient,
  customerId: string | null,
  email: string | null,
): Promise<MatchedClient | null> {
  const { data: clients } = await admin
    .from("ringlatch_clients")
    .select("id, profile, ringlatch_number, stripe_customer_id, stripe_subscription_id");

  if (!clients) {
    return null;
  }

  if (customerId) {
    const byCustomer = clients.find((row) =>
      row.stripe_customer_id === customerId
    );

    if (byCustomer) {
      return byCustomer;
    }
  }

  if (!email) {
    return null;
  }

  const wanted = email.trim().toLowerCase();

  for (const row of clients) {
    try {
      const profile = parseProfile(row.profile);

      if (
        profile.notify.email_to.some((address) =>
          address.trim().toLowerCase() === wanted
        )
      ) {
        return row;
      }
    } catch {
      // A malformed profile just can't match; never fail the webhook over it.
    }
  }

  return null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const webhookSecret = Deno.env.get("RINGLATCH_STRIPE_WEBHOOK_SECRET");

    if (!supabaseUrl || !serviceRoleKey || !webhookSecret) {
      return jsonResponse({ error: "Ringlatch billing is not configured" }, 500);
    }

    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!await verifyStripeSignature(rawBody, signature, webhookSecret)) {
      return jsonResponse({ error: "Invalid signature" }, 401);
    }

    const event = JSON.parse(rawBody);

    const HANDLED = [
      "checkout.session.completed",
      "customer.subscription.deleted",
      "customer.subscription.updated",
    ];

    if (!HANDLED.includes(event.type)) {
      return jsonResponse({ ignored: event.type });
    }

    const admin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Idempotency: the unique index on the event id makes retries no-ops.
    const { error: eventError } = await admin
      .from("ringlatch_billing_events")
      .insert({
        stripe_event_id: event.id,
        type: event.type,
        payload: event.data?.object ?? {},
      });

    if (eventError) {
      if (eventError.code === "23505") {
        // Packs rely on the event guard for idempotency, so replays stop
        // here. Signup provisioning has its own atomic claim, so a resent
        // event may flow through — that IS the retry path after a fix.
        const isSignupCheckout = event.type === "checkout.session.completed" &&
          typeof event.data?.object?.metadata?.signup_id === "string";

        if (!isSignupCheckout) {
          return jsonResponse({ ok: true, duplicate: true });
        }
      } else {
        throw eventError;
      }
    }

    // ---- Subscription ended: unwind EVERYTHING, no human involved.
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data?.object ?? {};
      const subscriptionId = typeof subscription.id === "string"
        ? subscription.id
        : null;

      if (!subscriptionId) {
        return jsonResponse({ ok: true, ignored: "no subscription id" });
      }

      // Atomic claim: only one invocation tears down, replays are no-ops.
      const { data: cancelled } = await admin
        .from("ringlatch_clients")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", subscriptionId)
        .neq("status", "cancelled")
        .select("id, business_name, profile, ringlatch_number, forwarding_number")
        .maybeSingle();

      if (!cancelled) {
        return jsonResponse({ ok: true, already: true });
      }

      let teardownError: string | null = null;

      if (cancelled.ringlatch_number) {
        try {
          await releaseNumber(cancelled.ringlatch_number);
        } catch (error) {
          teardownError = error instanceof Error
            ? error.message
            : String(error);
        }
      }

      // Free both numbers so the business can come back later. History
      // stays: calls, leads and the signup row keep their record.
      await admin
        .from("ringlatch_clients")
        .update({
          ringlatch_number: null,
          forwarding_number: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cancelled.id);

      await admin
        .from("ringlatch_signups")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subscriptionId)
        .in("status", ["paid", "provisioning", "provisioned", "failed"]);

      try {
        const profile = parseProfile(cancelled.profile);

        for (const address of profile.notify.email_to) {
          await sendGoodbyeEmail(address, cancelled.business_name);
        }
      } catch {
        // Goodbye is best-effort; the teardown already happened.
      }

      await alertOps(
        teardownError
          ? `cancelled WITH teardown error: ${cancelled.business_name}`
          : `cancelled: ${cancelled.business_name}`,
        teardownError
          ? `Subscription ${subscriptionId} ended and the account is closed, ` +
            `but releasing ${cancelled.ringlatch_number} hit: ` +
            `${teardownError}. Release it manually in the console.`
          : `Subscription ${subscriptionId} ended. Number released, account ` +
            `closed, goodbye email sent. Nothing to do.`,
      );

      return jsonResponse({ ok: true, cancelled: cancelled.id });
    }

    // ---- Cancellation scheduled: courtesy note, service runs to period end.
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data?.object ?? {};
      const flippedToCancel = subscription.cancel_at_period_end === true &&
        event.data?.previous_attributes?.cancel_at_period_end === false;

      if (!flippedToCancel || typeof subscription.id !== "string") {
        return jsonResponse({ ok: true, ignored: "not a new cancellation" });
      }

      const { data: client } = await admin
        .from("ringlatch_clients")
        .select("business_name, profile")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle();

      const until = typeof subscription.current_period_end === "number"
        ? new Date(subscription.current_period_end * 1000)
          .toLocaleDateString("en-US", { dateStyle: "long" })
        : null;

      if (client) {
        try {
          const profile = parseProfile(client.profile);
          const apiKey = Deno.env.get("RESEND_API_KEY");
          const from = Deno.env.get("RINGLATCH_EMAIL_FROM");

          if (apiKey && from && profile.notify.email_to.length > 0) {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from,
                to: profile.notify.email_to,
                subject: "Your Ringlatch cancellation is scheduled",
                text: [
                  `We've received your cancellation for ${client.business_name}.`,
                  "",
                  until
                    ? `Ringlatch keeps answering until ${until} — you've paid ` +
                      `through then. After that your number is released ` +
                      `automatically.`
                    : "Ringlatch keeps answering until the end of your paid " +
                      "period, then your number is released automatically.",
                  "",
                  "Changed your mind? Undo it any time before then:",
                  "https://ainovations.net/ringlatch-account",
                ].join("\n"),
              }),
            }).catch(() => {});
          }
        } catch {
          // Courtesy only.
        }
      }

      await alertOps(
        `cancellation scheduled: ${client?.business_name ?? subscription.id}`,
        `Runs to period end${until ? ` (${until})` : ""}, then tears down ` +
          `automatically. Nothing to do.`,
      );

      return jsonResponse({ ok: true, scheduled: true });
    }

    const session = event.data?.object ?? {};
    const kind: string = session.metadata?.ringlatch ?? "unknown";
    const email: string | null = session.customer_details?.email ?? null;
    const customerId: string | null = typeof session.customer === "string"
      ? session.customer
      : null;

    const client = await findClient(admin, customerId, email);

    // Remember the Stripe customer so later packs and refills match instantly.
    if (client && customerId && !client.stripe_customer_id) {
      await admin
        .from("ringlatch_clients")
        .update({ stripe_customer_id: customerId })
        .eq("id", client.id);
    }

    // The buy page's auto-refill checkbox routes through a payment link that
    // carries this flag; buying with it on is the opt-in.
    const wantsAutoRefill = session.metadata?.auto_refill === "true";

    if (kind === "pack") {
      if (client) {
        if (wantsAutoRefill) {
          await admin
            .from("ringlatch_clients")
            .update({ auto_refill: true })
            .eq("id", client.id);
        }

        const packSeconds = MINUTE_PACK.minutes * 60;

        const { data: newBalance, error: creditError } = await admin.rpc(
          "ringlatch_add_purchased_seconds",
          { target_client_id: client.id, add_seconds: packSeconds },
        );

        if (creditError) {
          // The customer paid. Never report success on a failed credit:
          // release the event guard so Stripe's retry can run this again.
          await admin
            .from("ringlatch_billing_events")
            .delete()
            .eq("stripe_event_id", event.id);

          throw creditError;
        }

        const { error: ledgerError } = await admin
          .from("ringlatch_minute_purchases")
          .insert({
          client_id: client.id,
          seconds: packSeconds,
          amount_cents: session.amount_total ?? MINUTE_PACK.price_cents,
          source: "purchase",
          stripe_payment_intent: typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
          stripe_event_id: event.id,
        });

        if (ledgerError && ledgerError.code !== "23505") {
          console.error("ringlatch: purchase ledger failed", ledgerError.message);
        }

        try {
          const profile = parseProfile(client.profile);
          const receipt = buildPackPurchasedSms(
            MINUTE_PACK.minutes,
            Math.floor(Number(newBalance ?? packSeconds) / 60),
          );

          for (const recipient of profile.notify.sms_to) {
            await sendSms(
              recipient,
              profile.phone.ringlatch,
              receipt,
            );
          }
        } catch {
          // Receipt is best-effort; the credit already landed.
        }

        await alertOps(
          `minute pack purchased (${email ?? "no email"})`,
          `A client bought a ${MINUTE_PACK.minutes}-minute pack.\n` +
            `Email: ${email ?? "unknown"}\nCredited automatically.`,
        );
      } else {
        await alertOps(
          `minute pack UNMATCHED (${email ?? "no email"})`,
          `A ${MINUTE_PACK.minutes}-minute pack was paid for but no client ` +
            `matched.\nEmail: ${email ?? "unknown"}\n` +
            `Apply it manually: update purchased_seconds for the right ` +
            `client and log a ringlatch_minute_purchases row.`,
        );
      }

      return jsonResponse({ ok: true, kind, matched: Boolean(client) });
    }

    if (kind === "standard" || kind === "busy") {
      const plan = PLANS[kind as PlanKey];
      const newSubscription = typeof session.subscription === "string"
        ? session.subscription
        : null;

      // Server-created checkouts carry the signup id; the gatekeeper already
      // enforced the hard rules before this payment could happen. Mark the
      // signup paid and hand ops everything needed to provision.
      const signupId = typeof session.metadata?.signup_id === "string"
        ? session.metadata.signup_id
        : null;

      if (signupId) {
        await admin
          .from("ringlatch_signups")
          .update({
            status: "paid",
            stripe_session_id: typeof session.id === "string"
              ? session.id
              : null,
            stripe_customer_id: customerId,
            stripe_subscription_id: newSubscription,
            updated_at: new Date().toISOString(),
          })
          .eq("id", signupId)
          .eq("status", "pending");

        // Atomic claim: exactly one invocation provisions, even on retries.
        const { data: claimed } = await admin
          .from("ringlatch_signups")
          .update({
            status: "provisioning",
            updated_at: new Date().toISOString(),
          })
          .eq("id", signupId)
          .eq("status", "paid")
          .select(
            "id, business_name, business_type, contact_name, owner_cell, email, forwarding_number, plan_key, sms_consent, stripe_customer_id, stripe_subscription_id",
          )
          .maybeSingle();

        if (claimed) {
          const provision = (async () => {
            try {
              const live = await provisionSignup(admin, claimed as PaidSignup);

              await admin
                .from("ringlatch_signups")
                .update({
                  status: "provisioned",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", claimed.id);

              await alertOps(
                `LIVE: ${claimed.business_name} (${plan.label})`,
                `Fully auto-provisioned — nothing to do.\n` +
                  `Business: ${claimed.business_name} (${claimed.business_type})\n` +
                  `Ringlatch number: ${live.ringlatch_number}\n` +
                  `Forwarding from: ${claimed.forwarding_number}\n` +
                  `Owner: ${claimed.contact_name} ${claimed.owner_cell}\n` +
                  `Welcome email${
                    claimed.sms_consent ? " and text" : ""
                  } sent with forwarding steps.`,
              );
            } catch (error) {
              const step = error instanceof ProvisionError
                ? error.step
                : "unknown";

              console.error("ringlatch provisioning failed", error);

              await admin
                .from("ringlatch_signups")
                .update({
                  status: "failed",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", claimed.id);

              await alertOps(
                `PROVISIONING FAILED at ${step} (${claimed.business_name})`,
                `Signup ${claimed.id} paid but provisioning failed at step ` +
                  `"${step}": ${
                    error instanceof Error ? error.message : String(error)
                  }\nFix the cause, then set the signup back to 'paid' and ` +
                  `resend the Stripe event to retry automatically.`,
              );
            }
          })();

          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
            EdgeRuntime.waitUntil(provision);
          } else {
            await provision;
          }
        }

        return jsonResponse({ ok: true, kind, signup: signupId });
      }

      // One account, one subscription. A second checkout from an already
      // subscribed client must never silently replace the tracked
      // subscription while Stripe bills both — that is a refund, not an
      // update, and a human decides which one dies.
      const duplicate = Boolean(
        client?.stripe_subscription_id &&
          newSubscription &&
          client.stripe_subscription_id !== newSubscription,
      );

      if (client && !duplicate) {
        await admin
          .from("ringlatch_clients")
          .update({
            plan_key: plan.key,
            included_minutes: plan.included_minutes,
            stripe_customer_id: customerId,
            stripe_subscription_id: newSubscription,
          })
          .eq("id", client.id);
      }

      await alertOps(
        duplicate
          ? `DUPLICATE subscription (${email ?? "no email"})`
          : `new ${plan.label} signup (${email ?? "no email"})`,
        duplicate
          ? `An already-subscribed client completed a second ${plan.label} ` +
            `checkout.\nEmail: ${email ?? "unknown"}\n` +
            `Existing: ${client?.stripe_subscription_id}\n` +
            `New: ${newSubscription}\n` +
            `Nothing was changed. Cancel and refund one of them in the ` +
            `Stripe dashboard.`
          : `Someone completed checkout for Ringlatch ${plan.label}.\n` +
            `Email: ${email ?? "unknown"}\n` +
            (client
              ? "Matched an existing client — billing ids stamped."
              : "No matching client yet — provision them: create the " +
                "client, assign a number, and send their forwarding " +
                "instructions."),
      );

      return jsonResponse({
        ok: true,
        kind,
        matched: Boolean(client),
        duplicate,
      });
    }

    await alertOps(
      `checkout with unknown product (${email ?? "no email"})`,
      "A checkout completed without Ringlatch metadata. Check the Stripe " +
        "dashboard and handle it manually.",
    );

    return jsonResponse({ ok: true, kind: "unknown" });
  } catch (error) {
    console.error("ringlatch billing webhook failed", error);

    // 500 so Stripe retries; the event-id guard makes retries safe.
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
