import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PortalRequest = {
  organizationId?: unknown;
};

type StripePortalSession = {
  id?: string;
  url?: string;
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
        : "The Stripe billing portal could not be opened.";

  return rawMessage
    .replace(/sk_(test|live)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 1000);
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

  let requestBody: PortalRequest;

  try {
    requestBody = (await request.json()) as PortalRequest;
  } catch {
    return jsonResponse(
      {
        error: "The billing portal request body is not valid JSON.",
      },
      400,
    );
  }

  const organizationId = normalizeString(requestBody.organizationId);

  if (!isUuid(organizationId)) {
    return jsonResponse(
      {
        error: "A valid organization ID is required.",
      },
      400,
    );
  }

  const [membershipResult, organizationResult] = await Promise.all([
    adminClient
      .from("organization_users")
      .select("role, is_active, billing_access_enabled")
      .eq("organization_id", organizationId)
      .eq("user_id", caller.id)
      .eq("is_active", true)
      .maybeSingle(),

    adminClient
      .from("organizations")
      .select("id, stripe_customer_id")
      .eq("id", organizationId)
      .maybeSingle(),
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

  if (!organizationResult.data.stripe_customer_id) {
    return jsonResponse(
      {
        error:
          "This organization does not yet have a Stripe customer account. Complete subscription checkout first.",
      },
      409,
    );
  }

  try {
    const stripeForm = new URLSearchParams();

    stripeForm.append(
      "customer",
      organizationResult.data.stripe_customer_id,
    );
    stripeForm.append("return_url", `${portalUrl}/?billing=returned`);

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/billing_portal/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: stripeForm,
      },
    );

    const stripeSession =
      (await stripeResponse.json()) as StripePortalSession;

    if (!stripeResponse.ok || !stripeSession.id || !stripeSession.url) {
      throw new Error(
        stripeSession.error?.message ||
          "Stripe did not create a usable billing portal session.",
      );
    }

    return jsonResponse(
      {
        billingPortalSessionId: stripeSession.id,
        billingPortalUrl: stripeSession.url,
      },
      200,
    );
  } catch (error) {
    return jsonResponse(
      {
        error: sanitizeError(error),
      },
      500,
    );
  }
});
