import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: {
    get: (name: string) => string | undefined;
  };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ConflictCheckMode = "batch" | "deep";

type RunConflictCheckRequest = {
  organizationId?: unknown;
  requestId?: unknown;
  mode?: unknown;
  sideAUserIds?: unknown;
  sideBUserIds?: unknown;
};

type OrganizationMembership = {
  role: string;
  portal_access_enabled: boolean | null;
  billing_access_enabled: boolean | null;
  manager_portal_access_enabled: boolean | null;
  is_active: boolean;
};

type DirectoryUser = {
  user_id: string;
  full_name: string;
};

type ConflictResult = {
  person_a: string;
  priority_a: string;
  person_b: string;
  priority_b: string;
  explanation: string;
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUuidArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is string => typeof item === "string" && isUuid(item.trim()),
    )
    .map((item) => item.trim());
}

function canOpenPortal(membership: OrganizationMembership) {
  if (!membership.is_active) {
    return false;
  }

  if (
    membership.role === "organization_admin" ||
    membership.role === "user_admin"
  ) {
    return membership.portal_access_enabled === true;
  }

  if (membership.role === "group_manager") {
    return (
      membership.portal_access_enabled === true &&
      membership.manager_portal_access_enabled === true
    );
  }

  return false;
}

function canRunConflictCheck(membership: OrganizationMembership) {
  if (membership.role === "organization_admin") {
    return true;
  }

  if (membership.role === "user_admin") {
    return true;
  }

  if (membership.role === "group_manager") {
    return membership.manager_portal_access_enabled === true;
  }

  return false;
}

function getConflictCheckCreditCost(
  mode: ConflictCheckMode,
  sideACount: number,
  sideBCount: number,
) {
  if (mode === "batch") {
    return sideACount * 1;
  }

  return (sideACount + sideBCount) * 1;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(
      { error: "The organization conflict check service is not configured." },
      500,
    );
  }

  const authorizationHeader = request.headers.get("Authorization");

  if (!authorizationHeader) {
    return jsonResponse({ error: "You must be signed in." }, 401);
  }

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();

  if (callerError || !caller) {
    return jsonResponse({ error: "Your session is invalid or has expired." }, 401);
  }

  let requestBody: RunConflictCheckRequest;

  try {
    requestBody = (await request.json()) as RunConflictCheckRequest;
  } catch {
    return jsonResponse({ error: "The submitted request is not valid JSON." }, 400);
  }

  const organizationId = normalizeString(requestBody.organizationId);
  const requestId = normalizeString(requestBody.requestId);
  const mode = normalizeString(requestBody.mode) as ConflictCheckMode;

  if (!organizationId || !isUuid(organizationId)) {
    return jsonResponse({ error: "A valid organization ID is required." }, 400);
  }

  if (!requestId || !isUuid(requestId)) {
    return jsonResponse({ error: "A valid request ID is required." }, 400);
  }

  if (mode !== "batch" && mode !== "deep") {
    return jsonResponse({ error: "A valid check mode is required." }, 400);
  }

  const sideAUserIds = normalizeUuidArray(requestBody.sideAUserIds);
  const sideBUserIdsRaw = normalizeUuidArray(requestBody.sideBUserIds);
  const sideBUserIds = mode === "batch" ? [] : sideBUserIdsRaw;

  if (
    Array.isArray(requestBody.sideAUserIds) &&
    sideAUserIds.length !== requestBody.sideAUserIds.length
  ) {
    return jsonResponse({ error: "One or more selected people are invalid." }, 400);
  }

  if (
    mode === "deep" &&
    Array.isArray(requestBody.sideBUserIds) &&
    sideBUserIdsRaw.length !== requestBody.sideBUserIds.length
  ) {
    return jsonResponse({ error: "One or more selected people are invalid." }, 400);
  }

  if (sideAUserIds.length === 0) {
    return jsonResponse(
      { error: "Select at least one person to check." },
      400,
    );
  }

  if (mode === "batch" && sideBUserIdsRaw.length > 0) {
    return jsonResponse(
      { error: "Batch checks compare each selected person only against themselves." },
      400,
    );
  }

  const { data: membership, error: membershipError } = await adminClient
    .from("organization_users")
    .select(
      `role, portal_access_enabled, billing_access_enabled, manager_portal_access_enabled, is_active`,
    )
    .eq("organization_id", organizationId)
    .eq("user_id", caller.id)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipError || !membership) {
    return jsonResponse({ error: "You do not have access to this organization." }, 403);
  }

  const callerMembership = membership as OrganizationMembership;

  if (!canOpenPortal(callerMembership) || !canRunConflictCheck(callerMembership)) {
    return jsonResponse(
      {
        error:
          "Only an active company administrator or Group Manager with portal access can run an organization conflict check.",
      },
      403,
    );
  }

  const { data: organizationPlan, error: organizationPlanError } = await adminClient
    .from("organizations")
    .select("current_plan_key")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationPlanError) {
    return jsonResponse(
      { error: "The organization's plan could not be validated." },
      500,
    );
  }

  const conflictDetectionPlanKeys = new Set([
    "organization_starter",
    "organization_pro",
  ]);

  // Decision Intelligence is a Starter and Pro feature. The nav entry and
  // run buttons stay visible and clickable for every plan -- this is where
  // an unqualified plan gets a clear upgrade message instead of a silent
  // block.
  if (!conflictDetectionPlanKeys.has(organizationPlan?.current_plan_key ?? "")) {
    return jsonResponse(
      {
        error:
          "Decision Intelligence is available on the Starter and Pro organization plans. Upgrade the organization's plan to run conflict checks.",
        upgradeRequired: true,
      },
      403,
    );
  }

  const { data: directoryData, error: directoryError } = await callerClient.rpc(
    "get_organization_user_directory",
    { p_organization_id: organizationId },
  );

  if (directoryError) {
    return jsonResponse(
      { error: "The authorized organization users could not be validated." },
      500,
    );
  }

  const directoryUsers = (directoryData ?? []) as DirectoryUser[];
  const directoryByUserId = new Map(
    directoryUsers.map((user) => [user.user_id, user.full_name]),
  );

  const allSelectedUserIds = [...sideAUserIds, ...sideBUserIds];

  if (allSelectedUserIds.some((userId) => !directoryByUserId.has(userId))) {
    return jsonResponse(
      { error: "One or more selected people are outside your authorized organization scope." },
      403,
    );
  }

  const creditCost = getConflictCheckCreditCost(
    mode,
    sideAUserIds.length,
    sideBUserIds.length,
  );

  const { data: insertedCheck, error: insertError } = await adminClient
    .from("organization_conflict_checks")
    .insert({
      organization_id: organizationId,
      requested_by_user_id: caller.id,
      request_id: requestId,
      mode,
      side_a_user_ids: sideAUserIds,
      side_b_user_ids: sideBUserIds,
      status: "pending",
    })
    .select(`id, organization_id, mode, status, created_at`)
    .single();

  if (insertError || !insertedCheck) {
    if (insertError?.code === "23505") {
      const { data: existingCheck, error: existingCheckError } = await adminClient
        .from("organization_conflict_checks")
        .select(
          `id, mode, status, credit_status, credits_used, result_json, error_message, created_at, completed_at`,
        )
        .eq("organization_id", organizationId)
        .eq("requested_by_user_id", caller.id)
        .eq("request_id", requestId)
        .maybeSingle();

      if (existingCheckError || !existingCheck) {
        return jsonResponse(
          { error: "The existing conflict check could not be loaded." },
          500,
        );
      }

      return jsonResponse(
        {
          message: "This conflict check request was already received.",
          duplicateRequest: true,
          check: existingCheck,
        },
        200,
      );
    }

    console.error("Organization conflict check could not be created:", insertError);

    return jsonResponse({ error: "The conflict check could not be created." }, 500);
  }

  const openAiApiKey = Deno.env.get("ORGANIZATION_PORTAL_AI_OPENAI_API_KEY");
  const openAiModel = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";

  if (!openAiApiKey) {
    await adminClient
      .from("organization_conflict_checks")
      .update({
        status: "failed",
        credit_status: "not_charged",
        error_message: "The organization portal AI OpenAI key is not configured.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", insertedCheck.id);

    return jsonResponse(
      {
        error: "The organization AI service does not have an OpenAI API key configured.",
        checkId: insertedCheck.id,
      },
      500,
    );
  }

  const { data: creditResult, error: creditError } = await adminClient.rpc(
    "consume_organization_portal_credits",
    {
      p_organization_id: organizationId,
      p_user_id: caller.id,
      p_credit_cost: creditCost,
      p_event_type: "organization_portal_conflict_check",
      p_feature_key:
        mode === "batch" ? "conflict_check_batch" : "conflict_check_deep",
      p_route: "decision-intelligence",
      p_metadata: {
        check_id: insertedCheck.id,
        request_id: requestId,
        mode,
        side_a_count: sideAUserIds.length,
        side_b_count: sideBUserIds.length,
      },
    },
  );

  if (creditError) {
    await adminClient
      .from("organization_conflict_checks")
      .update({
        status: "failed",
        credit_status: "not_charged",
        error_message:
          creditError.message || "The portal AI credit could not be charged.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", insertedCheck.id);

    return jsonResponse(
      {
        error: creditError.message || "The portal AI credit could not be charged.",
        checkId: insertedCheck.id,
      },
      402,
    );
  }

  const chargedCreditResult = Array.isArray(creditResult)
    ? (creditResult[0] ?? null)
    : creditResult;

  await adminClient
    .from("organization_conflict_checks")
    .update({ credit_status: "charged", credits_used: creditCost })
    .eq("id", insertedCheck.id);

  try {
    const { data: priorityData, error: priorityError } = await adminClient
      .from("priorities")
      .select("id, user_id, title, target, timeframe, resource_type")
      .in("user_id", allSelectedUserIds)
      .eq("status", "active");

    if (priorityError) {
      throw priorityError;
    }

    const prioritiesByUserId = new Map<string, typeof priorityData>();

    for (const priority of priorityData ?? []) {
      const existing = prioritiesByUserId.get(priority.user_id) ?? [];
      existing.push(priority);
      prioritiesByUserId.set(priority.user_id, existing);
    }

    const buildPersonPayload = (userId: string) => ({
      user_id: userId,
      full_name: directoryByUserId.get(userId) ?? "Unnamed user",
      active_priorities: (prioritiesByUserId.get(userId) ?? []).map(
        (priority) => ({
          title: priority.title,
          target: priority.target,
          timeframe: priority.timeframe,
          resource_type: priority.resource_type,
        }),
      ),
    });

    const sideAPayload = sideAUserIds.map(buildPersonPayload);
    const sideBPayload = sideBUserIds.map(buildPersonPayload);

    const promptPayload =
      mode === "batch"
        ? { mode, people: sideAPayload }
        : { mode, side_a: sideAPayload, side_b: sideBPayload };

    const instructions =
      mode === "batch"
        ? `You are Everward's organization conflict detection engine. ` +
          `For each person in "people", compare that person's own active_priorities against each other only -- never compare across different people. ` +
          `Each active_priority may include a target, timeframe, and resource_type. ` +
          `Only flag two of a person's own priorities as conflicting if they cannot both realistically succeed as currently defined -- for example, both compete for the same limited resource_type in overlapping timeframes, or one target works against the other. ` +
          `Every flagged conflict must name the person and both specific priority titles, and state the resource or outcome mechanism causing the conflict in one or two plain sentences. Never return a generic warning. ` +
          `If a person has no conflicting priorities, or there is not enough target/timeframe/resource_type detail to judge, do not include that person in the results. ` +
          `Return valid JSON only, no prose, in exactly this shape: {"conflicts": [{"person_a": "full name", "priority_a": "priority title", "person_b": "the same full name", "priority_b": "the other priority title", "explanation": "one or two plain sentences"}]}. ` +
          `Do not invent a conflict to fill the field.`
        : `You are Everward's organization conflict detection engine. ` +
          `Compare the active_priorities of each person in "side_a" against each person in "side_b". ` +
          `If side_b is empty, instead compare each person in "side_a" against every other person in "side_a" (do not compare a person against themselves). ` +
          `Each active_priority may include a target, timeframe, and resource_type. ` +
          `Only flag two priorities (from two different people) as conflicting if they cannot both realistically succeed as currently defined -- for example, both compete for the same limited resource_type in overlapping timeframes, or one target works against the other. ` +
          `Every flagged conflict must name both specific people and both specific priority titles, and state the resource or outcome mechanism causing the conflict in one or two plain sentences. Never return a generic warning. ` +
          `If there is no conflict between two people, or not enough target/timeframe/resource_type detail to judge, do not include that pair in the results. ` +
          `Return valid JSON only, no prose, in exactly this shape: {"conflicts": [{"person_a": "full name", "priority_a": "priority title", "person_b": "the other full name", "priority_b": "the other priority title", "explanation": "one or two plain sentences"}]}. ` +
          `Do not invent a conflict to fill the field.`;

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel,
        store: false,
        instructions,
        input: JSON.stringify(promptPayload),
      }),
    });

    const openAiBody = (await openAiResponse.json()) as {
      error?: { message?: string };
      model?: string;
      output_text?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };

    if (!openAiResponse.ok) {
      throw new Error(
        openAiBody.error?.message || "OpenAI could not run the conflict check.",
      );
    }

    const rawText =
      openAiBody.output_text?.trim() ||
      openAiBody.output
        ?.flatMap((item) => item.content ?? [])
        .filter((item) => item.type === "output_text")
        .map((item) => item.text ?? "")
        .join("\n")
        .trim() ||
      "";

    if (!rawText) {
      throw new Error("OpenAI returned an empty conflict check result.");
    }

    let parsedConflicts: ConflictResult[];

    try {
      const parsed = JSON.parse(rawText);

      if (!Array.isArray(parsed?.conflicts)) {
        throw new Error("not an array");
      }

      parsedConflicts = parsed.conflicts.filter(
        (conflict: unknown): conflict is ConflictResult =>
          typeof conflict === "object" &&
          conflict !== null &&
          typeof (conflict as any).person_a === "string" &&
          typeof (conflict as any).priority_a === "string" &&
          typeof (conflict as any).person_b === "string" &&
          typeof (conflict as any).priority_b === "string" &&
          typeof (conflict as any).explanation === "string",
      );
    } catch {
      throw new Error("OpenAI returned an invalid conflict check result.");
    }

    const promptTokens = Math.max(0, Number(openAiBody.usage?.input_tokens ?? 0));
    const completionTokens = Math.max(
      0,
      Number(openAiBody.usage?.output_tokens ?? 0),
    );
    const completedAt = new Date().toISOString();

    const { error: updateError } = await adminClient
      .from("organization_conflict_checks")
      .update({
        status: "completed",
        result_json: { conflicts: parsedConflicts },
        model_used: openAiBody.model?.trim() || openAiModel,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        credit_status: "charged",
        error_message: null,
        completed_at: completedAt,
      })
      .eq("id", insertedCheck.id);

    if (updateError) {
      throw updateError;
    }

    return jsonResponse(
      {
        message: "The organization conflict check completed successfully.",
        checkId: insertedCheck.id,
        mode,
        conflicts: parsedConflicts,
        creditsUsed: creditCost,
        portalCredits: chargedCreditResult ?? null,
        completedAt,
      },
      200,
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "The organization conflict check could not be completed.";

    console.error("Organization conflict check failed:", errorMessage);

    const failedAt = new Date().toISOString();

    await adminClient
      .from("organization_conflict_checks")
      .update({
        status: "failed",
        credit_status: "charged",
        credits_used: creditCost,
        error_message: errorMessage,
        completed_at: failedAt,
      })
      .eq("id", insertedCheck.id);

    const { data: refundResult, error: refundError } = await adminClient.rpc(
      "refund_organization_portal_credits",
      {
        p_organization_id: organizationId,
        p_user_id: caller.id,
        p_credit_cost: creditCost,
        p_event_type: "organization_portal_conflict_check_refund",
        p_feature_key:
          mode === "batch" ? "conflict_check_batch" : "conflict_check_deep",
        p_route: "decision-intelligence",
        p_metadata: {
          check_id: insertedCheck.id,
          request_id: requestId,
          mode,
          failure_reason: errorMessage,
        },
      },
    );

    if (refundError) {
      console.error(
        "Organization conflict check credit could not be refunded:",
        refundError,
      );

      return jsonResponse(
        {
          error: errorMessage,
          checkId: insertedCheck.id,
          creditsUsed: creditCost,
          creditStatus: "charged",
          creditRefundError:
            refundError.message || "The portal AI credit could not be refunded.",
          failedAt,
        },
        500,
      );
    }

    const refundedCreditResult = Array.isArray(refundResult)
      ? (refundResult[0] ?? null)
      : refundResult;

    const refundedAt = new Date().toISOString();

    await adminClient
      .from("organization_conflict_checks")
      .update({
        credit_status: "refunded",
        credits_used: 0,
      })
      .eq("id", insertedCheck.id);

    return jsonResponse(
      {
        error: errorMessage,
        checkId: insertedCheck.id,
        creditsUsed: 0,
        creditStatus: "refunded",
        portalCredits: refundedCreditResult ?? null,
        failedAt,
        refundedAt,
      },
      500,
    );
  }
});
