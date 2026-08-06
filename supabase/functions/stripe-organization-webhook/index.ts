import Stripe from "npm:stripe@^22";
import { createClient } from "npm:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

type BillingPriceRecord = {
  plan_key: string;
  component_key: string;
  billing_interval: "monthly" | "annual";
  stripe_price_id: string;
};

type OrganizationRecord = {
  id: string;
  current_plan_key: string | null;
  subscription_status: string | null;
  paid_seat_count: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function sanitizeError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "The Stripe webhook could not be processed.";

  return message
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/whsec_[A-Za-z0-9]+/g, "[redacted]")
    .slice(0, 1200);
}

function getExpandableId(
  value:
    | string
    | Stripe.Customer
    | Stripe.DeletedCustomer
    | Stripe.Subscription
    | Stripe.Invoice
    | null
    | undefined,
) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id;
}

function normalizeSubscriptionStatus(status: Stripe.Subscription.Status) {
  if (status === "active" || status === "trialing") {
    return "active";
  }

  if (
    status === "past_due" ||
    status === "unpaid" ||
    status === "paused"
  ) {
    return status;
  }

  if (status === "canceled") {
    return "canceled";
  }

  return status;
}

function unixToIso(value: number | null | undefined) {
  if (!value) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

async function markWebhookEvent(
  adminClient: ReturnType<typeof createClient>,
  stripeEventId: string,
  values: JsonRecord,
) {
  const { error } = await adminClient
    .from("stripe_webhook_events")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_event_id", stripeEventId);

  if (error) {
    console.error("Stripe webhook event status could not be updated:", error);
  }
}

async function findOrganizationByStripeReferences(
  adminClient: ReturnType<typeof createClient>,
  details: {
    organizationId?: string | null;
    customerId?: string | null;
    subscriptionId?: string | null;
  },
) {
  if (details.organizationId) {
    const { data, error } = await adminClient
      .from("organizations")
      .select(
        `
          id,
          current_plan_key,
          subscription_status,
          paid_seat_count,
          stripe_customer_id,
          stripe_subscription_id
        `,
      )
      .eq("id", details.organizationId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return data as OrganizationRecord;
    }
  }

  if (details.subscriptionId) {
    const { data, error } = await adminClient
      .from("organizations")
      .select(
        `
          id,
          current_plan_key,
          subscription_status,
          paid_seat_count,
          stripe_customer_id,
          stripe_subscription_id
        `,
      )
      .eq("stripe_subscription_id", details.subscriptionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return data as OrganizationRecord;
    }
  }

  if (details.customerId) {
    const { data, error } = await adminClient
      .from("organizations")
      .select(
        `
          id,
          current_plan_key,
          subscription_status,
          paid_seat_count,
          stripe_customer_id,
          stripe_subscription_id
        `,
      )
      .eq("stripe_customer_id", details.customerId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return data as OrganizationRecord;
    }
  }

  return null;
}

async function loadBillingPriceMappings(
  adminClient: ReturnType<typeof createClient>,
  priceIds: string[],
) {
  if (priceIds.length === 0) {
    return [] as BillingPriceRecord[];
  }

  const { data, error } = await adminClient
    .from("stripe_billing_prices")
    .select(
      `
        plan_key,
        component_key,
        billing_interval,
        stripe_price_id
      `,
    )
    .in("stripe_price_id", priceIds)
    .eq("active", true);

  if (error) {
    throw error;
  }

  return (data ?? []) as BillingPriceRecord[];
}

async function countSeatsInUse(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
) {
  const { count, error } = await adminClient
    .from("organization_users")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("is_billable", true);

  if (error) {
    throw error;
  }

  return Math.max(0, Number(count ?? 0));
}


async function synchronizeOrganizationCreditAddons(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  subscription: Stripe.Subscription,
) {
  const subscriptionItems =
    subscription.items.data.map((item) => ({
      price_id: item.price?.id ?? null,
      quantity: Math.max(
        0,
        Number(item.quantity ?? 0),
      ),
    }));

  const [
    appPoolSyncResult,
    portalPoolSyncResult,
  ] = await Promise.all([
    adminClient.rpc(
      "sync_organization_app_pool_recurring_addons",
      {
        p_organization_id: organizationId,
        p_subscription_status: subscription.status,
        p_items: subscriptionItems,
      },
    ),
    adminClient.rpc(
      "sync_organization_portal_recurring_addons",
      {
        p_organization_id: organizationId,
        p_subscription_status: subscription.status,
        p_items: subscriptionItems,
      },
    ),
  ]);

  if (appPoolSyncResult.error) {
    throw new Error(
      `The organization shared app-credit pool could not be synchronized: ${appPoolSyncResult.error.message}`,
    );
  }

  if (portalPoolSyncResult.error) {
    throw new Error(
      `The organization portal-credit pool could not be synchronized: ${portalPoolSyncResult.error.message}`,
    );
  }
}

async function synchronizeSubscription(
  stripe: Stripe,
  adminClient: ReturnType<typeof createClient>,
  stripeEventId: string,
  subscription: Stripe.Subscription,
) {
  const customerId = getExpandableId(subscription.customer);
  const organizationId =
    subscription.metadata.organization_id?.trim() || null;

  const organization = await findOrganizationByStripeReferences(adminClient, {
    organizationId,
    customerId,
    subscriptionId: subscription.id,
  });

  if (!organization) {
    throw new Error(
      `No organization is connected to Stripe subscription ${subscription.id}.`,
    );
  }

  const subscriptionItems = subscription.items.data;
  const subscriptionKind =
    subscription.metadata.subscription_kind?.trim() || "base";

  if (subscriptionKind === "ai_addons") {
    const { error: addonSubscriptionUpdateError } =
      await adminClient
        .from("organizations")
        .update({
          stripe_customer_id: customerId,
          stripe_addon_subscription_id: subscription.id,
          stripe_billing_synced_at: new Date().toISOString(),
          stripe_billing_error: null,
        })
        .eq("id", organization.id);

    if (addonSubscriptionUpdateError) {
      throw addonSubscriptionUpdateError;
    }

    await synchronizeOrganizationCreditAddons(
      adminClient,
      organization.id,
      subscription,
    );

    const { error: addonAuditError } =
      await adminClient
        .from("organization_billing_events")
        .insert({
          organization_id: organization.id,
          actor_user_id: null,
          stripe_event_id: stripeEventId,
          event_type:
            "stripe_addon_subscription_synchronized",
          previous_plan_key:
            organization.current_plan_key,
          new_plan_key:
            organization.current_plan_key,
          previous_subscription_status:
            organization.subscription_status,
          new_subscription_status:
            organization.subscription_status,
          previous_paid_seat_count:
            organization.paid_seat_count,
          new_paid_seat_count:
            organization.paid_seat_count,
          metadata: {
            stripe_addon_subscription_id:
              subscription.id,
            stripe_customer_id: customerId,
            subscription_status:
              subscription.status,
          },
        });

    if (addonAuditError) {
      throw addonAuditError;
    }

    return organization.id;
  }

  const priceIds = subscriptionItems
    .map((item) => item.price?.id)
    .filter((priceId): priceId is string => Boolean(priceId));

  const priceMappings = await loadBillingPriceMappings(
    adminClient,
    priceIds,
  );

  const portalMapping =
    priceMappings.find(
      (mapping) => mapping.component_key === "portal_base",
    ) ?? null;

  const seatMapping =
    priceMappings.find(
      (mapping) => mapping.component_key === "user_seat",
    ) ?? null;

  const selectedMapping = portalMapping ?? seatMapping;

  const metadataPlanKey =
    subscription.metadata.plan_key?.trim() || null;

  const planKey = selectedMapping?.plan_key ?? metadataPlanKey;

  if (!planKey) {
    throw new Error(
      "The Stripe subscription does not match an active Everward organization plan mapping.",
    );
  }

  const billingInterval =
    selectedMapping?.billing_interval ??
    (subscription.metadata.billing_interval === "annual"
      ? "annual"
      : "monthly");

  const seatItem = seatMapping
    ? subscriptionItems.find(
        (item) => item.price?.id === seatMapping.stripe_price_id,
      )
    : null;

  const metadataSeatQuantity = Number(
    subscription.metadata.seat_quantity ?? 0,
  );

  const stripeSeatQuantity = Math.max(
    0,
    Number(seatItem?.quantity ?? metadataSeatQuantity ?? 0),
  );

  const seatsInUse = await countSeatsInUse(
    adminClient,
    organization.id,
  );

  const paidSeatCount = Math.max(
    stripeSeatQuantity,
    seatsInUse,
  );

  const portalItem = portalMapping
    ? subscriptionItems.find(
        (item) => item.price?.id === portalMapping.stripe_price_id,
      )
    : null;

  const primaryItem = portalItem ?? seatItem ?? subscriptionItems[0] ?? null;

  const currentPeriodStart =
    unixToIso(primaryItem?.current_period_start) ??
    unixToIso(subscription.start_date);

  const currentPeriodEnd =
    unixToIso(primaryItem?.current_period_end) ??
    unixToIso(subscription.cancel_at);

  const nextSubscriptionStatus = normalizeSubscriptionStatus(
    subscription.status,
  );

  const organizationUpdate = {
    current_plan_key: planKey,
    billing_interval: billingInterval,
    subscription_status: nextSubscriptionStatus,
    paid_seat_count: paidSeatCount,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_subscription_item_id: seatItem?.id ?? primaryItem?.id ?? null,
    stripe_primary_price_id: primaryItem?.price?.id ?? null,
    stripe_cancel_at_period_end: subscription.cancel_at_period_end,
    current_billing_period_start: currentPeriodStart,
    current_billing_period_end: currentPeriodEnd,
    stripe_billing_synced_at: new Date().toISOString(),
    stripe_billing_error:
      stripeSeatQuantity < seatsInUse
        ? `Stripe requested ${stripeSeatQuantity} seats, but ${seatsInUse} seats are currently in use. Everward retained ${seatsInUse} seats.`
        : null,
  };

  const { error: updateError } = await adminClient
    .from("organizations")
    .update(organizationUpdate)
    .eq("id", organization.id);

  if (updateError) {
    throw updateError;
  }

  await synchronizeOrganizationCreditAddons(
    adminClient,
    organization.id,
    subscription,
  );

  const { error: auditError } = await adminClient
    .from("organization_billing_events")
    .insert({
      organization_id: organization.id,
      actor_user_id: null,
      stripe_event_id: stripeEventId,
      event_type: "stripe_subscription_synchronized",
      previous_plan_key: organization.current_plan_key,
      new_plan_key: planKey,
      previous_subscription_status: organization.subscription_status,
      new_subscription_status: nextSubscriptionStatus,
      previous_paid_seat_count: organization.paid_seat_count,
      new_paid_seat_count: paidSeatCount,
      metadata: {
        stripe_subscription_id: subscription.id,
        stripe_customer_id: customerId,
        billing_interval: billingInterval,
        stripe_seat_quantity: stripeSeatQuantity,
        seats_in_use: seatsInUse,
        retained_seat_floor: stripeSeatQuantity < seatsInUse,
        cancel_at_period_end: subscription.cancel_at_period_end,
      },
    });

  if (auditError) {
    throw auditError;
  }

return organization.id;
}

async function handleCheckoutCompleted(
  stripe: Stripe,
  adminClient: ReturnType<typeof createClient>,
  stripeEventId: string,
  session: Stripe.Checkout.Session,
) {
  const organizationId =
    session.metadata?.organization_id?.trim() ||
    session.client_reference_id?.trim() ||
    null;

  const customerId = getExpandableId(session.customer);
  const subscriptionId = getExpandableId(session.subscription);

  const organization = await findOrganizationByStripeReferences(adminClient, {
    organizationId,
    customerId,
    subscriptionId,
  });

  if (!organization) {
    throw new Error(
      `No organization could be matched to Checkout Session ${session.id}.`,
    );
  }

  const subscriptionKind =
    session.metadata?.subscription_kind?.trim() ||
    "base";

  const checkoutUpdate =
    subscriptionKind === "ai_addons"
      ? {
          stripe_customer_id:
            customerId,
          stripe_addon_subscription_id:
            subscriptionId ??
            organization
              .stripe_addon_subscription_id,
          stripe_billing_synced_at:
            new Date().toISOString(),
          stripe_billing_error:
            null,
        }
      : {
          stripe_customer_id:
            customerId,
          stripe_subscription_id:
            subscriptionId ??
            organization
              .stripe_subscription_id,
          stripe_checkout_session_id:
            session.id,
          stripe_latest_invoice_id:
            getExpandableId(
              session.invoice,
            ),
          stripe_billing_synced_at:
            new Date().toISOString(),
          stripe_billing_error:
            null,
        };

  const { error: organizationUpdateError } =
    await adminClient
      .from("organizations")
      .update(checkoutUpdate)
      .eq("id", organization.id);

  if (organizationUpdateError) {
    throw organizationUpdateError;
  }

  const { error: checkoutUpdateError } = await adminClient
    .from("organization_checkout_requests")
    .update({
      stripe_checkout_session_id: session.id,
      request_status: "completed",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organization.id)
    .eq("stripe_checkout_session_id", session.id);

  if (checkoutUpdateError) {
    throw checkoutUpdateError;
  }

  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    await synchronizeSubscription(
      stripe,
      adminClient,
      stripeEventId,
      subscription,
    );
  }

  return organization.id;
}

async function handleInvoiceEvent(
  stripe: Stripe,
  adminClient: ReturnType<typeof createClient>,
  stripeEventId: string,
  invoice: Stripe.Invoice,
  paymentSucceeded: boolean,
) {
  const customerId = getExpandableId(invoice.customer);
  const subscriptionId =
    typeof invoice.parent?.subscription_details?.subscription === "string"
      ? invoice.parent.subscription_details.subscription
      : invoice.parent?.subscription_details?.subscription?.id ?? null;

  const organization = await findOrganizationByStripeReferences(adminClient, {
    customerId,
    subscriptionId,
  });

  if (!organization) {
    return null;
  }

  const nextStatus = paymentSucceeded
    ? organization.subscription_status
    : "past_due";

  const { error: updateError } = await adminClient
    .from("organizations")
    .update({
      stripe_latest_invoice_id: invoice.id,
      subscription_status: nextStatus,
      stripe_billing_synced_at: new Date().toISOString(),
      stripe_billing_error: paymentSucceeded
        ? null
        : "Stripe reported that the latest subscription invoice payment failed.",
    })
    .eq("id", organization.id);

  if (updateError) {
    throw updateError;
  }

  if (paymentSucceeded && subscriptionId) {
    const paidSubscription =
      await stripe.subscriptions.retrieve(
        subscriptionId,
      );

    await synchronizeOrganizationCreditAddons(
      adminClient,
      organization.id,
      paidSubscription,
    );
  }

  const { error: auditError } = await adminClient
    .from("organization_billing_events")
    .insert({
      organization_id: organization.id,
      actor_user_id: null,
      stripe_event_id: stripeEventId,
      event_type: paymentSucceeded
        ? "stripe_invoice_paid"
        : "stripe_invoice_payment_failed",
      previous_plan_key: organization.current_plan_key,
      new_plan_key: organization.current_plan_key,
      previous_subscription_status: organization.subscription_status,
      new_subscription_status: nextStatus,
      previous_paid_seat_count: organization.paid_seat_count,
      new_paid_seat_count: organization.paid_seat_count,
      metadata: {
        stripe_invoice_id: invoice.id,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        amount_paid: invoice.amount_paid,
        amount_due: invoice.amount_due,
        currency: invoice.currency,
      },
    });

  if (auditError) {
    throw auditError;
  }

  return organization.id;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(
      {
        error: "Method not allowed.",
      },
      405,
    );
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const stripeWebhookSecret = Deno.env.get(
    "STRIPE_ORGANIZATION_WEBHOOK_SECRET",
  );
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get(
    "SUPABASE_SERVICE_ROLE_KEY",
  );

  if (
    !stripeSecretKey ||
    !stripeWebhookSecret ||
    !supabaseUrl ||
    !supabaseServiceRoleKey
  ) {
    return jsonResponse(
      {
        error: "The Stripe organization webhook is not configured.",
      },
      500,
    );
  }

  const stripeSignature = request.headers.get("stripe-signature");

  if (!stripeSignature) {
    return jsonResponse(
      {
        error: "The Stripe signature header is missing.",
      },
      400,
    );
  }

  const rawBody = await request.text();
  const stripe = new Stripe(stripeSecretKey);
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  let stripeEvent: Stripe.Event;

  try {
    stripeEvent = await stripe.webhooks.constructEventAsync(
      rawBody,
      stripeSignature,
      stripeWebhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    console.error(
      "Stripe webhook signature verification failed:",
      sanitizeError(error),
    );

    return jsonResponse(
      {
        error: "The Stripe webhook signature is invalid.",
      },
      400,
    );
  }

  const adminClient = createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  const { data: existingEvent, error: existingEventError } =
    await adminClient
      .from("stripe_webhook_events")
      .select("stripe_event_id, processing_status")
      .eq("stripe_event_id", stripeEvent.id)
      .maybeSingle();

  if (existingEventError) {
    return jsonResponse(
      {
        error: "The Stripe webhook event could not be checked.",
      },
      500,
    );
  }

  if (
    existingEvent?.processing_status === "processed" ||
    existingEvent?.processing_status === "ignored"
  ) {
    return jsonResponse({
      received: true,
      duplicate: true,
      stripeEventId: stripeEvent.id,
    });
  }

  if (!existingEvent) {
    const { error: insertError } = await adminClient
      .from("stripe_webhook_events")
      .insert({
        stripe_event_id: stripeEvent.id,
        event_type: stripeEvent.type,
        stripe_api_version: stripeEvent.api_version ?? null,
        livemode: stripeEvent.livemode,
        stripe_created_at: unixToIso(stripeEvent.created),
        payload: stripeEvent as unknown as JsonRecord,
        processing_status: "received",
        processing_attempts: 0,
      });

    if (insertError && insertError.code !== "23505") {
      return jsonResponse(
        {
          error: "The Stripe webhook event could not be recorded.",
        },
        500,
      );
    }
  }

  const { error: processingUpdateError } = await adminClient
    .from("stripe_webhook_events")
    .update({
      processing_status: "processing",
      processing_attempts:
        existingEvent?.processing_status === "failed" ? 2 : 1,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_event_id", stripeEvent.id);

  if (processingUpdateError) {
    return jsonResponse(
      {
        error: "The Stripe webhook event could not be locked for processing.",
      },
      500,
    );
  }

  try {
    let organizationId: string | null = null;
    let processingStatus: "processed" | "ignored" = "processed";

    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        organizationId = await handleCheckoutCompleted(
          stripe,
          adminClient,
          stripeEvent.id,
          stripeEvent.data.object as Stripe.Checkout.Session,
        );
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        organizationId = await synchronizeSubscription(
          stripe,
          adminClient,
          stripeEvent.id,
          stripeEvent.data.object as Stripe.Subscription,
        );
        break;
      }

      case "invoice.paid": {
        organizationId = await handleInvoiceEvent(
          stripe,
          adminClient,
          stripeEvent.id,
          stripeEvent.data.object as Stripe.Invoice,
          true,
        );
        break;
      }

      case "invoice.payment_failed": {
        organizationId = await handleInvoiceEvent(
          stripe,
          adminClient,
          stripeEvent.id,
          stripeEvent.data.object as Stripe.Invoice,
          false,
        );
        break;
      }

      default: {
        processingStatus = "ignored";
      }
    }

    await markWebhookEvent(adminClient, stripeEvent.id, {
      processing_status: processingStatus,
      processed_at: new Date().toISOString(),
      last_error: null,
    });

    return jsonResponse({
      received: true,
      processed: processingStatus === "processed",
      ignored: processingStatus === "ignored",
      stripeEventId: stripeEvent.id,
      stripeEventType: stripeEvent.type,
      organizationId,
    });
  } catch (error) {
    const errorMessage = sanitizeError(error);

    console.error("Stripe organization webhook failed:", {
      stripeEventId: stripeEvent.id,
      stripeEventType: stripeEvent.type,
      error: errorMessage,
    });

    await markWebhookEvent(adminClient, stripeEvent.id, {
      processing_status: "failed",
      processed_at: null,
      last_error: errorMessage,
    });

    return jsonResponse(
      {
        error: errorMessage,
        stripeEventId: stripeEvent.id,
      },
      500,
    );
  }
});
