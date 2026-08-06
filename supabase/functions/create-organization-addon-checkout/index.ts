import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  organizationId?: unknown;
  requestId?: unknown;
  portalCreditAddonProductKey?: unknown;
  appCreditAddonProductKey?: unknown;
};

type StripeCheckoutResponse = {
  id?: string;
  url?: string;
  error?: {
    message?: string;
  };
};

function jsonResponse(
  body: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    },
  );
}

function normalizeString(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

// Exported so tests can prove, against the real guard (not a re-implementation),
// that clearing stripe_addon_subscription_id after cancellation is exactly what
// allows a repurchase through this checkout.
export function hasExistingAddonSubscription(
  organization: { stripe_addon_subscription_id: string | null },
) {
  return Boolean(organization.stripe_addon_subscription_id);
}

function appendFormValue(
  form: URLSearchParams,
  key: string,
  value:
    | string
    | number
    | boolean
    | null
    | undefined,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return;
  }

  form.append(
    key,
    String(value),
  );
}

// Guarded so importing this module for hasExistingAddonSubscription (tests)
// does not also start a listener, which needs net permission and isn't
// available under `deno test`. Supabase's Edge Runtime executes this file as
// the entrypoint, so import.meta.main is still true when actually deployed.
if (import.meta.main) {
  Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      {
        error: "Method not allowed.",
      },
      405,
    );
  }

  const supabaseUrl =
    Deno.env.get("SUPABASE_URL");

  const anonKey =
    Deno.env.get(
      "SUPABASE_ANON_KEY",
    );

  const serviceRoleKey =
    Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    );

  const stripeSecretKey =
    Deno.env.get(
      "STRIPE_SECRET_KEY",
    );

  const portalUrl =
    Deno.env.get(
      "EVERWARD_ORGANIZATION_PORTAL_URL",
    ) ||
    "http://localhost:5173";

  if (
    !supabaseUrl ||
    !anonKey ||
    !serviceRoleKey ||
    !stripeSecretKey
  ) {
    return jsonResponse(
      {
        error:
          "Organization billing is not fully configured.",
      },
      500,
    );
  }

  const authorization =
    request.headers.get(
      "Authorization",
    );

  if (!authorization) {
    return jsonResponse(
      {
        error:
          "You must be signed in.",
      },
      401,
    );
  }

  const callerClient =
    createClient(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization:
              authorization,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

  const adminClient =
    createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

  const {
    data: {
      user,
    },
    error: userError,
  } =
    await callerClient.auth.getUser();

  if (
    userError ||
    !user
  ) {
    return jsonResponse(
      {
        error:
          "Your signed-in account could not be verified.",
      },
      401,
    );
  }

  let body: RequestBody;

  try {
    body =
      await request.json();
  } catch {
    return jsonResponse(
      {
        error:
          "The AI checkout request is invalid.",
      },
      400,
    );
  }

  const organizationId =
    normalizeString(
      body.organizationId,
    );

  const requestId =
    normalizeString(
      body.requestId,
    );

  const portalProductKey =
    normalizeString(
      body.portalCreditAddonProductKey,
    );

  const appProductKey =
    normalizeString(
      body.appCreditAddonProductKey,
    );

  if (
    !isUuid(organizationId) ||
    !isUuid(requestId)
  ) {
    return jsonResponse(
      {
        error:
          "A valid organization and checkout request are required.",
      },
      400,
    );
  }

  const productKeys = [
    portalProductKey,
    appProductKey,
  ].filter(Boolean);

  if (productKeys.length === 0) {
    return jsonResponse(
      {
        error:
          "Select at least one AI credit package.",
      },
      400,
    );
  }

  const [
    membershipResult,
    organizationResult,
    productsResult,
  ] =
    await Promise.all([
      adminClient
        .from(
          "organization_users",
        )
        .select(
          "role, is_active, billing_access_enabled",
        )
        .eq(
          "organization_id",
          organizationId,
        )
        .eq(
          "user_id",
          user.id,
        )
        .eq(
          "is_active",
          true,
        )
        .maybeSingle(),

      adminClient
        .from("organizations")
        .select(
          `
            id,
            stripe_customer_id,
            stripe_subscription_id,
            stripe_addon_subscription_id
          `,
        )
        .eq(
          "id",
          organizationId,
        )
        .maybeSingle(),

      adminClient
        .from(
          "organization_billing_products",
        )
        .select(
          "product_key, stripe_price_id",
        )
        .in(
          "product_key",
          productKeys,
        )
        .eq(
          "active",
          true,
        ),
    ]);

  const membership =
    membershipResult.data;

  const hasPermission =
    membership?.is_active === true &&
    (
      membership.role ===
        "organization_admin" ||
      membership.role ===
        "billing_admin" ||
      membership
        .billing_access_enabled ===
        true
    );

  if (
    membershipResult.error ||
    !hasPermission
  ) {
    return jsonResponse(
      {
        error:
          "You do not have permission to purchase organization AI packages.",
      },
      403,
    );
  }

  const organization =
    organizationResult.data;

  if (
    organizationResult.error ||
    !organization
  ) {
    return jsonResponse(
      {
        error:
          "The organization could not be loaded.",
      },
      404,
    );
  }

  if (
    !organization
      .stripe_customer_id ||
    !organization
      .stripe_subscription_id
  ) {
    return jsonResponse(
      {
        error:
          "The organization subscription is still processing. Wait a few seconds and try again.",
      },
      409,
    );
  }

  if (hasExistingAddonSubscription(organization)) {
    return jsonResponse(
      {
        error:
          "This organization already has an AI add-on subscription. Manage it from organization billing.",
      },
      409,
    );
  }

  if (productsResult.error) {
    return jsonResponse(
      {
        error:
          "The selected AI packages could not be loaded.",
      },
      500,
    );
  }

  const products =
    productsResult.data ?? [];

  for (
    const productKey of productKeys
  ) {
    const product =
      products.find(
        (candidate) =>
          candidate.product_key ===
          productKey,
      );

    if (
      !product ||
      typeof product
        .stripe_price_id !==
        "string" ||
      !product.stripe_price_id
    ) {
      return jsonResponse(
        {
          error:
            `The selected AI package "${productKey}" is unavailable.`,
        },
        400,
      );
    }
  }

  const stripeForm =
    new URLSearchParams();

  appendFormValue(
    stripeForm,
    "mode",
    "subscription",
  );

  appendFormValue(
    stripeForm,
    "customer",
    organization
      .stripe_customer_id,
  );

  appendFormValue(
    stripeForm,
    "success_url",
    `${portalUrl}/?billing=addon-success`,
  );

  appendFormValue(
    stripeForm,
    "cancel_url",
    `${portalUrl}/?mode=ai-access&billing=addon-cancelled`,
  );

  appendFormValue(
    stripeForm,
    "client_reference_id",
    organizationId,
  );

  appendFormValue(
    stripeForm,
    "allow_promotion_codes",
    true,
  );

  products.forEach(
    (product, index) => {
      appendFormValue(
        stripeForm,
        `line_items[${index}][price]`,
        product.stripe_price_id,
      );

      appendFormValue(
        stripeForm,
        `line_items[${index}][quantity]`,
        1,
      );
    },
  );

  appendFormValue(
    stripeForm,
    "metadata[organization_id]",
    organizationId,
  );

  appendFormValue(
    stripeForm,
    "metadata[subscription_kind]",
    "ai_addons",
  );

  appendFormValue(
    stripeForm,
    "metadata[request_id]",
    requestId,
  );

  appendFormValue(
    stripeForm,
    "subscription_data[metadata][organization_id]",
    organizationId,
  );

  appendFormValue(
    stripeForm,
    "subscription_data[metadata][subscription_kind]",
    "ai_addons",
  );

  appendFormValue(
    stripeForm,
    "subscription_data[metadata][base_subscription_id]",
    organization
      .stripe_subscription_id,
  );

  const stripeResponse =
    await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${stripeSecretKey}`,
          "Content-Type":
            "application/x-www-form-urlencoded",
          "Idempotency-Key":
            `organization-addon-checkout-${requestId}`,
        },
        body: stripeForm,
      },
    );

  const stripeSession =
    (await stripeResponse.json()) as
      StripeCheckoutResponse;

  if (
    !stripeResponse.ok ||
    !stripeSession.id ||
    !stripeSession.url
  ) {
    return jsonResponse(
      {
        error:
          stripeSession.error
            ?.message ||
          "Stripe did not create the AI package Checkout Session.",
      },
      500,
    );
  }

  return jsonResponse({
    checkoutSessionId:
      stripeSession.id,
    checkoutUrl:
      stripeSession.url,
  });
  });
}
