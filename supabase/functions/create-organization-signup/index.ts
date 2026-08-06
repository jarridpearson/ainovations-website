import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SignupRequest = {
  organizationName?: unknown;
  contactName?: unknown;
  planKey?: unknown;
  billingInterval?: unknown;
  seatQuantity?: unknown;
  portalCreditAddonProductKey?: unknown;
  appCreditAddonProductKey?: unknown;
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizeString(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : "";
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
  const supabaseAnonKey =
    Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    !supabaseServiceRoleKey
  ) {
    return jsonResponse(
      {
        error:
          "The organization signup service is not configured.",
      },
      500,
    );
  }

  const authorization =
    request.headers.get("Authorization") ?? "";

  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse(
      {
        error:
          "Sign in or create your account before starting checkout.",
      },
      401,
    );
  }

  const accessToken = authorization.slice(
    "Bearer ".length,
  );

  const userClient = createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    },
  );

  const adminClient = createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser(accessToken);

  if (userError || !user) {
    return jsonResponse(
      {
        error:
          "Your session is invalid. Sign in again.",
      },
      401,
    );
  }

  let requestBody: SignupRequest;

  try {
    requestBody =
      (await request.json()) as SignupRequest;
  } catch {
    return jsonResponse(
      {
        error: "Invalid signup request.",
      },
      400,
    );
  }

  const organizationName = normalizeString(
    requestBody.organizationName,
  );

  const contactName = normalizeString(
    requestBody.contactName,
  );

  const planKey = normalizeString(
    requestBody.planKey,
  );

  const billingInterval = normalizeString(
    requestBody.billingInterval,
  );

  const seatQuantity = Number(
    requestBody.seatQuantity,
  );

  const portalCreditAddonProductKey =
    normalizeString(
      requestBody.portalCreditAddonProductKey,
    );

  const appCreditAddonProductKey =
    normalizeString(
      requestBody.appCreditAddonProductKey,
    );

  if (!organizationName) {
    return jsonResponse(
      {
        error: "Enter the organization name.",
      },
      400,
    );
  }

  if (
    planKey !== "organization_starter" &&
    planKey !== "organization_pro"
  ) {
    return jsonResponse(
      {
        error:
          "Select Organization Starter or Organization Pro.",
      },
      400,
    );
  }

  if (
    billingInterval !== "monthly" &&
    billingInterval !== "annual"
  ) {
    return jsonResponse(
      {
        error:
          "Select monthly or annual billing.",
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
        error:
          "Active-user quantity must be between 1 and 10,000.",
      },
      400,
    );
  }

  if (
    portalCreditAddonProductKey &&
    !(
      portalCreditAddonProductKey
        .toLowerCase()
        .includes("portal") &&
      portalCreditAddonProductKey
        .toLowerCase()
        .includes("credit")
    )
  ) {
    return jsonResponse(
      {
        error:
          "The selected portal AI credit add-on is invalid.",
      },
      400,
    );
  }

  if (
    appCreditAddonProductKey &&
    !(
      appCreditAddonProductKey
        .toLowerCase()
        .includes("app") &&
      appCreditAddonProductKey
        .toLowerCase()
        .includes("credit") &&
      !appCreditAddonProductKey
        .toLowerCase()
        .includes("portal")
    )
  ) {
    return jsonResponse(
      {
        error:
          "The selected shared app AI credit add-on is invalid.",
      },
      400,
    );
  }

  const { data: existingMemberships, error:
    existingMembershipError } =
    await adminClient
      .from("organization_users")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("is_active", true);

  if (existingMembershipError) {
    console.error(
      "Existing organization membership lookup failed:",
      existingMembershipError,
    );

    return jsonResponse(
      {
        error:
          "Unable to check your organization access.",
      },
      500,
    );
  }

  let organizationId = "";

  for (const membership of existingMemberships ?? []) {
    if (!membership.organization_id) {
      continue;
    }

    const { data: existingOrganization } =
      await adminClient
        .from("organizations")
        .select(
          "id, subscription_status, setup_complete",
        )
        .eq(
          "id",
          membership.organization_id,
        )
        .maybeSingle();

    if (!existingOrganization) {
      continue;
    }

    if (
      existingOrganization.subscription_status ===
      "active"
    ) {
      return jsonResponse(
        {
          error:
            "This account already belongs to an active organization.",
        },
        409,
      );
    }

    organizationId =
      existingOrganization.id;

    break;
  }

  if (!organizationId) {
    const {
      data: createdOrganization,
      error: organizationError,
    } = await adminClient
      .from("organizations")
      .insert({
        name: organizationName,
        owner_id: user.id,
        main_contact_name:
          contactName || null,
        main_contact_email:
          user.email ?? null,
        billing_email:
          user.email ?? null,
        current_plan_key: planKey,
        billing_interval:
          billingInterval,
        requested_seat_count:
          seatQuantity,
        paid_seat_count: 0,
        seat_limit: 0,
        seat_used: 0,
        onboarding_stage:
          "not_started",
        setup_complete: false,
        subscription_status:
          "incomplete",
      })
      .select("id")
      .single();

    if (
      organizationError ||
      !createdOrganization
    ) {
      console.error(
        "Organization creation failed:",
        organizationError,
      );

      return jsonResponse(
        {
          error:
            organizationError?.message ||
            "Unable to create the organization.",
        },
        500,
      );
    }

    organizationId =
      createdOrganization.id;

    const { error: membershipError } =
      await adminClient
        .from("organization_users")
        .insert({
          organization_id:
            organizationId,
          user_id: user.id,
          role: "organization_admin",
          is_active: true,
          is_billable: false,
          portal_access_enabled: true,
          billing_access_enabled: true,
          can_add_users: true,
          can_remove_users: true,
          can_assign_admins: true,
          can_manage_groups: true,
          can_purchase_seats: true,
          can_view_ai_credits: true,
          manager_portal_access_enabled:
            true,
        });

    if (membershipError) {
      console.error(
        "Organization admin creation failed:",
        membershipError,
      );

      await adminClient
        .from("organizations")
        .delete()
        .eq("id", organizationId);

      return jsonResponse(
        {
          error:
            membershipError.message ||
            "Unable to create the organization administrator.",
        },
        500,
      );
    }
  } else {
    const { error: updateError } =
      await adminClient
        .from("organizations")
        .update({
          name: organizationName,
          main_contact_name:
            contactName || null,
          main_contact_email:
            user.email ?? null,
          billing_email:
            user.email ?? null,
          current_plan_key: planKey,
          billing_interval:
            billingInterval,
          requested_seat_count:
            seatQuantity,
        })
        .eq("id", organizationId);

    if (updateError) {
      return jsonResponse(
        {
          error:
            updateError.message ||
            "Unable to update the pending organization.",
        },
        500,
      );
    }
  }

  const requestId = crypto.randomUUID();

  const {
    error: checkoutRequestError,
  } = await adminClient
    .from("organization_checkout_requests")
    .insert({
      organization_id: organizationId,
      requested_by_user_id: user.id,
      request_id: requestId,
      request_status: "pending",
      plan_key: planKey,
      billing_interval:
        billingInterval,
      seat_quantity: seatQuantity,
      portal_credit_addon_product_key:
        portalCreditAddonProductKey ||
        null,
      app_credit_addon_product_key:
        appCreditAddonProductKey ||
        null,
    });

  if (checkoutRequestError) {
    console.error(
      "Checkout request creation failed:",
      checkoutRequestError,
    );

    return jsonResponse(
      {
        error:
          checkoutRequestError.message ||
          "Unable to prepare Stripe Checkout.",
      },
      500,
    );
  }

  const checkoutResponse = await fetch(
    `${supabaseUrl}/functions/v1/create-organization-checkout`,
    {
      method: "POST",
      headers: {
        Authorization: authorization,
        apikey: supabaseAnonKey,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        organizationId,
        requestId,
        planKey,
        billingInterval,
        seatQuantity,
        portalCreditAddonProductKey,
        appCreditAddonProductKey,
      }),
    },
  );

  const checkoutBody =
    await checkoutResponse.json().catch(
      () => ({}),
    );

  if (!checkoutResponse.ok) {
    console.error(
      "Stripe Checkout creation failed:",
      checkoutBody,
    );

    return jsonResponse(
      {
        error:
          typeof checkoutBody.error ===
          "string"
            ? checkoutBody.error
            : "Unable to start Stripe Checkout.",
      },
      checkoutResponse.status,
    );
  }

  return jsonResponse({
    organizationId,
    requestId,
    checkoutUrl:
      checkoutBody.checkoutUrl ??
      checkoutBody.checkout_url ??
      checkoutBody.url,
  });
});
