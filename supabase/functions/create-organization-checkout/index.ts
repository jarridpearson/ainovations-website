import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CheckoutRequest = {
  organizationId?: unknown;
  requestId?: unknown;
  planKey?: unknown;
  billingInterval?: unknown;
  seatQuantity?: unknown;
};

type StripeCheckoutSession = {
  id?: string;
  url?: string;
  customer?: string | null;
  error?: {
    message?: string;
  };
};

function jsonResponse(body: unknown, status: number) {
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function sanitizeError(error: unknown) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "The organization checkout session could not be created.";

  return rawMessage
    .replace(/sk_(test|live)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 1000);
}

function appendFormValue(
  form: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined,
) {
  if (value === null || value === undefined) {
    return;
  }

  form.append(key, String(value));
}

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const portalUrl =
    Deno.env.get("EVERWARD_ORGANIZATION_PORTAL_URL") ||
    "http://localhost:5173";

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    !supabaseServiceRoleKey ||
    !stripeSecretKey
  ) {
    return jsonResponse(
      {
        error: "Organization billing is not fully configured.",
      },
      500,
    );
  }

  const authorizationHeader = request.headers.get("Authorization");

  if (!authorizationHeader) {
    return jsonResponse(
      {
        error: "You must be signed in.",
      },
      401,
    );
  }

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
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

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
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
    return jsonResponse(
      {
        error: "Your signed-in account could not be verified.",
      },
      401,
    );
  }

  let requestBody: CheckoutRequest;

  try {
    requestBody = (await request.json()) as CheckoutRequest;
  } catch {
    return jsonResponse(
      {
        error: "The checkout request body is not valid JSON.",
      },
      400,
    );
  }

  const organizationId = normalizeString(requestBody.organizationId);
  const requestId = normalizeString(requestBody.requestId);
  const planKey = normalizeString(requestBody.planKey);
  const billingInterval = normalizeString(requestBody.billingInterval);
  const seatQuantity = Number(requestBody.seatQuantity);

  if (!isUuid(organizationId)) {
    return jsonResponse(
      {
        error: "A valid organization ID is required.",
      },
      400,
    );
  }

  if (!isUuid(requestId)) {
    return jsonResponse(
      {
        error: "A valid checkout request ID is required.",
      },
      400,
    );
  }

  if (!["organization_starter", "organization_pro"].includes(planKey)) {
    return jsonResponse(
      {
        error: "Select Organization Starter or Organization Pro.",
      },
      400,
    );
  }

  if (!["monthly", "annual"].includes(billingInterval)) {
    return jsonResponse(
      {
        error: "Select monthly or annual billing.",
      },
      400,
    );
  }

  if (
    !Number.isInteger(seatQuantity) ||
    seatQuantity < 1 ||
    seatQuantity > 10000
  ) {
    return jsonResponse(
      {
        error: "Seat quantity must be a whole number between 1 and 10,000.",
      },
      400,
    );
  }

  const [membershipResult, organizationResult, usedSeatResult, pricesResult] =
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
            stripe_customer_id,
            subscription_status,
            paid_seat_count
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

      adminClient
        .from("stripe_billing_prices")
        .select(
          `
            component_key,
            stripe_price_id,
            active
          `,
        )
        .eq("plan_key", planKey)
        .eq("billing_interval", billingInterval)
        .eq("active", true)
        .in("component_key", ["portal_base", "user_seat"]),
    ]);

  const membership = membershipResult.data;

  const hasBillingPermission =
    membership?.is_active === true &&
    (membership.role === "organization_admin" ||
      membership.role === "billing_admin" ||
      membership.billing_access_enabled === true);

  if (membershipResult.error || !hasBillingPermission) {
    return jsonResponse(
      {
        error:
          "Only an Organization Admin or a user with billing access can manage this subscription.",
      },
      403,
    );
  }

  if (organizationResult.error || !organizationResult.data) {
    return jsonResponse(
      {
        error: "The organization could not be loaded.",
      },
      404,
    );
  }

  if (usedSeatResult.error) {
    return jsonResponse(
      {
        error: "Current organization seat usage could not be verified.",
      },
      500,
    );
  }

  const usedSeatCount = Math.max(0, Number(usedSeatResult.count ?? 0));

  if (seatQuantity < usedSeatCount) {
    return jsonResponse(
      {
        error: `This organization currently uses ${usedSeatCount} seats. The purchased quantity cannot be reduced below current usage.`,
        usedSeatCount,
      },
      409,
    );
  }

  if (pricesResult.error) {
    return jsonResponse(
      {
        error: "The Stripe prices for this organization plan could not be loaded.",
      },
      500,
    );
  }

  const portalBasePrice = pricesResult.data?.find(
    (price) => price.component_key === "portal_base",
  );

  const userSeatPrice = pricesResult.data?.find(
    (price) => price.component_key === "user_seat",
  );

  if (!portalBasePrice?.stripe_price_id || !userSeatPrice?.stripe_price_id) {
    return jsonResponse(
      {
        error:
          "Stripe price mapping is not configured for the selected organization plan and billing interval.",
      },
      409,
    );
  }

  const { data: existingRequest, error: existingRequestError } =
    await adminClient
      .from("organization_checkout_requests")
      .select(
        `
          stripe_checkout_session_id,
          stripe_checkout_url,
          request_status,
          error_message
        `,
      )
      .eq("organization_id", organizationId)
      .eq("requested_by_user_id", caller.id)
      .eq("request_id", requestId)
      .maybeSingle();

  if (existingRequestError) {
    return jsonResponse(
      {
        error: "The existing checkout request could not be checked.",
      },
      500,
    );
  }

  if (
    existingRequest?.request_status === "created" &&
    existingRequest.stripe_checkout_url
  ) {
    return jsonResponse(
      {
        checkoutSessionId: existingRequest.stripe_checkout_session_id,
        checkoutUrl: existingRequest.stripe_checkout_url,
        duplicateRequest: true,
      },
      200,
    );
  }

  if (!existingRequest) {
    const { error: insertRequestError } = await adminClient
      .from("organization_checkout_requests")
      .insert({
        organization_id: organizationId,
        requested_by_user_id: caller.id,
        request_id: requestId,
        plan_key: planKey,
        billing_interval: billingInterval,
        seat_quantity: seatQuantity,
        request_status: "pending",
      });

    if (insertRequestError) {
      return jsonResponse(
        {
          error: "The checkout request could not be recorded.",
        },
        500,
      );
    }
  }

  try {
    const organization = organizationResult.data;
    const stripeForm = new URLSearchParams();

    appendFormValue(stripeForm, "mode", "subscription");
    appendFormValue(stripeForm, "success_url", `${portalUrl}/?billing=success`);
    appendFormValue(stripeForm, "cancel_url", `${portalUrl}/?billing=cancelled`);
    appendFormValue(stripeForm, "client_reference_id", organizationId);
    appendFormValue(stripeForm, "allow_promotion_codes", true);

    appendFormValue(
      stripeForm,
      "line_items[0][price]",
      portalBasePrice.stripe_price_id,
    );
    appendFormValue(stripeForm, "line_items[0][quantity]", 1);

    appendFormValue(
      stripeForm,
      "line_items[1][price]",
      userSeatPrice.stripe_price_id,
    );
    appendFormValue(stripeForm, "line_items[1][quantity]", seatQuantity);

    appendFormValue(
      stripeForm,
      "metadata[organization_id]",
      organizationId,
    );
    appendFormValue(stripeForm, "metadata[plan_key]", planKey);
    appendFormValue(
      stripeForm,
      "metadata[billing_interval]",
      billingInterval,
    );
    appendFormValue(
      stripeForm,
      "metadata[seat_quantity]",
      seatQuantity,
    );
    appendFormValue(
      stripeForm,
      "metadata[requested_by_user_id]",
      caller.id,
    );
    appendFormValue(stripeForm, "metadata[request_id]", requestId);

    appendFormValue(
      stripeForm,
      "subscription_data[metadata][organization_id]",
      organizationId,
    );
    appendFormValue(
      stripeForm,
      "subscription_data[metadata][plan_key]",
      planKey,
    );
    appendFormValue(
      stripeForm,
      "subscription_data[metadata][billing_interval]",
      billingInterval,
    );
    appendFormValue(
      stripeForm,
      "subscription_data[metadata][seat_quantity]",
      seatQuantity,
    );

    if (organization.stripe_customer_id) {
      appendFormValue(
        stripeForm,
        "customer",
        organization.stripe_customer_id,
      );
    } else if (caller.email) {
      appendFormValue(stripeForm, "customer_email", caller.email);
    }

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `organization-checkout-${requestId}`,
        },
        body: stripeForm,
      },
    );

    const stripeSession =
      (await stripeResponse.json()) as StripeCheckoutSession;

    if (
      !stripeResponse.ok ||
      !stripeSession.id ||
      !stripeSession.url
    ) {
      throw new Error(
        stripeSession.error?.message ||
          "Stripe did not create a usable Checkout Session.",
      );
    }

    const { error: updateRequestError } = await adminClient
      .from("organization_checkout_requests")
      .update({
        stripe_checkout_session_id: stripeSession.id,
        stripe_checkout_url: stripeSession.url,
        request_status: "created",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("requested_by_user_id", caller.id)
      .eq("request_id", requestId);

    if (updateRequestError) {
      throw new Error(
        updateRequestError.message ||
          "The created Checkout Session could not be recorded.",
      );
    }

    const { error: organizationUpdateError } = await adminClient
      .from("organizations")
      .update({
        stripe_checkout_session_id: stripeSession.id,
        stripe_billing_error: null,
      })
      .eq("id", organizationId);

    if (organizationUpdateError) {
      console.error(
        "Organization checkout session ID could not be stored:",
        organizationUpdateError,
      );
    }

    return jsonResponse(
      {
        checkoutSessionId: stripeSession.id,
        checkoutUrl: stripeSession.url,
        duplicateRequest: false,
      },
      200,
    );
  } catch (error) {
    const errorMessage = sanitizeError(error);

    await adminClient
      .from("organization_checkout_requests")
      .update({
        request_status: "failed",
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("requested_by_user_id", caller.id)
      .eq("request_id", requestId);

    await adminClient
      .from("organizations")
      .update({
        stripe_billing_error: errorMessage,
      })
      .eq("id", organizationId);

    return jsonResponse(
      {
        error: errorMessage,
      },
      500,
    );
  }
});
