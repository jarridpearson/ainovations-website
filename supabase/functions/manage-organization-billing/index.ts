import Stripe from "npm:stripe@^22";
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.109.0";
import type { Database } from "../_shared/database.types.ts";

type AdminClient = SupabaseClient<Database>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PORTAL_ADDON_PRICES: Record<number, string> = {
  50: "price_1Txnu2DBB5irv1eWMxKboLcP",
  100: "price_1Txnu4DBB5irv1eW68ncPZxT",
  250: "price_1Txnu5DBB5irv1eW10l2A52d",
};

const APP_ADDON_PRICES: Record<number, string> = {
  50: "price_1TxoU6DBB5irv1eWDPweb5J3",
  100: "price_1TxoU7DBB5irv1eWItOKbvtN",
  250: "price_1TxoU8DBB5irv1eWnRIpG0cT",
  500: "price_1TxoIdDBB5irv1eWvudspFkO",
  1000: "price_1TxoIeDBB5irv1eW97Pt1JLF",
  5000: "price_1TxoIfDBB5irv1eWU2UiF1y1",
  10000: "price_1TxoIgDBB5irv1eW6FyY2cFS",
};

type BillingAction =
  | "get_state"
  | "preview_change"
  | "update_seats"
  | "schedule_plan"
  | "update_addon"
  | "cancel_subscription"
  | "resume_subscription"
  | "open_portal";

type BillingRequest = {
  organizationId?: unknown;
  action?: unknown;
  changeType?: unknown;
  seatQuantity?: unknown;
  planKey?: unknown;
  billingInterval?: unknown;
  addonPool?: unknown;
  addonCredits?: unknown;
};

type OrganizationRecord = {
  id: string;
  name: string;
  current_plan_key: string | null;
  billing_interval: string | null;
  subscription_status: string | null;
  paid_seat_count: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_addon_subscription_id: string | null;
  current_billing_period_end: string | null;
  pending_plan_key: string | null;
  pending_billing_interval: string | null;
  pending_paid_seat_count: number | null;
  pending_plan_effective_at: string | null;
  pending_seat_effective_at: string | null;
  stripe_cancel_at_period_end: boolean | null;
};

type BillingPriceRecord = {
  plan_key: string;
  component_key: string;
  billing_interval: "monthly" | "annual";
  stripe_price_id: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatPreviewLabel(value: string) {
  return value
    .replace(/^organization_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function sanitizeError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Organization billing could not be updated.";

  return message
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 1200);
}

function unixToIso(value: number | null | undefined) {
  if (!value) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function getSubscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const itemEnd = subscription.items.data
    .map((item) => Number(item.current_period_end ?? 0))
    .filter((value) => value > 0)
    .sort((a, b) => a - b)[0];

  if (itemEnd) {
    return itemEnd;
  }

  const subscriptionValue = subscription as Stripe.Subscription & {
    current_period_end?: number;
  };

  return Number(subscriptionValue.current_period_end ?? 0);
}

function getSubscriptionPeriodStart(subscription: Stripe.Subscription) {
  const itemStart = subscription.items.data
    .map((item) => Number(item.current_period_start ?? 0))
    .filter((value) => value > 0)
    .sort((a, b) => a - b)[0];

  if (itemStart) {
    return itemStart;
  }

  const subscriptionValue = subscription as Stripe.Subscription & {
    current_period_start?: number;
  };

  return Number(
    subscriptionValue.current_period_start ??
      subscription.start_date ??
      Math.floor(Date.now() / 1000),
  );
}


async function loadLatestInvoiceState(
  stripe: Stripe,
  subscription: Stripe.Subscription,
) {
  const invoiceId =
    typeof subscription.latest_invoice === "string"
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id ?? null;

  if (!invoiceId) {
    return {
      invoiceId: null,
      invoiceStatus: null,
      paymentUrl: null,
      paid: false,
    };
  }

  const invoice = await stripe.invoices.retrieve(invoiceId);

  return {
    invoiceId: invoice.id,
    invoiceStatus: invoice.status,
    paymentUrl: invoice.hosted_invoice_url ?? null,
    paid: invoice.status === "paid",
  };
}

function reversePriceLookup(
  mappings: Record<number, string>,
  priceId: string | null | undefined,
) {
  if (!priceId) {
    return 0;
  }

  for (const [credits, mappedPriceId] of Object.entries(mappings)) {
    if (mappedPriceId === priceId) {
      return Number(credits);
    }
  }

  return 0;
}

function subscriptionItemDefinitions(subscription: Stripe.Subscription) {
  return subscription.items.data.map((item) => ({
    price: item.price.id,
    quantity: Math.max(1, Number(item.quantity ?? 1)),
  }));
}

function replaceItemDefinition(
  items: Array<{ price: string; quantity: number }>,
  oldPriceIds: string[],
  newPriceId: string | null,
  quantity: number,
) {
  const result = items.filter((item) => !oldPriceIds.includes(item.price));

  if (newPriceId && quantity > 0) {
    result.push({
      price: newPriceId,
      quantity,
    });
  }

  return result;
}

function getPositiveProrationAmount(
  invoice: Stripe.Invoice,
  targetSubscriptionItemId: string | null,
  targetPriceId: string | null,
) {
  const amount = invoice.lines.data.reduce(
    (total, line) => {
      const parent = line.parent as
        | {
            type?: string;
            subscription_item_details?: {
              proration?: boolean;
              subscription_item?: string | null;
            };
          }
        | null
        | undefined;

      const legacyLine = line as Stripe.InvoiceLineItem & {
        proration?: boolean;
        pricing?: {
          price_details?: {
            price?: string | null;
          };
        };
      };

      const isProration =
        parent?.subscription_item_details?.proration === true ||
        legacyLine.proration === true;

      if (!isProration) {
        return total;
      }

      const lineSubscriptionItemId =
        parent?.subscription_item_details?.subscription_item ??
        null;

      const linePriceId =
        legacyLine.pricing?.price_details?.price ??
        null;

      const matchesSubscriptionItem =
        Boolean(targetSubscriptionItemId) &&
        lineSubscriptionItemId === targetSubscriptionItemId;

      const matchesNewPrice =
        !targetSubscriptionItemId &&
        Boolean(targetPriceId) &&
        linePriceId === targetPriceId;

      if (!matchesSubscriptionItem && !matchesNewPrice) {
        return total;
      }

      return total + Number(line.amount ?? 0);
    },
    0,
  );

  return Math.max(0, amount);
}

async function getFutureScheduleItems(
  stripe: Stripe,
  subscription: Stripe.Subscription,
) {
  const currentItems = subscriptionItemDefinitions(subscription);
  const scheduleId =
    typeof subscription.schedule === "string"
      ? subscription.schedule
      : subscription.schedule?.id ?? null;

  if (!scheduleId) {
    return {
      scheduleId: null as string | null,
      items: currentItems,
    };
  }

  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const periodEnd = getSubscriptionPeriodEnd(subscription);

  const futurePhase =
    [...schedule.phases]
      .reverse()
      .find((phase) => Number(phase.start_date) >= periodEnd) ?? null;

  if (!futurePhase) {
    return {
      scheduleId,
      items: currentItems,
    };
  }

  return {
    scheduleId,
    items: futurePhase.items.map((item) => ({
      price:
        typeof item.price === "string"
          ? item.price
          : item.price?.id ?? "",
      quantity: Math.max(1, Number(item.quantity ?? 1)),
    })).filter((item) => Boolean(item.price)),
  };
}

async function scheduleItemsAtRenewal(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  futureItems: Array<{ price: string; quantity: number }>,
) {
  const currentStart = getSubscriptionPeriodStart(subscription);
  const currentEnd = getSubscriptionPeriodEnd(subscription);

  if (!currentEnd || currentEnd <= currentStart) {
    throw new Error(
      "Stripe did not provide a valid subscription renewal date.",
    );
  }

  const existingScheduleId =
    typeof subscription.schedule === "string"
      ? subscription.schedule
      : subscription.schedule?.id ?? null;

  if (existingScheduleId) {
    const existingSchedule =
      await stripe.subscriptionSchedules.retrieve(
        existingScheduleId,
      );

    if (existingSchedule.status !== "released") {
      await stripe.subscriptionSchedules.release(
        existingScheduleId,
      );
    }
  }

  const schedule =
    await stripe.subscriptionSchedules.create({
      from_subscription: subscription.id,
    });

  const currentSubscription =
    await stripe.subscriptions.retrieve(
      subscription.id,
      {
        expand: ["items.data.price"],
      },
    );

  const activeStart =
    getSubscriptionPeriodStart(currentSubscription);

  const activeEnd =
    getSubscriptionPeriodEnd(currentSubscription);

  if (!activeEnd || activeEnd <= activeStart) {
    throw new Error(
      "Stripe did not provide a valid active subscription period.",
    );
  }

  await stripe.subscriptionSchedules.update(
    schedule.id,
    {
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        {
          start_date: activeStart,
          end_date: activeEnd,
          items:
            subscriptionItemDefinitions(
              currentSubscription,
            ),
          proration_behavior: "none",
        },
        {
          start_date: activeEnd,
          items: futureItems,
          proration_behavior: "none",
        },
      ],
    },
  );

  return {
    scheduleId: schedule.id,
    effectiveAt: unixToIso(activeEnd),
  };
}

async function loadPlanPrices(
  adminClient: AdminClient,
  planKey: string,
  billingInterval: string,
) {
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
    .eq("plan_key", planKey)
    .eq("billing_interval", billingInterval)
    .eq("active", true)
    .in("component_key", ["portal_base", "user_seat"]);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as BillingPriceRecord[];

  const portalBase = rows.find(
    (row) => row.component_key === "portal_base",
  );

  const userSeat = rows.find(
    (row) => row.component_key === "user_seat",
  );

  if (!portalBase?.stripe_price_id || !userSeat?.stripe_price_id) {
    throw new Error(
      "Stripe prices are not configured for that plan and billing interval.",
    );
  }

  return {
    portalBasePriceId: portalBase.stripe_price_id,
    userSeatPriceId: userSeat.stripe_price_id,
  };
}

async function loadAllBaseAndSeatPriceIds(
  adminClient: AdminClient,
) {
  const { data, error } = await adminClient
    .from("stripe_billing_prices")
    .select("component_key, stripe_price_id")
    .eq("active", true)
    .in("component_key", ["portal_base", "user_seat"]);

  if (error) {
    throw error;
  }

  return {
    portalPriceIds: (data ?? [])
      .filter((row) => row.component_key === "portal_base")
      .map((row) => row.stripe_price_id),
    seatPriceIds: (data ?? [])
      .filter((row) => row.component_key === "user_seat")
      .map((row) => row.stripe_price_id),
  };
}

async function recordChange(
  adminClient: AdminClient,
  values: Database["public"]["Tables"]["organization_billing_change_requests"]["Insert"],
) {
  const { error } = await adminClient
    .from("organization_billing_change_requests")
    .insert(values);

  if (error) {
    throw error;
  }
}

async function synchronizeOrganizationCreditAddons(
  adminClient: AdminClient,
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

async function getAuthorizedContext(
  request: Request,
  organizationId: string,
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error("Supabase billing configuration is incomplete.");
  }

  const authorizationHeader = request.headers.get("Authorization");

  if (!authorizationHeader) {
    throw new Error("You must be signed in.");
  }

  const callerClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authorizationHeader,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const adminClient = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();

  if (callerError || !caller) {
    throw new Error("Your signed-in account could not be verified.");
  }

  const [membershipResult, organizationResult, usedSeatResult] =
    await Promise.all([
      adminClient
        .from("organization_users")
        .select("role, is_active, billing_access_enabled")
        .eq("organization_id", organizationId)
        .eq("user_id", caller.id)
        .eq("is_active", true)
        .maybeSingle(),

      adminClient
        .from("organizations")
        .select(
          `
            id,
            name,
            current_plan_key,
            billing_interval,
            subscription_status,
            paid_seat_count,
            stripe_customer_id,
            stripe_subscription_id,
            stripe_addon_subscription_id,
            current_billing_period_end,
            pending_plan_key,
            pending_billing_interval,
            pending_paid_seat_count,
            pending_plan_effective_at,
            pending_seat_effective_at,
            stripe_cancel_at_period_end
          `,
        )
        .eq("id", organizationId)
        .maybeSingle(),

      adminClient
        .from("organization_users")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .eq("is_billable", true),
    ]);

  const membership = membershipResult.data;

  const hasBillingPermission =
    membership?.is_active === true &&
    (membership.role === "organization_admin" ||
      membership.role === "billing_admin" ||
      membership.billing_access_enabled === true);

  if (membershipResult.error || !hasBillingPermission) {
    throw new Error(
      "Only an Organization Admin or a user with billing access can manage billing.",
    );
  }

  if (organizationResult.error || !organizationResult.data) {
    throw new Error("The organization could not be loaded.");
  }

  if (usedSeatResult.error) {
    throw new Error("Current app-seat usage could not be loaded.");
  }

  return {
    caller,
    adminClient,
    organization: organizationResult.data as OrganizationRecord,
    usedSeatCount: Math.max(0, Number(usedSeatResult.count ?? 0)),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const portalUrl =
    Deno.env.get("EVERWARD_ORGANIZATION_PORTAL_URL") ||
    "https://everward.ainovations.net";

  if (!stripeSecretKey) {
    return jsonResponse(
      { error: "Stripe organization billing is not configured." },
      500,
    );
  }

  let body: BillingRequest;

  try {
    body = (await request.json()) as BillingRequest;
  } catch {
    return jsonResponse({ error: "Request body is not valid JSON." }, 400);
  }

  const organizationId = normalizeString(body.organizationId);
  const action = normalizeString(body.action) as BillingAction;

  if (!isUuid(organizationId)) {
    return jsonResponse(
      { error: "A valid organization ID is required." },
      400,
    );
  }

  if (
    ![
      "get_state",
      "preview_change",
      "update_seats",
      "schedule_plan",
      "update_addon",
      "cancel_subscription",
      "resume_subscription",
      "open_portal",
    ].includes(action)
  ) {
    return jsonResponse({ error: "A valid billing action is required." }, 400);
  }

  try {
    const {
      caller,
      adminClient,
      organization,
      usedSeatCount,
    } = await getAuthorizedContext(request, organizationId);

    const stripe = new Stripe(stripeSecretKey);

    if (action === "open_portal") {
      if (!organization.stripe_customer_id) {
        return jsonResponse(
          {
            error:
              "The organization has not completed its first Stripe checkout.",
          },
          409,
        );
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: organization.stripe_customer_id,
        return_url: `${portalUrl}/?billing=returned`,
      });

      return jsonResponse({
        billingPortalUrl: session.url,
      });
    }

    if (!organization.stripe_subscription_id) {
      return jsonResponse(
        {
          error:
            "The organization has not completed its first subscription checkout.",
          requiresCheckout: true,
        },
        409,
      );
    }

    const subscription = await stripe.subscriptions.retrieve(
      organization.stripe_subscription_id,
      {
        expand: ["items.data.price", "schedule"],
      },
    );

    const addonSubscription = organization.stripe_addon_subscription_id
      ? await stripe.subscriptions.retrieve(
          organization.stripe_addon_subscription_id,
          {
            expand: ["items.data.price", "schedule"],
          },
        )
      : null;

    const currentPortalAddonItem = addonSubscription?.items.data.find(
      (item) => Object.values(PORTAL_ADDON_PRICES).includes(item.price.id)
    );

    const currentAppAddonItem = addonSubscription?.items.data.find(
      (item) => Object.values(APP_ADDON_PRICES).includes(item.price.id)
    );

    const currentPortalAddonCredits = reversePriceLookup(
      PORTAL_ADDON_PRICES,
      currentPortalAddonItem?.price.id,
    );

    const currentAppAddonCredits = reversePriceLookup(
      APP_ADDON_PRICES,
      currentAppAddonItem?.price.id,
    );

    const pendingResult = await adminClient
      .from("organization_billing_change_requests")
      .select(
        `
          id,
          change_type,
          change_status,
          current_plan_key,
          requested_plan_key,
          current_billing_interval,
          requested_billing_interval,
          current_seat_quantity,
          requested_seat_quantity,
          current_addon_quantity,
          requested_addon_quantity,
          effective_at,
          metadata,
          created_at
        `,
      )
      .eq("organization_id", organizationId)
      .eq("change_status", "scheduled")
      .order("created_at", {
        ascending: false,
      });

    if (pendingResult.error) {
      throw pendingResult.error;
    }

    if (action === "preview_change") {
      const changeType = normalizeString(body.changeType);

      const renewalDate =
        organization.current_billing_period_end ??
        unixToIso(getSubscriptionPeriodEnd(subscription));

      if (changeType === "plan") {
        const planKey = normalizeString(body.planKey);
        const billingInterval =
          normalizeString(body.billingInterval);

        if (
          !["organization_starter", "organization_pro"].includes(
            planKey,
          )
        ) {
          return jsonResponse(
            {
              error:
                "Select Organization Starter or Organization Pro.",
            },
            400,
          );
        }

        if (!["monthly", "annual"].includes(billingInterval)) {
          return jsonResponse(
            {
              error:
                "Select monthly or annual billing.",
            },
            400,
          );
        }

        await loadPlanPrices(
          adminClient,
          planKey,
          billingInterval,
        );

        return jsonResponse({
          success: true,
          changeType,
          changeTiming: "renewal",
          description:
            `${formatPreviewLabel(planKey)} — ` +
            `${formatPreviewLabel(billingInterval)} billing`,
          amountDueToday: 0,
          estimatedRenewalAmount: null,
          currency: "usd",
          effectiveAt: renewalDate,
          estimateNote:
            "This change takes effect at renewal. Stripe will calculate the final renewal invoice using the active discounts, taxes, seats, and add-ons at that time.",
        });
      }

      if (changeType === "seats") {
        const requestedSeats = Number(body.seatQuantity);
        const currentSeats = Math.max(
          1,
          Number(organization.paid_seat_count ?? 1),
        );

        if (
          !Number.isInteger(requestedSeats) ||
          requestedSeats < 1 ||
          requestedSeats > 10000
        ) {
          return jsonResponse(
            {
              error:
                "App-seat quantity must be a whole number between 1 and 10,000.",
            },
            400,
          );
        }

        const allPriceIds =
          await loadAllBaseAndSeatPriceIds(adminClient);

        const seatItem = subscription.items.data.find(
          (item) =>
            allPriceIds.seatPriceIds.includes(item.price.id),
        );

        if (!seatItem) {
          throw new Error(
            "The Stripe app-seat subscription item could not be located.",
          );
        }

        if (requestedSeats > currentSeats) {
          const preview =
            await stripe.invoices.createPreview({
              customer:
                organization.stripe_customer_id ?? undefined,
              subscription: subscription.id,
              subscription_details: {
                proration_behavior: "create_prorations",
                items: [
                  {
                    id: seatItem.id,
                    quantity: requestedSeats,
                  },
                ],
              },
            });

          return jsonResponse({
            success: true,
            changeType,
            changeTiming: "immediate",
            description:
              `${requestedSeats.toLocaleString("en-US")} purchased app seats`,
            amountDueToday:
              getPositiveProrationAmount(
                preview,
                seatItem.id,
                seatItem.price.id,
              ),
            estimatedRenewalAmount: null,
            currency: String(
              preview.currency ?? "usd",
            ).toLowerCase(),
            effectiveAt: new Date().toISOString(),
            estimateNote:
              "The added seats become active immediately after Stripe confirms the prorated payment.",
          });
        }

        return jsonResponse({
          success: true,
          changeType,
          changeTiming: "renewal",
          description:
            `${requestedSeats.toLocaleString("en-US")} purchased app seats`,
          amountDueToday: 0,
          estimatedRenewalAmount: null,
          currency: "usd",
          effectiveAt: renewalDate,
          estimateNote:
            "Seat reductions take effect at renewal. Existing prepaid access remains active until then.",
        });
      }

      if (changeType === "addon") {
        const addonPool = normalizeString(body.addonPool);
        const requestedCredits = Number(body.addonCredits);

        if (!["portal", "app"].includes(addonPool)) {
          return jsonResponse(
            {
              error:
                "Select the web portal or app-user credit pool.",
            },
            400,
          );
        }

        const mappings =
          addonPool === "portal"
            ? PORTAL_ADDON_PRICES
            : APP_ADDON_PRICES;

        const currentItem =
          addonPool === "portal"
            ? currentPortalAddonItem
            : currentAppAddonItem;

        const currentCredits =
          addonPool === "portal"
            ? currentPortalAddonCredits
            : currentAppAddonCredits;

        const validCredits = [
          0,
          ...Object.keys(mappings).map(Number),
        ];

        if (
          !Number.isInteger(requestedCredits) ||
          !validCredits.includes(requestedCredits)
        ) {
          return jsonResponse(
            {
              error:
                "Select a valid recurring AI-credit package.",
            },
            400,
          );
        }

        const poolLabel =
          addonPool === "portal"
            ? "web portal AI"
            : "shared app AI";

        const description =
          requestedCredits === 0
            ? `Cancel the recurring ${poolLabel} package`
            : `${requestedCredits.toLocaleString("en-US")} recurring ${poolLabel} credits`;

        if (requestedCredits > currentCredits) {
          if (!addonSubscription) {
            return jsonResponse(
              {
                error:
                  "This organization does not have an AI add-on subscription yet. Purchase one from AI access before requesting a change.",
                requiresAddonCheckout: true,
              },
              409,
            );
          }

          const requestedPriceId =
            mappings[requestedCredits];

          if (!requestedPriceId) {
            throw new Error(
              "The requested AI-credit Stripe price could not be loaded.",
            );
          }

          const previewItem = currentItem
            ? {
                id: currentItem.id,
                price: requestedPriceId,
                quantity: 1,
              }
            : {
                price: requestedPriceId,
                quantity: 1,
              };

          const preview =
            await stripe.invoices.createPreview({
              customer:
                organization.stripe_customer_id ?? undefined,
              subscription: addonSubscription.id,
              subscription_details: {
                proration_behavior: "create_prorations",
                items: [previewItem],
              },
            });

          return jsonResponse({
            success: true,
            changeType,
            changeTiming: "immediate",
            description,
            amountDueToday:
              getPositiveProrationAmount(
                preview,
                currentItem?.id ?? null,
                requestedPriceId,
              ),
            estimatedRenewalAmount: null,
            currency: String(
              preview.currency ?? "usd",
            ).toLowerCase(),
            effectiveAt: new Date().toISOString(),
            estimateNote:
              "The larger recurring AI package becomes active immediately after Stripe confirms the prorated payment.",
          });
        }

        const addonRenewalDate = addonSubscription
          ? unixToIso(getSubscriptionPeriodEnd(addonSubscription))
          : renewalDate;

        return jsonResponse({
          success: true,
          changeType,
          changeTiming: "renewal",
          description,
          amountDueToday: 0,
          estimatedRenewalAmount: null,
          currency: "usd",
          effectiveAt: addonRenewalDate,
          estimateNote:
            requestedCredits === 0
              ? "The recurring AI package remains active through the prepaid term and cancels at renewal."
              : "The smaller recurring AI package begins at renewal. The current package remains active until then.",
        });
      }

      return jsonResponse(
        {
          error:
            "A valid billing change type is required.",
        },
        400,
      );
    }

    if (action === "get_state") {
      if (addonSubscription) {
        await synchronizeOrganizationCreditAddons(
          adminClient,
          organizationId,
          addonSubscription,
        );
      }

      return jsonResponse({
        organizationId,
        organizationName: organization.name,
        currentPlanKey: organization.current_plan_key,
        billingInterval: organization.billing_interval,
        pendingPlanKey: organization.pending_plan_key,
        pendingBillingInterval:
          organization.pending_billing_interval,
        pendingPaidSeatCount:
          organization.pending_paid_seat_count,
        subscriptionStatus: organization.subscription_status,
        purchasedSeatCount: Math.max(
          0,
          Number(organization.paid_seat_count ?? 0),
        ),
        usedSeatCount,
        renewalDate:
          organization.current_billing_period_end ??
          unixToIso(getSubscriptionPeriodEnd(subscription)),
        cancelAtPeriodEnd:
          subscription.cancel_at_period_end === true,
        hasAddonSubscription: Boolean(addonSubscription),
        currentPortalAddonCredits,
        currentAppAddonCredits,
        pendingChanges: pendingResult.data ?? [],
        portalAddonOptions: Object.keys(PORTAL_ADDON_PRICES).map(Number),
        appAddonOptions: Object.keys(APP_ADDON_PRICES).map(Number),
      });
    }

    if (action === "update_seats") {
      const requestedSeats = Number(body.seatQuantity);
      const currentSeats = Math.max(
        1,
        Number(organization.paid_seat_count ?? 1),
      );

      if (
        !Number.isInteger(requestedSeats) ||
        requestedSeats < 1 ||
        requestedSeats > 10000
      ) {
        return jsonResponse(
          {
            error:
              "App-seat quantity must be a whole number between 1 and 10,000.",
          },
          400,
        );
      }

      if (requestedSeats === currentSeats) {
        return jsonResponse({
          success: true,
          message: "The app-seat quantity is already current.",
        });
      }

      const allPriceIds = await loadAllBaseAndSeatPriceIds(adminClient);
      const seatItem = subscription.items.data.find((item) =>
        allPriceIds.seatPriceIds.includes(item.price.id)
      );

      if (!seatItem) {
        throw new Error(
          "The Stripe app-seat subscription item could not be located.",
        );
      }

      if (requestedSeats > currentSeats) {
        if (!organization.stripe_customer_id) {
          return jsonResponse(
            {
              error:
                "This organization does not have a Stripe customer attached.",
            },
            409,
          );
        }

        const seatsBeingAdded = requestedSeats - currentSeats;

        const preview = await stripe.invoices.createPreview({
          customer: organization.stripe_customer_id,
          subscription: subscription.id,
          subscription_details: {
            proration_behavior: "create_prorations",
            items: [
              {
                id: seatItem.id,
                quantity: requestedSeats,
              },
            ],
          },
        });

        const checkoutAmount =
          getPositiveProrationAmount(
          preview,
          seatItem.id,
          seatItem.price.id,
        );

        const checkoutCurrency = String(
          preview.currency ?? "usd",
        ).toLowerCase();

        const checkoutSession =
          await stripe.checkout.sessions.create({
            mode: "payment",
            customer: organization.stripe_customer_id,
            allow_promotion_codes: true,
            line_items: [
              {
                price_data: {
                  currency: checkoutCurrency,
                  unit_amount: checkoutAmount,
                  product_data: {
                    name:
                      seatsBeingAdded === 1
                        ? "Add 1 Everward app seat"
                        : `Add ${seatsBeingAdded} Everward app seats`,
                    description:
                      `Increase purchased app seats from ${currentSeats} to ${requestedSeats}.`,
                  },
                },
                quantity: 1,
              },
            ],
            success_url:
              "https://ptipedxvsekwoehfalux.supabase.co/functions/v1/" +
              "complete-organization-seat-checkout" +
              "?session_id={CHECKOUT_SESSION_ID}",
            cancel_url:
              "https://everward.ainovations.net" +
              "?billing=seat-checkout-canceled",
            metadata: {
              action: "organization_seat_increase",
              organization_id: organizationId,
              subscription_id: subscription.id,
              subscription_item_id: seatItem.id,
              current_seat_quantity: String(currentSeats),
              target_seat_quantity: String(requestedSeats),
              requested_by_user_id: caller.id,
            },
          });

        if (!checkoutSession.url) {
          throw new Error(
            "Stripe created Checkout without a redirect URL.",
          );
        }

        await recordChange(adminClient, {
          organization_id: organizationId,
          requested_by_user_id: caller.id,
          change_type: "seat_increase",
          change_status: "processing",
          current_seat_quantity: currentSeats,
          requested_seat_quantity: requestedSeats,
          effective_at: new Date().toISOString(),
          applied_at: null,
          stripe_subscription_id: subscription.id,
          stripe_subscription_item_id: seatItem.id,
          metadata: {
            checkout_session_id: checkoutSession.id,
            checkout_amount_total: checkoutAmount,
            checkout_currency: checkoutCurrency,
            billing_interval: organization.billing_interval,
            subscription_quantity_unchanged_until_checkout: true,
          },
        });

        return jsonResponse({
          success: true,
          paymentRequired: true,
          paymentUrl: checkoutSession.url,
          checkoutSessionId: checkoutSession.id,
          message:
            checkoutAmount === 0
              ? "Opening Stripe Checkout to confirm the discounted seat update."
              : "Opening Stripe Checkout to complete the prorated seat payment.",
        });
      }

      const future = await getFutureScheduleItems(stripe, subscription);
      const futureItems = replaceItemDefinition(
        future.items,
        allPriceIds.seatPriceIds,
        seatItem.price.id,
        requestedSeats,
      );

      const scheduled = await scheduleItemsAtRenewal(
        stripe,
        subscription,
        futureItems,
      );

      await adminClient
        .from("organizations")
        .update({
          pending_paid_seat_count: requestedSeats,
          pending_seat_effective_at: scheduled.effectiveAt,
        })
        .eq("id", organizationId);

      await recordChange(adminClient, {
        organization_id: organizationId,
        requested_by_user_id: caller.id,
        change_type: "seat_decrease",
        change_status: "scheduled",
        current_seat_quantity: currentSeats,
        requested_seat_quantity: requestedSeats,
        effective_at: scheduled.effectiveAt,
        stripe_subscription_id: subscription.id,
        stripe_subscription_item_id: seatItem.id,
        stripe_schedule_id: scheduled.scheduleId,
        metadata: {
          no_refund: true,
          access_continues_until_renewal: true,
          removal_order: "latest_app_access_activated_at_first",
          currently_used_seats: usedSeatCount,
        },
      });

      return jsonResponse({
        success: true,
        message: `The app-seat quantity will decrease to ${requestedSeats} at renewal. There is no refund or credit for the prepaid period. App access remains active until renewal.`,
      });
    }

    if (action === "schedule_plan") {
      const planKey = normalizeString(body.planKey);
      const billingInterval = normalizeString(body.billingInterval);

      if (
        !["organization_starter", "organization_pro"].includes(planKey)
      ) {
        return jsonResponse(
          { error: "Select Organization Starter or Organization Pro." },
          400,
        );
      }

      if (!["monthly", "annual"].includes(billingInterval)) {
        return jsonResponse(
          { error: "Select monthly or annual billing." },
          400,
        );
      }

      const targetPrices = await loadPlanPrices(
        adminClient,
        planKey,
        billingInterval,
      );

      const allPriceIds = await loadAllBaseAndSeatPriceIds(adminClient);
      const future = await getFutureScheduleItems(stripe, subscription);

      let futureItems = replaceItemDefinition(
        future.items,
        allPriceIds.portalPriceIds,
        targetPrices.portalBasePriceId,
        1,
      );

      futureItems = replaceItemDefinition(
        futureItems,
        allPriceIds.seatPriceIds,
        targetPrices.userSeatPriceId,
        Math.max(1, Number(organization.paid_seat_count ?? 1)),
      );

      const scheduled = await scheduleItemsAtRenewal(
        stripe,
        subscription,
        futureItems,
      );

      await adminClient
        .from("organizations")
        .update({
          pending_plan_key: planKey,
          pending_billing_interval: billingInterval,
          pending_plan_effective_at: scheduled.effectiveAt,
        })
        .eq("id", organizationId);

      await recordChange(adminClient, {
        organization_id: organizationId,
        requested_by_user_id: caller.id,
        change_type: "plan_change",
        change_status: "scheduled",
        current_plan_key: organization.current_plan_key,
        requested_plan_key: planKey,
        current_billing_interval: organization.billing_interval,
        requested_billing_interval: billingInterval,
        effective_at: scheduled.effectiveAt,
        stripe_subscription_id: subscription.id,
        stripe_schedule_id: scheduled.scheduleId,
        metadata: {
          effective_at_renewal: true,
          no_midterm_refund: true,
        },
      });

      return jsonResponse({
        success: true,
        message:
          "The plan change is scheduled for the current subscription renewal date.",
      });
    }

    if (action === "update_addon") {
      const addonPool = normalizeString(body.addonPool);
      const requestedCredits = Number(body.addonCredits);

      if (!["portal", "app"].includes(addonPool)) {
        return jsonResponse(
          { error: "Select the web portal or app-user credit pool." },
          400,
        );
      }

      const mappings =
        addonPool === "portal"
          ? PORTAL_ADDON_PRICES
          : APP_ADDON_PRICES;

      const validCredits = [0, ...Object.keys(mappings).map(Number)];

      if (
        !Number.isInteger(requestedCredits) ||
        !validCredits.includes(requestedCredits)
      ) {
        return jsonResponse(
          { error: "Select a valid recurring AI-credit package." },
          400,
        );
      }

      const currentItem =
        addonPool === "portal"
          ? currentPortalAddonItem
          : currentAppAddonItem;

      const currentCredits =
        addonPool === "portal"
          ? currentPortalAddonCredits
          : currentAppAddonCredits;

      if (requestedCredits === currentCredits) {
        return jsonResponse({
          success: true,
          message: "That AI-credit package is already active.",
        });
      }

      const allPoolPriceIds = Object.values(mappings);
      const requestedPriceId =
        requestedCredits > 0
          ? mappings[requestedCredits]
          : null;

      if (requestedCredits > currentCredits) {
        if (!addonSubscription) {
          return jsonResponse(
            {
              error:
                "This organization does not have an AI add-on subscription yet. Purchase one from AI access before requesting a change.",
              requiresAddonCheckout: true,
            },
            409,
          );
        }

        if (addonSubscription.pending_update) {
          const existingInvoiceState =
            await loadLatestInvoiceState(stripe, addonSubscription);

          if (existingInvoiceState.paymentUrl) {
            return jsonResponse({
              success: true,
              paymentRequired: !existingInvoiceState.paid,
              paymentUrl: existingInvoiceState.paymentUrl,
              invoiceId: existingInvoiceState.invoiceId,
              invoiceStatus: existingInvoiceState.invoiceStatus,
              message:
                "A prorated billing invoice is already waiting for payment. Opening Stripe now.",
            });
          }

          return jsonResponse(
            {
              error:
                "A Stripe subscription update is already pending. Complete or resolve the current invoice before requesting another billing change.",
            },
            409,
          );
        }

        let updatedSubscription: Stripe.Subscription;

        if (currentItem && requestedPriceId) {
          updatedSubscription =
            await stripe.subscriptions.update(addonSubscription.id, {
              items: [
                {
                  id: currentItem.id,
                  price: requestedPriceId,
                  quantity: 1,
                },
              ],
              proration_behavior: "always_invoice",
              payment_behavior: "pending_if_incomplete",
              expand: ["latest_invoice"],
            });
        } else if (requestedPriceId) {
          updatedSubscription =
            await stripe.subscriptions.update(addonSubscription.id, {
              items: [
                {
                  price: requestedPriceId,
                  quantity: 1,
                },
              ],
              proration_behavior: "always_invoice",
              payment_behavior: "pending_if_incomplete",
              expand: ["latest_invoice"],
            });
        } else {
          throw new Error(
            "The requested AI-credit Stripe price could not be loaded.",
          );
        }

        const invoiceState = await loadLatestInvoiceState(
          stripe,
          updatedSubscription,
        );

        await recordChange(adminClient, {
          organization_id: organizationId,
          requested_by_user_id: caller.id,
          change_type:
            addonPool === "portal"
              ? "portal_credit_change"
              : "app_credit_change",
          change_status: invoiceState.paid ? "applied" : "processing",
          current_addon_quantity: currentCredits,
          requested_addon_quantity: requestedCredits,
          effective_at: new Date().toISOString(),
          applied_at: invoiceState.paid
            ? new Date().toISOString()
            : null,
          stripe_subscription_id: addonSubscription.id,
          stripe_subscription_item_id: currentItem?.id ?? null,
          stripe_invoice_id: invoiceState.invoiceId,
          metadata: {
            addon_pool: addonPool,
            proration_behavior: "always_invoice",
            billing_cycle_anchor_preserved: true,
            invoice_status: invoiceState.invoiceStatus,
            payment_required: !invoiceState.paid,
          },
        });

        if (invoiceState.paid) {
          const synchronizedSubscription =
            await stripe.subscriptions.retrieve(
              addonSubscription.id,
            );

          await synchronizeOrganizationCreditAddons(
            adminClient,
            organizationId,
            synchronizedSubscription,
          );
        }

        return jsonResponse({
          success: true,
          paymentRequired: !invoiceState.paid,
          paymentUrl: invoiceState.paid
            ? null
            : invoiceState.paymentUrl,
          invoiceId: invoiceState.invoiceId,
          invoiceStatus: invoiceState.invoiceStatus,
          message: invoiceState.paid
            ? "The recurring AI-credit package is active."
            : "Stripe created the prorated AI-credit invoice through the existing billing date.",
        });
      }

      if (!addonSubscription) {
        throw new Error(
          "Reached an AI add-on decrease with no add-on subscription on file. This should be unreachable because a decrease requires currentCredits > 0.",
        );
      }

      const future = await getFutureScheduleItems(stripe, addonSubscription);
      const futureItems = replaceItemDefinition(
        future.items,
        allPoolPriceIds,
        requestedPriceId,
        requestedCredits > 0 ? 1 : 0,
      );

      if (futureItems.length === 0) {
        // The add-on subscription only ever carries add-on items (no plan or
        // seat items), so removing the last one would leave a schedule phase
        // with zero items, which Stripe rejects. Cancel the whole add-on
        // subscription at period end instead, same no-refund terms as any
        // other scheduled decrease.
        const existingScheduleId =
          typeof addonSubscription.schedule === "string"
            ? addonSubscription.schedule
            : addonSubscription.schedule?.id ?? null;

        if (existingScheduleId) {
          const existingSchedule =
            await stripe.subscriptionSchedules.retrieve(
              existingScheduleId,
            );

          if (existingSchedule.status !== "released") {
            await stripe.subscriptionSchedules.release(
              existingScheduleId,
            );
          }
        }

        const canceledAddonSubscription =
          await stripe.subscriptions.update(addonSubscription.id, {
            cancel_at_period_end: true,
          });

        const addonCancelEffectiveAt = unixToIso(
          getSubscriptionPeriodEnd(canceledAddonSubscription),
        );

        await recordChange(adminClient, {
          organization_id: organizationId,
          requested_by_user_id: caller.id,
          change_type:
            addonPool === "portal"
              ? "portal_credit_change"
              : "app_credit_change",
          change_status: "scheduled",
          current_addon_quantity: currentCredits,
          requested_addon_quantity: requestedCredits,
          effective_at: addonCancelEffectiveAt,
          stripe_subscription_id: addonSubscription.id,
          stripe_subscription_item_id: currentItem?.id ?? null,
          metadata: {
            addon_pool: addonPool,
            no_refund: true,
            effective_at_existing_renewal: true,
            addon_subscription_canceled: true,
          },
        });

        return jsonResponse({
          success: true,
          message:
            "The recurring AI-credit package will cancel at the existing renewal date. There is no refund for the prepaid period.",
        });
      }

      const scheduled = await scheduleItemsAtRenewal(
        stripe,
        addonSubscription,
        futureItems,
      );

      await recordChange(adminClient, {
        organization_id: organizationId,
        requested_by_user_id: caller.id,
        change_type:
          addonPool === "portal"
            ? "portal_credit_change"
            : "app_credit_change",
        change_status: "scheduled",
        current_addon_quantity: currentCredits,
        requested_addon_quantity: requestedCredits,
        effective_at: scheduled.effectiveAt,
        stripe_subscription_id: addonSubscription.id,
        stripe_subscription_item_id: currentItem?.id ?? null,
        stripe_schedule_id: scheduled.scheduleId,
        metadata: {
          addon_pool: addonPool,
          no_refund: true,
          effective_at_existing_renewal: true,
        },
      });

      return jsonResponse({
        success: true,
        message:
          requestedCredits === 0
            ? "The recurring AI-credit package will cancel at the existing renewal date."
            : "The smaller AI-credit package will begin at the existing renewal date.",
      });
    }

    if (action === "cancel_subscription") {
      const updatedSubscription = await stripe.subscriptions.update(
        subscription.id,
        {
          cancel_at_period_end: true,
        },
      );

      await adminClient
        .from("organizations")
        .update({
          stripe_cancel_at_period_end: true,
          pending_subscription_cancel_at: unixToIso(
            getSubscriptionPeriodEnd(updatedSubscription),
          ),
        })
        .eq("id", organizationId);

      await recordChange(adminClient, {
        organization_id: organizationId,
        requested_by_user_id: caller.id,
        change_type: "subscription_cancellation",
        change_status: "scheduled",
        effective_at: unixToIso(
          getSubscriptionPeriodEnd(updatedSubscription),
        ),
        stripe_subscription_id: subscription.id,
        metadata: {
          no_refund: true,
          access_continues_until_renewal: true,
        },
      });

      return jsonResponse({
        success: true,
        message:
          "The organization subscription will cancel at the end of the prepaid term. No refund or early credit will be issued.",
      });
    }

    if (action === "resume_subscription") {
      await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
      });

      await adminClient
        .from("organizations")
        .update({
          stripe_cancel_at_period_end: false,
          pending_subscription_cancel_at: null,
        })
        .eq("id", organizationId);

      await adminClient
        .from("organization_billing_change_requests")
        .update({
          change_status: "canceled",
          canceled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organizationId)
        .eq("change_type", "subscription_cancellation")
        .eq("change_status", "scheduled");

      return jsonResponse({
        success: true,
        message: "The scheduled subscription cancellation was removed.",
      });
    }

    return jsonResponse({ error: "Unsupported billing action." }, 400);
  } catch (error) {
    return jsonResponse(
      {
        error: sanitizeError(error),
      },
      500,
    );
  }
});
