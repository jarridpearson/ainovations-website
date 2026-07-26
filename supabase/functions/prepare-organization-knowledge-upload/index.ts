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

const storageBucket = "organization-knowledge";
const maximumFileSizeBytes = 50 * 1024 * 1024;

const supportedFileTypes: Record<
  string,
  {
    canonicalMimeType: string;
    acceptedMimeTypes: string[];
  }
> = {
  pdf: {
    canonicalMimeType: "application/pdf",
    acceptedMimeTypes: ["application/pdf"],
  },
  doc: {
    canonicalMimeType: "application/msword",
    acceptedMimeTypes: ["application/msword"],
  },
  docx: {
    canonicalMimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    acceptedMimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  ppt: {
    canonicalMimeType: "application/vnd.ms-powerpoint",
    acceptedMimeTypes: ["application/vnd.ms-powerpoint"],
  },
  pptx: {
    canonicalMimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    acceptedMimeTypes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  },
  xls: {
    canonicalMimeType: "application/vnd.ms-excel",
    acceptedMimeTypes: ["application/vnd.ms-excel"],
  },
  xlsx: {
    canonicalMimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    acceptedMimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
};

type PrepareKnowledgeUploadRequest = {
  organizationId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  fileSizeBytes?: unknown;
};

type KnowledgeBaseRecord = {
  id: string;
  organization_id: string;
  status: string;
  openai_vector_store_id: string | null;
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

function getFileExtension(fileName: string) {
  const lastPeriodIndex = fileName.lastIndexOf(".");

  if (lastPeriodIndex <= 0 || lastPeriodIndex === fileName.length - 1) {
    return "";
  }

  return fileName
    .slice(lastPeriodIndex + 1)
    .trim()
    .toLowerCase();
}

function sanitizeFileName(fileName: string) {
  const normalizedFileName = fileName
    .normalize("NFKC")
    .replace(/[\/\\]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._() -]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .replace(/^\.+/, "");

  if (!normalizedFileName) {
    return "";
  }

  return normalizedFileName.slice(0, 180);
}

async function loadOrCreateKnowledgeBase(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  callerUserId: string,
): Promise<KnowledgeBaseRecord> {
  const { data: existingKnowledgeBase, error: existingKnowledgeBaseError } =
    await adminClient
      .from("organization_knowledge_bases")
      .select(
        `
        id,
        organization_id,
        status,
        openai_vector_store_id
      `,
      )
      .eq("organization_id", organizationId)
      .maybeSingle();

  if (existingKnowledgeBaseError) {
    throw new Error(
      `Unable to load the company knowledge base: ${existingKnowledgeBaseError.message}`,
    );
  }

  if (existingKnowledgeBase) {
    if (existingKnowledgeBase.status === "disabled") {
      throw new Error(
        "Company Knowledge AI is currently disabled for this organization.",
      );
    }

    return existingKnowledgeBase as KnowledgeBaseRecord;
  }

  const { data: insertedKnowledgeBase, error: insertedKnowledgeBaseError } =
    await adminClient
      .from("organization_knowledge_bases")
      .insert({
        organization_id: organizationId,
        status: "provisioning",
        created_by_user_id: callerUserId,
      })
      .select(
        `
        id,
        organization_id,
        status,
        openai_vector_store_id
      `,
      )
      .single();

  if (!insertedKnowledgeBaseError && insertedKnowledgeBase) {
    const { error: eventError } = await adminClient
      .from("organization_knowledge_events")
      .insert({
        organization_id: organizationId,
        actor_user_id: callerUserId,
        event_type: "knowledge_base_created",
        event_metadata: {
          status: insertedKnowledgeBase.status,
        },
      });

    if (eventError) {
      console.error(
        "Knowledge base creation event could not be recorded:",
        eventError,
      );
    }

    return insertedKnowledgeBase as KnowledgeBaseRecord;
  }

  /*
   * Another request may have created the organization’s single
   * knowledge base between our initial select and insert.
   */
  const { data: concurrentKnowledgeBase, error: concurrentKnowledgeBaseError } =
    await adminClient
      .from("organization_knowledge_bases")
      .select(
        `
        id,
        organization_id,
        status,
        openai_vector_store_id
      `,
      )
      .eq("organization_id", organizationId)
      .maybeSingle();

  if (concurrentKnowledgeBaseError || !concurrentKnowledgeBase) {
    throw new Error(
      insertedKnowledgeBaseError?.message ||
        "The company knowledge base could not be created.",
    );
  }

  return concurrentKnowledgeBase as KnowledgeBaseRecord;
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
    console.error("Required Supabase environment variables are missing.");

    return jsonResponse(
      {
        error: "The company knowledge upload service is not configured.",
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

  let requestBody: PrepareKnowledgeUploadRequest;

  try {
    requestBody = (await request.json()) as PrepareKnowledgeUploadRequest;
  } catch {
    return jsonResponse(
      {
        error: "The submitted request is not valid JSON.",
      },
      400,
    );
  }

  const organizationId = normalizeString(requestBody.organizationId);

  const submittedFileName = normalizeString(requestBody.fileName);

  const submittedMimeType = normalizeString(requestBody.mimeType).toLowerCase();

  const fileSizeBytes =
    typeof requestBody.fileSizeBytes === "number"
      ? requestBody.fileSizeBytes
      : typeof requestBody.fileSizeBytes === "string"
        ? Number(requestBody.fileSizeBytes)
        : Number.NaN;

  if (!organizationId || !isUuid(organizationId)) {
    return jsonResponse(
      {
        error: "A valid organization ID is required.",
      },
      400,
    );
  }

  if (!submittedFileName) {
    return jsonResponse(
      {
        error: "Select a company document to upload.",
      },
      400,
    );
  }

  if (submittedFileName.length > 255) {
    return jsonResponse(
      {
        error:
          "The company document file name must contain 255 characters or fewer.",
      },
      400,
    );
  }

  if (submittedFileName.includes("/") || submittedFileName.includes("\\")) {
    return jsonResponse(
      {
        error: "The company document file name is invalid.",
      },
      400,
    );
  }

  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes <= 0) {
    return jsonResponse(
      {
        error: "The company document must contain valid file data.",
      },
      400,
    );
  }

  if (fileSizeBytes > maximumFileSizeBytes) {
    return jsonResponse(
      {
        error: "Company documents cannot be larger than 50 MB.",
      },
      400,
    );
  }

  const fileExtension = getFileExtension(submittedFileName);

  const supportedFileType = supportedFileTypes[fileExtension];

  if (!supportedFileType) {
    return jsonResponse(
      {
        error: "Upload a DOC, DOCX, PDF, PPT, PPTX, XLS, or XLSX file.",
      },
      400,
    );
  }

  const allowedGenericMimeTypes = new Set([
    "",
    "application/octet-stream",
    "binary/octet-stream",
  ]);

  if (
    !allowedGenericMimeTypes.has(submittedMimeType) &&
    !supportedFileType.acceptedMimeTypes.includes(submittedMimeType)
  ) {
    return jsonResponse(
      {
        error: "The selected file extension and file type do not match.",
      },
      400,
    );
  }

  const safeFileName = sanitizeFileName(submittedFileName);

  if (!safeFileName || getFileExtension(safeFileName) !== fileExtension) {
    return jsonResponse(
      {
        error: "The company document file name is invalid.",
      },
      400,
    );
  }

  const [membershipResult, organizationResult, knowledgeAccessResult] =
    await Promise.all([
      adminClient
        .from("organization_users")
        .select("id, role, is_active")
        .eq("organization_id", organizationId)
        .eq("user_id", caller.id)
        .eq("is_active", true)
        .maybeSingle(),

      adminClient
        .from("organizations")
        .select(
          `
          id,
          current_plan_key,
          subscription_status
        `,
        )
        .eq("id", organizationId)
        .maybeSingle(),

      adminClient.rpc("organization_has_company_knowledge_access", {
        p_organization_id: organizationId,
      }),
    ]);

  if (
    membershipResult.error ||
    !membershipResult.data ||
    !["organization_admin", "user_admin"].includes(membershipResult.data.role)
  ) {
    return jsonResponse(
      {
        error:
          "Only an active Organization Admin or User Admin can manage company knowledge documents.",
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

  if (knowledgeAccessResult.error || knowledgeAccessResult.data !== true) {
    return jsonResponse(
      {
        error: "Company Knowledge AI requires an active Organization Pro plan.",
      },
      403,
    );
  }

  const { data: plan, error: planError } = await adminClient
    .from("subscription_plans")
    .select(
      `
          plan_key,
          company_document_limit,
          allowed_company_document_types,
          allows_company_document_questions,
          active,
          account_level
        `,
    )
    .eq("plan_key", organizationResult.data.current_plan_key)
    .maybeSingle();

  if (
    planError ||
    !plan ||
    plan.plan_key !== "organization_pro" ||
    plan.active !== true ||
    plan.account_level !== "organization" ||
    plan.allows_company_document_questions !== true
  ) {
    return jsonResponse(
      {
        error: "Company Knowledge AI requires an active Organization Pro plan.",
      },
      403,
    );
  }

  const allowedDocumentTypes = Array.isArray(
    plan.allowed_company_document_types,
  )
    ? plan.allowed_company_document_types
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
    : [];

  if (
    allowedDocumentTypes.length > 0 &&
    !allowedDocumentTypes.includes(fileExtension)
  ) {
    return jsonResponse(
      {
        error:
          "This file type is not included with the organization’s current plan.",
      },
      400,
    );
  }

  const documentLimit = Math.max(0, Number(plan.company_document_limit ?? 0));

  const { count: activeDocumentCount, error: activeDocumentCountError } =
    await adminClient
      .from("organization_knowledge_documents")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .neq("document_status", "deleted");

  if (activeDocumentCountError) {
    console.error(
      "Active company document count could not be loaded:",
      activeDocumentCountError,
    );

    return jsonResponse(
      {
        error: "Unable to determine the current company document usage.",
      },
      500,
    );
  }

  if (documentLimit <= 0 || (activeDocumentCount ?? 0) >= documentLimit) {
    return jsonResponse(
      {
        error: `This organization has reached its active company document limit of ${documentLimit}.`,
      },
      409,
    );
  }

  let knowledgeBase: KnowledgeBaseRecord;

  try {
    knowledgeBase = await loadOrCreateKnowledgeBase(
      adminClient,
      organizationId,
      caller.id,
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "The company knowledge base could not be prepared.";

    console.error("Company knowledge base preparation failed:", errorMessage);

    return jsonResponse(
      {
        error: errorMessage,
      },
      500,
    );
  }

  const documentId = crypto.randomUUID();
  const storagePath = `${organizationId}/${documentId}/${safeFileName}`;

  const { data: insertedDocument, error: insertedDocumentError } =
    await adminClient
      .from("organization_knowledge_documents")
      .insert({
        id: documentId,
        organization_id: organizationId,
        knowledge_base_id: knowledgeBase.id,
        uploaded_by_user_id: caller.id,
        file_name: submittedFileName,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        mime_type: supportedFileType.canonicalMimeType,
        file_size_bytes: fileSizeBytes,
        document_status: "uploaded",
        is_active: true,
      })
      .select(
        `
        id,
        organization_id,
        knowledge_base_id,
        file_name,
        storage_bucket,
        storage_path,
        mime_type,
        file_size_bytes,
        document_status,
        is_active,
        created_at
      `,
      )
      .single();

  if (insertedDocumentError || !insertedDocument) {
    console.error(
      "Company knowledge document record could not be created:",
      insertedDocumentError,
    );

    const databaseMessage = insertedDocumentError?.message ?? "";

    const isDocumentLimitError = databaseMessage
      .toLowerCase()
      .includes("document limit");

    return jsonResponse(
      {
        error: isDocumentLimitError
          ? databaseMessage
          : "The company document upload could not be prepared.",
      },
      isDocumentLimitError ? 409 : 500,
    );
  }

  const { data: signedUploadData, error: signedUploadError } =
    await adminClient.storage
      .from(storageBucket)
      .createSignedUploadUrl(storagePath, {
        upsert: false,
      });

  if (
    signedUploadError ||
    !signedUploadData?.signedUrl ||
    !signedUploadData?.token
  ) {
    console.error(
      "Signed company document upload URL could not be created:",
      signedUploadError,
    );

    await adminClient
      .from("organization_knowledge_documents")
      .delete()
      .eq("id", documentId)
      .eq("organization_id", organizationId);

    return jsonResponse(
      {
        error: "A secure company document upload URL could not be created.",
      },
      500,
    );
  }

  const { error: eventError } = await adminClient
    .from("organization_knowledge_events")
    .insert({
      organization_id: organizationId,
      actor_user_id: caller.id,
      document_id: documentId,
      event_type: "document_upload_prepared",
      event_metadata: {
        file_name: submittedFileName,
        storage_path: storagePath,
        mime_type: supportedFileType.canonicalMimeType,
        file_size_bytes: fileSizeBytes,
      },
    });

  if (eventError) {
    console.error(
      "Company document upload event could not be recorded:",
      eventError,
    );

    await adminClient
      .from("organization_knowledge_documents")
      .delete()
      .eq("id", documentId)
      .eq("organization_id", organizationId);

    return jsonResponse(
      {
        error:
          "The secure upload was prepared, but its audit event could not be recorded.",
      },
      500,
    );
  }

  return jsonResponse(
    {
      message: "The secure company document upload is ready.",
      knowledgeBase: {
        id: knowledgeBase.id,
        status: knowledgeBase.status,
      },
      document: insertedDocument,
      upload: {
        bucket: storageBucket,
        path: storagePath,
        token: signedUploadData.token,
        signedUrl: signedUploadData.signedUrl,
        expiresInSeconds: 7200,
      },
      limits: {
        activeDocumentCountBeforeUpload: activeDocumentCount ?? 0,
        documentLimit,
        remainingDocumentSlotsAfterUpload: Math.max(
          0,
          documentLimit - (activeDocumentCount ?? 0) - 1,
        ),
      },
    },
    200,
  );
});
