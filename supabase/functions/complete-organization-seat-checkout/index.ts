import Stripe from "npm:stripe@18.2.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const PORTAL_URL = "https://everward.ainovations.net";

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    },
  });
}

function getStripeId(
  value:
    | string
    | {
        id?: string;
      }
    | null
    | undefined,
) {
  if (typeof value === "string") {
    return value;
  }

  return value?.id ?? null;
}

function portalRedirect(
  parameters: Record<string, string>,
) {
  const url = new URL(PORTAL_URL);

  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }

  return Response.redirect(url.toString(), 303);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const requestUrl = new URL(request.url);
  const sessionId = requestUrl.searchParams.get("session_id");
  const returnJson =
    requestUrl.searchParams.get("format") === "json";

  try {
    if (!sessionId) {
      throw new Error(
        "Stripe Checkout did not return a session ID.",
      );
    }

    const stripeSecretKey =
      Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (
      !stripeSecretKey ||
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      throw new Error(
        "Required server configuration is missing.",
      );
    }

    const stripe = new Stripe(stripeSecretKey);
    const adminClient = createClient(
      supabaseUrl,
      serviceRoleKey,
    );

    const checkoutSession =
      await stripe.checkout.sessions.retrieve(
        sessionId,
      );

    if (checkoutSession.status !== "complete") {
      throw new Error(
        `Stripe Checkout status is ${checkoutSession.status ?? "unknown"}, not complete.`,
      );
    }

    if (checkoutSession.payment_status !== "paid") {
      throw new Error(
        `Stripe Checkout payment status is ${checkoutSession.payment_status ?? "unknown"}, not paid.`,
      );
    }

    const metadata = checkoutSession.metadata ?? {};

    if (
      metadata.action !==
      "organization_seat_increase"
    ) {
      throw new Error(
        "This Checkout Session is not an organization seat increase.",
      );
    }

    const organizationId =
      metadata.organization_id ?? "";
    const subscriptionId =
      metadata.subscription_id ?? "";
    const subscriptionItemId =
      metadata.subscription_item_id ?? "";
    const targetSeatQuantity = Number(
      metadata.target_seat_quantity,
    );

    if (!organizationId) {
      throw new Error(
        "Checkout metadata is missing the organization ID.",
      );
    }

    if (!subscriptionId) {
      throw new Error(
        "Checkout metadata is missing the subscription ID.",
      );
    }

    if (!subscriptionItemId) {
      throw new Error(
        "Checkout metadata is missing the subscription item ID.",
      );
    }

    if (
      !Number.isInteger(targetSeatQuantity) ||
      targetSeatQuantity < 1
    ) {
      throw new Error(
        "Checkout metadata contains an invalid target seat quantity.",
      );
    }

    const {
      data: organization,
      error: organizationLookupError,
    } = await adminClient
      .from("organizations")
      .select(
        [
          "id",
          "stripe_customer_id",
          "stripe_subscription_id",
          "paid_seat_count",
          "subscription_status",
        ].join(","),
      )
      .eq("id", organizationId)
      .single();

    if (organizationLookupError) {
      throw new Error(
        `Organization lookup failed: ${organizationLookupError.message}`,
      );
    }

    if (!organization) {
      throw new Error(
        "The organization could not be found.",
      );
    }

    if (
      organization.stripe_subscription_id &&
      organization.stripe_subscription_id !==
        subscriptionId
    ) {
      throw new Error(
        "The Checkout subscription does not match the organization subscription.",
      );
    }

    const checkoutCustomerId = getStripeId(
      checkoutSession.customer,
    );

    if (
      !checkoutCustomerId ||
      checkoutCustomerId !==
        organization.stripe_customer_id
    ) {
      throw new Error(
        "The Checkout customer does not match the organization customer.",
      );
    }

    const subscription =
      await stripe.subscriptions.retrieve(
        subscriptionId,
      );

    const subscriptionCustomerId = getStripeId(
      subscription.customer,
    );

    if (
      subscriptionCustomerId !==
      organization.stripe_customer_id
    ) {
      throw new Error(
        "The Stripe subscription customer does not match the organization.",
      );
    }

    const seatItem =
      subscription.items.data.find(
        (item) =>
          item.id === subscriptionItemId,
      );

    if (!seatItem) {
      throw new Error(
        "The organization seat subscription item could not be found.",
      );
    }

    const quantityBefore = Number(
      seatItem.quantity ?? 0,
    );

    if (
      quantityBefore !== targetSeatQuantity
    ) {
      await stripe.subscriptionItems.update(
        subscriptionItemId,
        {
          quantity: targetSeatQuantity,
          proration_behavior: "none",
          metadata: {
            organization_id: organizationId,
            checkout_session_id:
              checkoutSession.id,
            seat_checkout_applied: "true",
          },
        },
      );
    }

    const verifiedSubscription =
      await stripe.subscriptions.retrieve(
        subscriptionId,
      );

    const verifiedSeatItem =
      verifiedSubscription.items.data.find(
        (item) =>
          item.id === subscriptionItemId,
      );

    const verifiedStripeQuantity = Number(
      verifiedSeatItem?.quantity ?? 0,
    );

    if (
      verifiedStripeQuantity !==
      targetSeatQuantity
    ) {
      throw new Error(
        `Stripe seat verification failed. Expected ${targetSeatQuantity}, received ${verifiedStripeQuantity}.`,
      );
    }

    const now = new Date().toISOString();

    const {
      error: organizationUpdateError,
    } = await adminClient
      .from("organizations")
      .update({
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: checkoutCustomerId,
        paid_seat_count: targetSeatQuantity,
        pending_paid_seat_count: null,
        pending_seat_effective_at: null,
        subscription_status: "active",
        stripe_billing_error: null,
        stripe_billing_synced_at: now,
      })
      .eq("id", organizationId);

    if (organizationUpdateError) {
      throw new Error(
        `Organization seat update failed: ${organizationUpdateError.message}`,
      );
    }

    const {
      data: matchingRequests,
      error: matchingRequestError,
    } = await adminClient
      .from(
        "organization_billing_change_requests",
      )
      .select("id")
      .eq("organization_id", organizationId)
      .eq("change_type", "seat_increase")
      .eq(
        "requested_seat_quantity",
        targetSeatQuantity,
      )
      .in("change_status", [
        "processing",
        "pending",
      ])
      .order("created_at", {
        ascending: false,
      })
      .limit(1);

    if (matchingRequestError) {
      throw new Error(
        `Billing request lookup failed: ${matchingRequestError.message}`,
      );
    }

    const matchingRequestId =
      matchingRequests?.[0]?.id ?? null;

    if (matchingRequestId) {
      const {
        error: requestUpdateError,
      } = await adminClient
        .from(
          "organization_billing_change_requests",
        )
        .update({
          change_status: "applied",
          applied_at: now,
          effective_at: now,
          error_message: null,
          updated_at: now,
          stripe_subscription_id:
            subscriptionId,
          stripe_subscription_item_id:
            subscriptionItemId,
          metadata: {
            checkout_session_id:
              checkoutSession.id,
            checkout_status:
              checkoutSession.status,
            checkout_payment_status:
              checkoutSession.payment_status,
            checkout_amount_total:
              checkoutSession.amount_total ?? 0,
            checkout_currency:
              checkoutSession.currency,
            applied_by:
              "complete-organization-seat-checkout",
          },
        })
        .eq("id", matchingRequestId);

      if (requestUpdateError) {
        throw new Error(
          `Billing request update failed: ${requestUpdateError.message}`,
        );
      }
    }

    const result = {
      success: true,
      organizationId,
      checkoutSessionId:
        checkoutSession.id,
      checkoutStatus:
        checkoutSession.status,
      paymentStatus:
        checkoutSession.payment_status,
      checkoutAmountTotal:
        checkoutSession.amount_total ?? 0,
      quantityBefore,
      targetSeatQuantity,
      verifiedStripeQuantity,
      supabasePaidSeatCount:
        targetSeatQuantity,
    };

    console.log(
      "Organization seat Checkout applied:",
      result,
    );

    if (returnJson) {
      return jsonResponse(result);
    }

    return portalRedirect({
      billing: "seat-checkout-complete",
      organization_id: organizationId,
      seats: String(targetSeatQuantity),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "Organization seat Checkout completion failed:",
      message,
    );

    if (returnJson) {
      return jsonResponse(
        {
          success: false,
          error: message,
          sessionId,
        },
        500,
      );
    }

    return portalRedirect({
      billing: "seat-checkout-error",
      message,
    });
  }
});
