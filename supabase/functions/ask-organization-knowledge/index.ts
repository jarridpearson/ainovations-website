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

const portalCreditCost = 1;

type AskOrganizationKnowledgeRequest = {
  organizationId?: unknown;
  question?: unknown;
  requestId?: unknown;
};

type OrganizationMembership = {
  id: string;
  user_id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
  is_billable: boolean | null;
};

type KnowledgeBaseRecord = {
  id: string;
  organization_id: string;
  openai_vector_store_id: string | null;
  status: string;
};

type KnowledgeDocumentRecord = {
  id: string;
  organization_id: string;
  knowledge_base_id: string;
  file_name: string;
  document_status: string;
  is_active: boolean;
  openai_file_id: string | null;
};

type CreditLedgerRecord = {
  user_id: string;
  monthly_allocation: number | null;
  addon_allocation: number | null;
  recurring_addon_allocation: number | null;
  used_credits: number | null;
};

type PortalCreditResult = {
  portal_credits_available: number;
  portal_credits_used: number;
  portal_credit_renewal_date: string | null;
};

type OpenAiAnnotation = {
  type?: string;
  file_id?: string;
  filename?: string;
  index?: number;
  quote?: string;
};

type OpenAiOutputContent = {
  type?: string;
  text?: string;
  annotations?: OpenAiAnnotation[];
};

type OpenAiOutputItem = {
  type?: string;
  content?: OpenAiOutputContent[];
};

type OpenAiResponseBody = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: OpenAiOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

type KnowledgeCitation = {
  citationNumber: number;
  documentId: string | null;
  fileId: string;
  fileName: string;
  quote: string | null;
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
        : "The company knowledge question could not be answered.";

  return rawMessage
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 1000);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function extractAnswerText(responseBody: OpenAiResponseBody) {
  const directOutputText = responseBody.output_text?.trim();

  if (directOutputText) {
    return directOutputText;
  }

  return (
    responseBody.output
      ?.flatMap((outputItem) => outputItem.content ?? [])
      .filter(
        (contentItem) =>
          contentItem.type === "output_text" &&
          typeof contentItem.text === "string",
      )
      .map((contentItem) => contentItem.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n")
      .trim() ?? ""
  );
}

function extractAnnotations(responseBody: OpenAiResponseBody) {
  return (
    responseBody.output
      ?.flatMap((outputItem) => outputItem.content ?? [])
      .flatMap((contentItem) => contentItem.annotations ?? [])
      .filter(
        (annotation) =>
          annotation.type === "file_citation" &&
          typeof annotation.file_id === "string" &&
          annotation.file_id.trim().length > 0,
      ) ?? []
  );
}

async function recordEvent(
  adminClient: ReturnType<typeof createClient>,
  details: {
    organizationId: string;
    actorUserId: string;
    questionId?: string;
    eventType:
      | "question_started"
      | "question_completed"
      | "question_failed"
      | "question_credit_charged"
      | "question_credit_refunded";
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await adminClient
    .from("organization_knowledge_events")
    .insert({
      organization_id: details.organizationId,
      actor_user_id: details.actorUserId,
      question_id: details.questionId ?? null,
      document_id: null,
      event_type: details.eventType,
      event_metadata: details.metadata ?? {},
    });

  if (error) {
    console.error("Company knowledge event could not be recorded:", {
      eventType: details.eventType,
      error,
    });
  }
}

async function loadCreditLedger(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
) {
  const { data, error } = await adminClient
    .from("ai_credit_ledger")
    .select(
      `
        user_id,
        monthly_allocation,
        addon_allocation,
        recurring_addon_allocation,
        used_credits
      `,
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message || "The user’s AI credit balance could not be loaded.",
    );
  }

  if (!data) {
    throw new Error(
      "No AI credit balance is available for this organization user.",
    );
  }

  return data as CreditLedgerRecord;
}

function getAvailableCredits(ledger: CreditLedgerRecord) {
  const totalAllocation =
    Math.max(0, Number(ledger.monthly_allocation ?? 0)) +
    Math.max(0, Number(ledger.addon_allocation ?? 0)) +
    Math.max(0, Number(ledger.recurring_addon_allocation ?? 0));

  const usedCredits = Math.max(0, Number(ledger.used_credits ?? 0));

  return Math.max(0, totalAllocation - usedCredits);
}

async function chargePersonalCredit(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ledger = await loadCreditLedger(adminClient, userId);
    const availableCredits = getAvailableCredits(ledger);
    const currentUsedCredits = Math.max(0, Number(ledger.used_credits ?? 0));

    if (availableCredits < 1) {
      throw new Error(
        "You do not have an available personal AI credit for this question.",
      );
    }

    const { data: updatedLedger, error: updateError } = await adminClient
      .from("ai_credit_ledger")
      .update({
        used_credits: currentUsedCredits + 1,
      })
      .eq("user_id", userId)
      .eq("used_credits", currentUsedCredits)
      .select(
        `
          user_id,
          monthly_allocation,
          addon_allocation,
          recurring_addon_allocation,
          used_credits
        `,
      )
      .maybeSingle();

    if (updateError) {
      throw new Error(
        updateError.message || "The personal AI credit could not be charged.",
      );
    }

    if (updatedLedger) {
      const normalizedLedger = updatedLedger as CreditLedgerRecord;

      return {
        ledger: normalizedLedger,
        remainingCredits: getAvailableCredits(normalizedLedger),
      };
    }

    await sleep(100);
  }

  throw new Error(
    "The personal AI credit balance changed while the question was being submitted. Try again.",
  );
}

async function refundPersonalCredit(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ledger = await loadCreditLedger(adminClient, userId);
    const currentUsedCredits = Math.max(0, Number(ledger.used_credits ?? 0));

    if (currentUsedCredits === 0) {
      return {
        ledger,
        remainingCredits: getAvailableCredits(ledger),
      };
    }

    const { data: updatedLedger, error: updateError } = await adminClient
      .from("ai_credit_ledger")
      .update({
        used_credits: currentUsedCredits - 1,
      })
      .eq("user_id", userId)
      .eq("used_credits", currentUsedCredits)
      .select(
        `
          user_id,
          monthly_allocation,
          addon_allocation,
          recurring_addon_allocation,
          used_credits
        `,
      )
      .maybeSingle();

    if (updateError) {
      throw new Error(
        updateError.message || "The personal AI credit could not be refunded.",
      );
    }

    if (updatedLedger) {
      const normalizedLedger = updatedLedger as CreditLedgerRecord;

      return {
        ledger: normalizedLedger,
        remainingCredits: getAvailableCredits(normalizedLedger),
      };
    }

    await sleep(100);
  }

  throw new Error(
    "The personal AI credit could not be refunded because the balance changed.",
  );
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
  const openAiApiKey =
    Deno.env.get("ORGANIZATION_PORTAL_AI_OPENAI_API_KEY") ||
    Deno.env.get("OPENAI_API_KEY");
  const openAiModel = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    !supabaseServiceRoleKey ||
    !openAiApiKey
  ) {
    return jsonResponse(
      {
        error: "The Company Knowledge AI service is not configured.",
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

  let requestBody: AskOrganizationKnowledgeRequest;

  try {
    requestBody = (await request.json()) as AskOrganizationKnowledgeRequest;
  } catch {
    return jsonResponse(
      {
        error: "The submitted request is not valid JSON.",
      },
      400,
    );
  }

  const organizationId = normalizeString(requestBody.organizationId);
  const question = normalizeString(requestBody.question);
  const submittedRequestId = normalizeString(requestBody.requestId);

  if (!organizationId || !isUuid(organizationId)) {
    return jsonResponse(
      {
        error: "A valid organization ID is required.",
      },
      400,
    );
  }

  if (!question) {
    return jsonResponse(
      {
        error: "Enter a company knowledge question.",
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

  if (submittedRequestId && !isUuid(submittedRequestId)) {
    return jsonResponse(
      {
        error: "The question request ID is invalid.",
      },
      400,
    );
  }

  const requestId = submittedRequestId || crypto.randomUUID();

  const [membershipResult, knowledgeAccessResult, knowledgeBaseResult] =
    await Promise.all([
      adminClient
        .from("organization_users")
        .select(
          `
          id,
          user_id,
          organization_id,
          role,
          is_active,
          is_billable
        `,
        )
        .eq("organization_id", organizationId)
        .eq("user_id", caller.id)
        .eq("is_active", true)
        .maybeSingle(),

      adminClient.rpc("organization_has_company_knowledge_access", {
        p_organization_id: organizationId,
      }),

      adminClient
        .from("organization_knowledge_bases")
        .select(
          `
          id,
          organization_id,
          openai_vector_store_id,
          status
        `,
        )
        .eq("organization_id", organizationId)
        .maybeSingle(),
    ]);

  if (membershipResult.error || !membershipResult.data) {
    return jsonResponse(
      {
        error: "You do not have active access to this organization.",
      },
      403,
    );
  }

  const membership = membershipResult.data as OrganizationMembership;

  const canUseCompanyKnowledge =
    membership.is_billable === true ||
    membership.role === "organization_admin" ||
    membership.role === "user_admin";

  if (!canUseCompanyKnowledge) {
    return jsonResponse(
      {
        error:
          "Company Knowledge AI is available only to active organization app users or authorized organization administrators.",
      },
      403,
    );
  }

  if (knowledgeAccessResult.error || knowledgeAccessResult.data !== true) {
    return jsonResponse(
      {
        error: "Company Knowledge AI requires an active Organization Pro plan.",
      },
      403,
    );
  }

  if (knowledgeBaseResult.error || !knowledgeBaseResult.data) {
    return jsonResponse(
      {
        error:
          "The organization does not have a Company Knowledge AI library yet.",
      },
      409,
    );
  }

  const knowledgeBase = knowledgeBaseResult.data as KnowledgeBaseRecord;

  if (
    knowledgeBase.status !== "active" ||
    !knowledgeBase.openai_vector_store_id
  ) {
    return jsonResponse(
      {
        error: "The organization’s Company Knowledge AI library is not ready.",
      },
      409,
    );
  }

  const { data: readyDocuments, error: documentsError } = await adminClient
    .from("organization_knowledge_documents")
    .select(
      `
          id,
          organization_id,
          knowledge_base_id,
          file_name,
          document_status,
          is_active,
          openai_file_id
        `,
    )
    .eq("organization_id", organizationId)
    .eq("knowledge_base_id", knowledgeBase.id)
    .eq("is_active", true)
    .eq("document_status", "ready");

  if (documentsError) {
    return jsonResponse(
      {
        error:
          "The organization’s approved company documents could not be loaded.",
      },
      500,
    );
  }

  const approvedDocuments = (readyDocuments ?? []) as KnowledgeDocumentRecord[];

  if (approvedDocuments.length === 0) {
    return jsonResponse(
      {
        error:
          "The organization does not have any approved company documents ready for questions.",
      },
      409,
    );
  }

  const { data: existingQuestion, error: existingQuestionError } =
    await adminClient
      .from("organization_knowledge_questions")
      .select(
        `
          id,
          organization_id,
          asked_by_user_id,
          question_text,
          answer_text,
          citations,
          answer_status,
          model_used,
          credits_used,
          credit_status,
          request_id,
          prompt_tokens,
          completion_tokens,
          error_message,
          created_at,
          completed_at,
          credit_refunded_at
        `,
      )
      .eq("organization_id", organizationId)
      .eq("asked_by_user_id", caller.id)
      .eq("request_id", requestId)
      .maybeSingle();

  if (existingQuestionError) {
    return jsonResponse(
      {
        error: "The existing company knowledge question could not be checked.",
      },
      500,
    );
  }

  if (existingQuestion) {
    return jsonResponse(
      {
        message:
          "This company knowledge question request was already received.",
        duplicateRequest: true,
        question: existingQuestion,
      },
      200,
    );
  }

  const { data: insertedQuestion, error: insertQuestionError } =
    await adminClient
      .from("organization_knowledge_questions")
      .insert({
        organization_id: organizationId,
        asked_by_user_id: caller.id,
        question_text: question,
        answer_text: null,
        citations: [],
        answer_status: "processing",
        model_used: openAiModel,
        credits_used: 0,
        credit_status: "not_charged",
        request_id: requestId,
        prompt_tokens: 0,
        completion_tokens: 0,
        error_message: null,
      })
      .select(
        `
          id,
          organization_id,
          asked_by_user_id,
          question_text,
          answer_status,
          request_id,
          created_at
        `,
      )
      .single();

  if (insertQuestionError || !insertedQuestion) {
    if (
      insertQuestionError?.code === "23505" ||
      insertQuestionError?.message?.toLowerCase().includes("duplicate")
    ) {
      const { data: duplicateQuestion } = await adminClient
        .from("organization_knowledge_questions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("asked_by_user_id", caller.id)
        .eq("request_id", requestId)
        .maybeSingle();

      return jsonResponse(
        {
          message:
            "This company knowledge question request was already received.",
          duplicateRequest: true,
          question: duplicateQuestion,
        },
        200,
      );
    }

    return jsonResponse(
      {
        error: "The company knowledge question could not be created.",
      },
      500,
    );
  }

  await recordEvent(adminClient, {
    organizationId,
    actorUserId: caller.id,
    questionId: insertedQuestion.id,
    eventType: "question_started",
    metadata: {
      request_id: requestId,
      ready_document_count: approvedDocuments.length,
    },
  });

  let creditCharged = false;
  let chargedCreditResult: PortalCreditResult | null = null;

  try {
    const { data: consumptionData, error: consumptionError } =
      await adminClient.rpc("consume_organization_portal_credits", {
        p_organization_id: organizationId,
        p_user_id: caller.id,
        p_credit_cost: portalCreditCost,
        p_event_type: "ai_generation",
        p_feature_key: "organization_company_knowledge",
        p_route: "/organization/company-knowledge",
        p_metadata: {
          question_id: insertedQuestion.id,
          request_id: requestId,
        },
      });

    if (consumptionError) {
      throw new Error(
        consumptionError.message ||
          "The organization portal AI credit could not be applied.",
      );
    }

    chargedCreditResult =
      (consumptionData as PortalCreditResult[] | null)?.[0] ?? null;

    if (!chargedCreditResult) {
      throw new Error(
        "The updated organization portal AI credit balance could not be confirmed.",
      );
    }

    creditCharged = true;

    const { error: chargedStatusError } = await adminClient
      .from("organization_knowledge_questions")
      .update({
        credits_used: 1,
        credit_status: "charged",
      })
      .eq("id", insertedQuestion.id);

    if (chargedStatusError) {
      throw new Error(
        chargedStatusError.message ||
          "The charged AI credit could not be recorded.",
      );
    }

    await recordEvent(adminClient, {
      organizationId,
      actorUserId: caller.id,
      questionId: insertedQuestion.id,
      eventType: "question_credit_charged",
      metadata: {
        credit_cost: portalCreditCost,
        credit_pool_type: "portal",
        remaining_portal_credits: chargedCreditResult.portal_credits_available,
      },
    });

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
          "You are Everward Company Knowledge AI. " +
          "Answer the user only from the organization documents returned by the file search tool. " +
          "Do not use general knowledge, personal Everward data, assumptions, or information outside those documents. " +
          "Never claim that a policy, procedure, fact, deadline, requirement, benefit, or rule exists unless the retrieved organization documents support it. " +
          "When the approved documents do not contain enough information, clearly say that the organization documents are insufficient to answer the question. " +
          "Include citation markers in the answer for supported statements using the source citations supplied by the file search results. " +
          "Keep the answer direct, practical, and faithful to the organization’s wording.",
        input: question,
        tools: [
          {
            type: "file_search",
            vector_store_ids: [knowledgeBase.openai_vector_store_id],
            max_num_results: 10,
          },
        ],
        include: ["file_search_call.results"],
      }),
    });

    let openAiBody: OpenAiResponseBody;

    try {
      openAiBody = (await openAiResponse.json()) as OpenAiResponseBody;
    } catch {
      throw new Error(
        "OpenAI returned an unreadable Company Knowledge AI response.",
      );
    }

    if (!openAiResponse.ok) {
      throw new Error(
        openAiBody.error?.message ||
          "OpenAI could not answer the company knowledge question.",
      );
    }

    const answerText = extractAnswerText(openAiBody);

    if (!answerText) {
      throw new Error("OpenAI returned an empty Company Knowledge AI answer.");
    }

    const annotations = extractAnnotations(openAiBody);

    const documentByOpenAiFileId = new Map(
      approvedDocuments
        .filter(
          (
            document,
          ): document is KnowledgeDocumentRecord & {
            openai_file_id: string;
          } =>
            typeof document.openai_file_id === "string" &&
            document.openai_file_id.length > 0,
        )
        .map((document) => [document.openai_file_id, document]),
    );

    const uniqueCitationKeys = new Set<string>();
    const citations: KnowledgeCitation[] = [];

    annotations.forEach((annotation) => {
      const fileId = annotation.file_id?.trim() ?? "";

      if (!fileId) {
        return;
      }

      const matchingDocument = documentByOpenAiFileId.get(fileId);

      if (!matchingDocument) {
        return;
      }

      const quote =
        typeof annotation.quote === "string" && annotation.quote.trim()
          ? annotation.quote.trim().slice(0, 1000)
          : null;

      const citationKey = `${fileId}:${quote ?? ""}`;

      if (uniqueCitationKeys.has(citationKey)) {
        return;
      }

      uniqueCitationKeys.add(citationKey);

      citations.push({
        citationNumber: citations.length + 1,
        documentId: matchingDocument.id,
        fileId,
        fileName: matchingDocument.file_name,
        quote,
      });
    });

    const promptTokens = Math.max(
      0,
      Number(openAiBody.usage?.input_tokens ?? 0),
    );

    const completionTokens = Math.max(
      0,
      Number(openAiBody.usage?.output_tokens ?? 0),
    );

    const completedAt = new Date().toISOString();

    const { error: completionUpdateError } = await adminClient
      .from("organization_knowledge_questions")
      .update({
        answer_text: answerText,
        citations,
        answer_status: "completed",
        model_used: openAiBody.model?.trim() || openAiModel,
        credits_used: 1,
        credit_status: "charged",
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        error_message: null,
        completed_at: completedAt,
      })
      .eq("id", insertedQuestion.id);

    if (completionUpdateError) {
      throw new Error(
        completionUpdateError.message ||
          "The Company Knowledge AI answer could not be saved.",
      );
    }

    await recordEvent(adminClient, {
      organizationId,
      actorUserId: caller.id,
      questionId: insertedQuestion.id,
      eventType: "question_completed",
      metadata: {
        model_used: openAiBody.model?.trim() || openAiModel,
        citation_count: citations.length,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      },
    });

    return jsonResponse(
      {
        message: "The company knowledge question was answered successfully.",
        questionId: insertedQuestion.id,
        requestId,
        answer: answerText,
        citations,
        modelUsed: openAiBody.model?.trim() || openAiModel,
        promptTokens,
        completionTokens,
        creditsUsed: portalCreditCost,
        creditStatus: "charged",
        portalCreditsAvailable: chargedCreditResult.portal_credits_available,
        portalCreditsUsed: chargedCreditResult.portal_credits_used,
        portalCreditRenewalDate: chargedCreditResult.portal_credit_renewal_date,
        completedAt,
      },
      200,
    );
  } catch (error) {
    const errorMessage = sanitizeError(error);
    const failedAt = new Date().toISOString();

    let creditStatus = creditCharged ? "charged" : "not_charged";
    let creditsUsed = creditCharged ? 1 : 0;
    let creditRefundedAt: string | null = null;
    let portalCreditsAvailable: number | null = null;
    let portalCreditsUsed: number | null = null;
    let portalCreditRenewalDate: string | null = null;
    let refundErrorMessage: string | null = null;

    if (creditCharged) {
      try {
        const { data: refundData, error: refundError } = await adminClient.rpc(
          "refund_organization_portal_credits",
          {
            p_organization_id: organizationId,
            p_user_id: caller.id,
            p_credit_cost: portalCreditCost,
            p_event_type: "ai_generation_refund",
            p_feature_key: "organization_company_knowledge",
            p_route: "/organization/company-knowledge",
            p_metadata: {
              question_id: insertedQuestion.id,
              request_id: requestId,
              failure_reason: errorMessage,
            },
          },
        );

        if (refundError) {
          throw new Error(
            refundError.message ||
              "The organization portal AI credit could not be refunded.",
          );
        }

        const refundedCreditResult =
          (refundData as PortalCreditResult[] | null)?.[0] ?? null;

        if (!refundedCreditResult) {
          throw new Error(
            "The refunded organization portal AI credit balance could not be confirmed.",
          );
        }

        creditStatus = "refunded";
        creditsUsed = 0;
        creditRefundedAt = new Date().toISOString();
        portalCreditsAvailable = refundedCreditResult.portal_credits_available;
        portalCreditsUsed = refundedCreditResult.portal_credits_used;
        portalCreditRenewalDate =
          refundedCreditResult.portal_credit_renewal_date;

        await recordEvent(adminClient, {
          organizationId,
          actorUserId: caller.id,
          questionId: insertedQuestion.id,
          eventType: "question_credit_refunded",
          metadata: {
            credit_cost: portalCreditCost,
            credit_pool_type: "portal",
            reason: errorMessage,
            remaining_portal_credits:
              refundedCreditResult.portal_credits_available,
          },
        });
      } catch (refundError) {
        refundErrorMessage = sanitizeError(refundError);

        console.error(
          "Company Knowledge AI personal credit refund failed:",
          refundErrorMessage,
        );
      }
    }

    const { error: failureUpdateError } = await adminClient
      .from("organization_knowledge_questions")
      .update({
        answer_status: "failed",
        credits_used: creditsUsed,
        credit_status: creditStatus,
        model_used: openAiModel,
        error_message: errorMessage,
        completed_at: failedAt,
        credit_refunded_at: creditRefundedAt,
      })
      .eq("id", insertedQuestion.id);

    if (failureUpdateError) {
      console.error(
        "Company Knowledge AI failure status could not be saved:",
        failureUpdateError,
      );
    }

    await recordEvent(adminClient, {
      organizationId,
      actorUserId: caller.id,
      questionId: insertedQuestion.id,
      eventType: "question_failed",
      metadata: {
        error: errorMessage,
        credit_status: creditStatus,
        refund_error: refundErrorMessage,
      },
    });

    return jsonResponse(
      {
        error: errorMessage,
        questionId: insertedQuestion.id,
        requestId,
        creditsUsed,
        creditStatus,
        portalCreditsAvailable,
        portalCreditsUsed,
        portalCreditRenewalDate,
        creditRefundError: refundErrorMessage,
        failedAt,
        creditRefundedAt,
      },
      errorMessage.toLowerCase().includes("not enough portal ai credits")
        ? 402
        : 500,
    );
  }
});
