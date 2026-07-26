// @ts-expect-error Supabase Edge Functions resolve URL imports through Deno.
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

const allowedViews = new Set([
  "overview",
  "users",
  "groups",
  "billing",
  "reports",
    "analyze",
  "settings",
]);

type PortalView =
  "overview" | "users" | "groups" | "billing" | "reports" | "settings";

type AskOrganizationDataRequest = {
  organizationId?: unknown;
  requestId?: unknown;
  portalView?: unknown;
  question?: unknown;
  selectedUserIds?: unknown;
  selectedGroupIds?: unknown;
  userSearchQuery?: unknown;
  userStatusFilter?: unknown;
  userAccessFilter?: unknown;
  groupSearchQuery?: unknown;
  reportDetailSearchQuery?: unknown;
};

type OrganizationMembership = {
  role: string;
  portal_access_enabled: boolean | null;
  billing_access_enabled: boolean | null;
  manager_portal_access_enabled: boolean | null;
  is_active: boolean;
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

  if (membership.role === "billing_admin") {
    return (
      membership.portal_access_enabled === true ||
      membership.billing_access_enabled === true
    );
  }

  if (membership.role === "group_manager") {
    return (
      membership.portal_access_enabled === true &&
      membership.manager_portal_access_enabled === true
    );
  }

  return false;
}

function canViewPortalSection(
  membership: OrganizationMembership,
  portalView: PortalView,
) {
  const role = membership.role;
  const hasBillingAccess =
    role === "billing_admin" || membership.billing_access_enabled === true;

  if (role === "organization_admin") {
    return true;
  }

  if (portalView === "overview") {
    return true;
  }

  if (portalView === "billing") {
    return hasBillingAccess;
  }

  if (role === "user_admin") {
    return (
      portalView === "users" ||
      portalView === "groups" ||
      portalView === "reports"
    );
  }

  if (role === "group_manager") {
    return (
      membership.manager_portal_access_enabled === true &&
      portalView === "reports"
    );
  }

  return false;
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

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(
      {
        error: "The organization AI question service is not configured.",
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
        error: "Your session is invalid or has expired.",
      },
      401,
    );
  }

  let requestBody: AskOrganizationDataRequest;

  try {
    requestBody = (await request.json()) as AskOrganizationDataRequest;
  } catch {
    return jsonResponse(
      {
        error: "The submitted request is not valid JSON.",
      },
      400,
    );
  }

  const organizationId = normalizeString(requestBody.organizationId);

  const requestId = normalizeString(requestBody.requestId);

  const portalView = normalizeString(requestBody.portalView) as PortalView;

  const question = normalizeString(requestBody.question);

  if (!organizationId || !isUuid(organizationId)) {
    return jsonResponse(
      {
        error: "A valid organization ID is required.",
      },
      400,
    );
  }

  if (!requestId || !isUuid(requestId)) {
    return jsonResponse(
      {
        error: "A valid request ID is required.",
      },
      400,
    );
  }

  if (!allowedViews.has(portalView)) {
    return jsonResponse(
      {
        error: "A valid portal view is required.",
      },
      400,
    );
  }

  if (!question) {
    return jsonResponse(
      {
        error: "Enter a question.",
      },
      400,
    );
  }

  if (question.length > 4000) {
    return jsonResponse(
      {
        error: "The question must contain 4,000 characters or fewer.",
      },
      400,
    );
  }

  const { data: membership, error: membershipError } = await adminClient
    .from("organization_users")
    .select(
      `
          role,
          portal_access_enabled,
          billing_access_enabled,
          manager_portal_access_enabled,
          is_active
        `,
    )
    .eq("organization_id", organizationId)
    .eq("user_id", caller.id)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipError || !membership) {
    return jsonResponse(
      {
        error: "You do not have access to this organization.",
      },
      403,
    );
  }

  const callerMembership = membership as OrganizationMembership;

  if (!canOpenPortal(callerMembership)) {
    return jsonResponse(
      {
        error: "Organization portal access is not enabled for this account.",
      },
      403,
    );
  }

  if (
    ![
      "organization_admin",
      "user_admin",
      "billing_admin",
      "group_manager",
    ].includes(callerMembership.role)
  ) {
    return jsonResponse(
      {
        error:
          "Only an active company administrator or Group Manager can use organization portal AI.",
      },
      403,
    );
  }

  if (!canViewPortalSection(callerMembership, portalView)) {
    return jsonResponse(
      {
        error:
          "You do not have permission to ask questions about this portal section.",
      },
      403,
    );
  }

  const selectedUserIds = normalizeUuidArray(requestBody.selectedUserIds);

  const selectedGroupIds = normalizeUuidArray(requestBody.selectedGroupIds);

  if (
    Array.isArray(requestBody.selectedUserIds) &&
    selectedUserIds.length !== requestBody.selectedUserIds.length
  ) {
    return jsonResponse(
      {
        error: "One or more selected user IDs are invalid.",
      },
      400,
    );
  }

  if (
    Array.isArray(requestBody.selectedGroupIds) &&
    selectedGroupIds.length !== requestBody.selectedGroupIds.length
  ) {
    return jsonResponse(
      {
        error: "One or more selected group IDs are invalid.",
      },
      400,
    );
  }

  if (selectedUserIds.length > 0 || selectedGroupIds.length > 0) {
    const [visibleUsersResult, visibleGroupsResult] = await Promise.all([
      callerClient.rpc("get_organization_user_directory", {
        p_organization_id: organizationId,
      }),
      callerClient.rpc("get_organization_visible_groups", {
        p_organization_id: organizationId,
      }),
    ]);

    if (visibleUsersResult.error) {
      return jsonResponse(
        {
          error: "The authorized organization users could not be validated.",
        },
        500,
      );
    }

    if (visibleGroupsResult.error) {
      return jsonResponse(
        {
          error: "The authorized organization groups could not be validated.",
        },
        500,
      );
    }

    const visibleUserIds = new Set(
      (visibleUsersResult.data ?? [])
        .map((user: { user_id?: unknown }) =>
          typeof user.user_id === "string" ? user.user_id : "",
        )
        .filter(Boolean),
    );

    const visibleGroupIds = new Set(
      (visibleGroupsResult.data ?? [])
        .map((group: { group_id?: unknown }) =>
          typeof group.group_id === "string" ? group.group_id : "",
        )
        .filter(Boolean),
    );

    if (selectedUserIds.some((userId) => !visibleUserIds.has(userId))) {
      return jsonResponse(
        {
          error:
            "One or more selected users are outside your authorized organization scope.",
        },
        403,
      );
    }

    if (selectedGroupIds.some((groupId) => !visibleGroupIds.has(groupId))) {
      return jsonResponse(
        {
          error:
            "One or more selected groups are outside your authorized organization scope.",
        },
        403,
      );
    }
  }

  const scopeSnapshot = {
    portalView,
    selectedUserIds,
    selectedGroupIds,
    userSearchQuery: normalizeString(requestBody.userSearchQuery),
    userStatusFilter: normalizeString(requestBody.userStatusFilter),
    userAccessFilter: normalizeString(requestBody.userAccessFilter),
    groupSearchQuery: normalizeString(requestBody.groupSearchQuery),
    reportDetailSearchQuery: normalizeString(
      requestBody.reportDetailSearchQuery,
    ),
  };

  let dataSnapshot: Record<string, unknown> = {};

  if (portalView === "overview") {
    const [organizationResult, seatSummaryResult] = await Promise.all([
      callerClient
        .from("organizations")
        .select(
          `
            id,
            name,
            current_plan_key,
            subscription_status,
            mission_statement,
            vision_statement,
            values_statement
          `,
        )
        .eq("id", organizationId)
        .maybeSingle(),

      callerClient.rpc("get_organization_seat_summary", {
        p_organization_id: organizationId,
      }),
    ]);

    if (organizationResult.error) {
      throw organizationResult.error;
    }

    dataSnapshot = {
      organization: organizationResult.data,
      seatSummary: seatSummaryResult.error
        ? null
        : (seatSummaryResult.data?.[0] ?? null),
    };
  }

  if (portalView === "billing") {
    const [seatSummaryResult, organizationResult] = await Promise.all([
      callerClient.rpc("get_organization_seat_summary", {
        p_organization_id: organizationId,
      }),

      callerClient
        .from("organizations")
        .select(
          `
            id,
            name,
            current_plan_key,
            billing_interval,
            subscription_status,
            paid_seat_count,
            current_billing_period_start,
            current_billing_period_end
          `,
        )
        .eq("id", organizationId)
        .maybeSingle(),
    ]);

    if (seatSummaryResult.error) {
      throw seatSummaryResult.error;
    }

    if (organizationResult.error) {
      throw organizationResult.error;
    }

    dataSnapshot = {
      organization: organizationResult.data,
      seatSummary: seatSummaryResult.data?.[0] ?? null,
    };
  }

  if (portalView === "users") {
    const { data, error } = await callerClient.rpc(
      "get_organization_user_directory",
      {
        p_organization_id: organizationId,
      },
    );

    if (error) {
      throw error;
    }

    dataSnapshot = {
      users: data ?? [],
    };
  }

  if (portalView === "groups") {
    const [groupsResult, usersResult] = await Promise.all([
      callerClient.rpc("get_organization_visible_groups", {
        p_organization_id: organizationId,
      }),

      callerClient.rpc("get_organization_user_directory", {
        p_organization_id: organizationId,
      }),
    ]);

    if (groupsResult.error) {
      throw groupsResult.error;
    }

    if (usersResult.error) {
      throw usersResult.error;
    }

    dataSnapshot = {
      groups: groupsResult.data ?? [],
      users: usersResult.data ?? [],
    };
  }

  if (portalView === "reports" || portalView === "analyze") {
    const reportUserIds = selectedUserIds.length > 0 ? selectedUserIds : null;

    const reportGroupIds =
      selectedGroupIds.length > 0 ? selectedGroupIds : null;

    const [usageResult, activePriorityResult, retiredPriorityResult] =
      await Promise.all([
        callerClient.rpc("get_organization_usage_report", {
          p_organization_id: organizationId,
          p_user_ids: reportUserIds,
          p_group_ids: reportGroupIds,
        }),

        callerClient.rpc("get_organization_priority_detail_report", {
          p_organization_id: organizationId,
          p_priority_status: "active",
          p_user_ids: reportUserIds,
          p_group_ids: reportGroupIds,
        }),

        callerClient.rpc("get_organization_priority_detail_report", {
          p_organization_id: organizationId,
          p_priority_status: "retired",
          p_user_ids: reportUserIds,
          p_group_ids: reportGroupIds,
        }),
      ]);

    const reportError =
      usageResult.error ??
      activePriorityResult.error ??
      retiredPriorityResult.error;

    if (reportError) {
      throw reportError;
    }

    dataSnapshot = {
      usage: usageResult.data?.[0] ?? null,
      activePriorities: activePriorityResult.data ?? [],
      retiredPriorities: retiredPriorityResult.data ?? [],
    };
  }

  if (portalView === "settings") {
    const [settingsResult, portalCreditResult] = await Promise.all([
      callerClient.rpc("get_organization_settings", {
        p_organization_id: organizationId,
      }),

      callerClient.rpc("get_organization_portal_credit_summary", {
        p_organization_id: organizationId,
      }),
    ]);

    if (settingsResult.error) {
      throw settingsResult.error;
    }

    if (portalCreditResult.error) {
      throw portalCreditResult.error;
    }

    dataSnapshot = {
      settings: settingsResult.data?.[0] ?? null,
      portalCredits: portalCreditResult.data?.[0] ?? null,
    };
  }

  const { data: insertedQuestion, error: insertError } = await adminClient
    .from("organization_ai_questions")
    .insert({
      organization_id: organizationId,
      asked_by_user_id: caller.id,
      request_id: requestId,
      portal_view: portalView,
      question_text: question,
      scope_snapshot: scopeSnapshot,
      data_snapshot: dataSnapshot,
      answer_status: "pending",
    })
    .select(
      `
          id,
          organization_id,
          asked_by_user_id,
          portal_view,
          question_text,
          answer_status,
          created_at
        `,
    )
    .single();

  if (insertError || !insertedQuestion) {
    if (insertError?.code === "23505") {
      const { data: existingQuestion, error: existingQuestionError } =
        await adminClient
          .from("organization_ai_questions")
          .select(
            `
              id,
              portal_view,
              answer_text,
              answer_status,
              credit_status,
              credits_used,
              error_message,
              created_at,
              completed_at
            `,
          )
          .eq("organization_id", organizationId)
          .eq("asked_by_user_id", caller.id)
          .eq("request_id", requestId)
          .maybeSingle();

      if (existingQuestionError || !existingQuestion) {
        return jsonResponse(
          {
            error: "The existing organization question could not be loaded.",
          },
          500,
        );
      }

      return jsonResponse(
        {
          message: "This organization question request was already received.",
          duplicateRequest: true,
          question: existingQuestion,
        },
        200,
      );
    }

    console.error(
      "Organization AI question could not be created:",
      insertError,
    );

    return jsonResponse(
      {
        error: "The organization question could not be created.",
      },
      500,
    );
  }

  const openAiApiKey = Deno.env.get("ORGANIZATION_PORTAL_AI_OPENAI_API_KEY");

  const openAiModel = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";

  if (!openAiApiKey) {
    await adminClient
      .from("organization_ai_questions")
      .update({
        answer_status: "failed",
        credit_status: "not_charged",
        error_message:
          "The organization portal AI OpenAI key is not configured.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", insertedQuestion.id);

    return jsonResponse(
      {
        error:
          "The organization AI service does not have an OpenAI API key configured.",
        questionId: insertedQuestion.id,
      },
      500,
    );
  }

  const { data: creditResult, error: creditError } = await adminClient.rpc(
    "consume_organization_portal_credits",
    {
      p_organization_id: organizationId,
      p_user_id: caller.id,
      p_credit_cost: 1,
      p_event_type: "organization_portal_ai_question",
      p_feature_key: "ask_organization_data",
      p_route: portalView,
      p_metadata: {
        question_id: insertedQuestion.id,
        request_id: requestId,
        portal_view: portalView,
      },
    },
  );

  if (creditError) {
    await adminClient
      .from("organization_ai_questions")
      .update({
        answer_status: "failed",
        credit_status: "not_charged",
        error_message:
          creditError.message || "The portal AI credit could not be charged.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", insertedQuestion.id);

    return jsonResponse(
      {
        error:
          creditError.message || "The portal AI credit could not be charged.",
        questionId: insertedQuestion.id,
      },
      402,
    );
  }

  const chargedCreditResult = Array.isArray(creditResult)
    ? (creditResult[0] ?? null)
    : creditResult;

  const { error: chargedStatusError } = await adminClient
    .from("organization_ai_questions")
    .update({
      credit_status: "charged",
      credits_used: 1,
    })
    .eq("id", insertedQuestion.id);

  if (chargedStatusError) {
    console.error(
      "Organization AI credit status could not be recorded:",
      chargedStatusError,
    );
  }

  try {
    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel,
        store: false,
        instructions:
          `You are Everward's senior organization and leadership analyst. ` +
          `Your job is not to summarize or repeat the supplied report. ` +
          `Analyze the authorized organization data to identify meaningful patterns, themes, risks, opportunities, and leadership actions. ` +
          `Focus on what leaders should understand and do next. ` +
          `Connect every major conclusion to specific supporting evidence from the supplied people, groups, priorities, decisions, Trackables, entries, or existing AI analyses. ` +
          `Look across the selected scope for repeated behaviors, common obstacles, misalignment, weak execution, duplicated effort, stalled progress, measurement gaps, and high-leverage opportunities. ` +
          `Distinguish clearly between facts directly shown in the data and reasonable inferences drawn from those facts. ` +
          `Do not produce a catalog of priorities, decisions, or Trackables unless the user specifically asks for one. ` +
          `Do not merely restate counts or descriptions that are already visible in the report. ` +
          `When the question is broad, organize the answer under these headings: Executive Theme, Top Areas for Improvement, Areas of Opportunity, Leadership Actions, and Risks or Watch Items. ` +
          `For each improvement area or opportunity, explain what it is tied to and why it matters. ` +
          `Leadership actions must be concrete, prioritized, and appropriate for an organization leader rather than generic advice to individual employees. ` +
          `Use no more than five major themes unless the user requests a deeper analysis. ` +
          `Do not invent missing facts. ` +
          `Clearly state when the available data does not support a conclusion. ` +
          `Do not expose internal IDs unless directly necessary. ` +
          `Keep the answer direct, evidence-based, practical, and decision-oriented.`,
        input: JSON.stringify({
          portalView,
          question,
          authorizedScope: scopeSnapshot,
          authorizedPortalData: dataSnapshot,
        }),
      }),
    });

    const openAiBody = (await openAiResponse.json()) as {
      error?: {
        message?: string;
      };
      model?: string;
      output_text?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
      output?: Array<{
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
    };

    if (!openAiResponse.ok) {
      throw new Error(
        openAiBody.error?.message || "OpenAI could not generate an answer.",
      );
    }

    const answerText =
      openAiBody.output_text?.trim() ||
      openAiBody.output
        ?.flatMap((item) => item.content ?? [])
        .filter((item) => item.type === "output_text")
        .map((item) => item.text ?? "")
        .join("\n")
        .trim() ||
      "";

    if (!answerText) {
      throw new Error("OpenAI returned an empty organization answer.");
    }

    const promptTokens = Math.max(
      0,
      Number(openAiBody.usage?.input_tokens ?? 0),
    );

    const completionTokens = Math.max(
      0,
      Number(openAiBody.usage?.output_tokens ?? 0),
    );

    const completedAt = new Date().toISOString();

    const { error: answerUpdateError } = await adminClient
      .from("organization_ai_questions")
      .update({
        answer_text: answerText,
        answer_status: "completed",
        model_used: openAiBody.model?.trim() || openAiModel,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        credits_used: 1,
        credit_status: "charged",
        error_message: null,
        completed_at: completedAt,
      })
      .eq("id", insertedQuestion.id);

    if (answerUpdateError) {
      throw answerUpdateError;
    }

    const { error: sourceInsertError } = await adminClient
      .from("organization_ai_question_sources")
      .insert([
        {
          question_id: insertedQuestion.id,
          organization_id: organizationId,
          source_type: "portal_view",
          source_record_id: null,
          source_label: portalView,
          source_snapshot: dataSnapshot,
        },
        {
          question_id: insertedQuestion.id,
          organization_id: organizationId,
          source_type: "authorized_scope",
          source_record_id: null,
          source_label: `${portalView}_scope`,
          source_snapshot: scopeSnapshot,
        },
      ]);

    if (sourceInsertError) {
      console.error(
        "Organization AI question sources could not be recorded:",
        sourceInsertError,
      );
    }

    return jsonResponse(
      {
        message: "The organization question was answered successfully.",
        questionId: insertedQuestion.id,
        portalView,
        answer: answerText,
        modelUsed: openAiBody.model?.trim() || openAiModel,
        promptTokens,
        completionTokens,
        creditsUsed: 1,
        portalCredits: chargedCreditResult ?? null,
        completedAt,
      },
      200,
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "The organization question could not be answered.";

    console.error("Organization AI answer generation failed:", errorMessage);

    const failedAt = new Date().toISOString();

    const { error: failureUpdateError } = await adminClient
      .from("organization_ai_questions")
      .update({
        answer_status: "failed",
        credit_status: "charged",
        credits_used: 1,
        model_used: openAiModel,
        error_message: errorMessage,
        completed_at: failedAt,
      })
      .eq("id", insertedQuestion.id);

    if (failureUpdateError) {
      console.error(
        "Organization AI failure status could not be recorded:",
        failureUpdateError,
      );
    }

    const { data: refundResult, error: refundError } = await adminClient.rpc(
      "refund_organization_portal_credits",
      {
        p_organization_id: organizationId,
        p_user_id: caller.id,
        p_credit_cost: 1,
        p_event_type: "organization_portal_ai_question_refund",
        p_feature_key: "ask_organization_data",
        p_route: portalView,
        p_metadata: {
          question_id: insertedQuestion.id,
          request_id: requestId,
          portal_view: portalView,
          failure_reason: errorMessage,
        },
      },
    );

    if (refundError) {
      console.error(
        "Organization AI portal credit could not be refunded:",
        refundError,
      );

      return jsonResponse(
        {
          error: errorMessage,
          questionId: insertedQuestion.id,
          creditsUsed: 1,
          creditStatus: "charged",
          creditRefundError:
            refundError.message ||
            "The portal AI credit could not be refunded.",
          failedAt,
        },
        500,
      );
    }

    const refundedCreditResult = Array.isArray(refundResult)
      ? (refundResult[0] ?? null)
      : refundResult;

    const refundedAt = new Date().toISOString();

    const { error: refundedStatusError } = await adminClient
      .from("organization_ai_questions")
      .update({
        credit_status: "refunded",
        credits_used: 0,
        credit_refunded_at: refundedAt,
      })
      .eq("id", insertedQuestion.id);

    if (refundedStatusError) {
      console.error(
        "Organization AI refunded credit status could not be recorded:",
        refundedStatusError,
      );

      return jsonResponse(
        {
          error: errorMessage,
          questionId: insertedQuestion.id,
          creditsUsed: 0,
          creditStatus: "refunded",
          creditStatusUpdateError:
            refundedStatusError.message ||
            "The refunded credit status could not be recorded.",
          portalCredits: refundedCreditResult ?? null,
          failedAt,
          refundedAt,
        },
        500,
      );
    }

    return jsonResponse(
      {
        error: errorMessage,
        questionId: insertedQuestion.id,
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
