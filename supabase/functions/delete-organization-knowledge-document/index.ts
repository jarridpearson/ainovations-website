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

type DeleteKnowledgeDocumentRequest = {
  organizationId?: unknown;
  documentId?: unknown;
};

type KnowledgeDocumentRecord = {
  id: string;
  organization_id: string;
  knowledge_base_id: string;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  document_status: string;
  is_active: boolean;
  openai_file_id: string | null;
  openai_vector_store_file_id: string | null;
  deleted_at: string | null;
};

type KnowledgeBaseRecord = {
  id: string;
  organization_id: string;
  openai_vector_store_id: string | null;
  status: string;
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

function sanitizeErrorMessage(error: unknown) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "The company document could not be deleted.";

  return rawMessage.replace(/\s+/g, " ").trim().slice(0, 1000);
}

async function deleteOpenAiResource(
  url: string,
  openAiApiKey: string,
  resourceDescription: string,
) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (response.ok || response.status === 404) {
    return;
  }

  let errorMessage = `${resourceDescription} could not be deleted.`;

  try {
    const responseBody = (await response.json()) as {
      error?: {
        message?: string;
      };
    };

    if (responseBody.error?.message) {
      errorMessage = responseBody.error.message;
    }
  } catch {
    const responseText = await response.text().catch(() => "");

    if (responseText.trim()) {
      errorMessage = responseText.trim();
    }
  }

  throw new Error(errorMessage);
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

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    !supabaseServiceRoleKey ||
    !openAiApiKey
  ) {
    console.error(
      "Required company knowledge deletion environment variables are missing.",
    );

    return jsonResponse(
      {
        error: "The company knowledge deletion service is not configured.",
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

  let requestBody: DeleteKnowledgeDocumentRequest;

  try {
    requestBody = (await request.json()) as DeleteKnowledgeDocumentRequest;
  } catch {
    return jsonResponse(
      {
        error: "The submitted request is not valid JSON.",
      },
      400,
    );
  }

  const organizationId = normalizeString(requestBody.organizationId);
  const documentId = normalizeString(requestBody.documentId);

  if (!organizationId || !isUuid(organizationId)) {
    return jsonResponse(
      {
        error: "A valid organization ID is required.",
      },
      400,
    );
  }

  if (!documentId || !isUuid(documentId)) {
    return jsonResponse(
      {
        error: "A valid company document ID is required.",
      },
      400,
    );
  }

  const [membershipResult, knowledgeAccessResult] = await Promise.all([
    adminClient
      .from("organization_users")
      .select("id, role, is_active")
      .eq("organization_id", organizationId)
      .eq("user_id", caller.id)
      .eq("is_active", true)
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
          "Only an active Organization Admin or User Admin can delete company knowledge documents.",
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

  const { data: documentData, error: documentError } = await adminClient
    .from("organization_knowledge_documents")
    .select(
      `
        id,
        organization_id,
        knowledge_base_id,
        file_name,
        storage_bucket,
        storage_path,
        document_status,
        is_active,
        openai_file_id,
        openai_vector_store_file_id,
        deleted_at
      `,
    )
    .eq("id", documentId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (documentError) {
    console.error("Company knowledge document failed to load:", documentError);

    return jsonResponse(
      {
        error: "The company document could not be loaded.",
      },
      500,
    );
  }

  if (!documentData) {
    return jsonResponse(
      {
        error: "The selected company document was not found.",
      },
      404,
    );
  }

  const document = documentData as KnowledgeDocumentRecord;

  if (document.document_status === "deleted" || document.is_active === false) {
    return jsonResponse(
      {
        message: "The company document has already been deleted.",
        document: {
          id: document.id,
          fileName: document.file_name,
          documentStatus: "deleted",
          isActive: false,
          deletedAt: document.deleted_at,
        },
      },
      200,
    );
  }

  if (document.document_status === "processing") {
    return jsonResponse(
      {
        error:
          "This company document is still processing. Wait for processing to finish before deleting it.",
      },
      409,
    );
  }

  const { data: knowledgeBaseData, error: knowledgeBaseError } =
    await adminClient
      .from("organization_knowledge_bases")
      .select(
        `
          id,
          organization_id,
          openai_vector_store_id,
          status
        `,
      )
      .eq("id", document.knowledge_base_id)
      .eq("organization_id", organizationId)
      .maybeSingle();

  if (knowledgeBaseError) {
    console.error("Company knowledge base failed to load:", knowledgeBaseError);

    return jsonResponse(
      {
        error: "The company knowledge base could not be loaded.",
      },
      500,
    );
  }

  if (!knowledgeBaseData) {
    return jsonResponse(
      {
        error: "The company knowledge base was not found.",
      },
      404,
    );
  }

  const knowledgeBase = knowledgeBaseData as KnowledgeBaseRecord;
  const deletionStartedAt = new Date().toISOString();

  const { error: deletingUpdateError } = await adminClient
    .from("organization_knowledge_documents")
    .update({
      document_status: "deleting",
      error_message: null,
      updated_at: deletionStartedAt,
    })
    .eq("id", document.id)
    .eq("organization_id", organizationId);

  if (deletingUpdateError) {
    console.error(
      "Company document could not be marked for deletion:",
      deletingUpdateError,
    );

    return jsonResponse(
      {
        error: "The company document deletion could not be started.",
      },
      500,
    );
  }

  try {
    if (
      knowledgeBase.openai_vector_store_id &&
      document.openai_vector_store_file_id
    ) {
      await deleteOpenAiResource(
        `https://api.openai.com/v1/vector_stores/${
          knowledgeBase.openai_vector_store_id
        }/files/${document.openai_vector_store_file_id}`,
        openAiApiKey,
        "The OpenAI vector-store document",
      );
    }

    if (document.openai_file_id) {
      await deleteOpenAiResource(
        `https://api.openai.com/v1/files/${document.openai_file_id}`,
        openAiApiKey,
        "The OpenAI source file",
      );
    }

    const { error: storageDeleteError } = await adminClient.storage
      .from(document.storage_bucket)
      .remove([document.storage_path]);

    if (storageDeleteError) {
      throw new Error(
        storageDeleteError.message ||
          "The stored company document could not be deleted.",
      );
    }

    const deletedAt = new Date().toISOString();

    const { data: deletedDocument, error: deletedDocumentError } =
      await adminClient
        .from("organization_knowledge_documents")
        .update({
          document_status: "deleted",
          is_active: false,
          openai_file_id: null,
          openai_vector_store_file_id: null,
          error_message: null,
          processed_at: null,
          deleted_at: deletedAt,
          updated_at: deletedAt,
        })
        .eq("id", document.id)
        .eq("organization_id", organizationId)
        .select(
          `
            id,
            organization_id,
            knowledge_base_id,
            file_name,
            document_status,
            is_active,
            deleted_at,
            updated_at
          `,
        )
        .single();

    if (deletedDocumentError || !deletedDocument) {
      throw new Error(
        deletedDocumentError?.message ||
          "The company document deletion could not be finalized.",
      );
    }

    const { error: eventError } = await adminClient
      .from("organization_knowledge_events")
      .insert({
        organization_id: organizationId,
        actor_user_id: caller.id,
        document_id: document.id,
        event_type: "document_deleted",
        event_metadata: {
          file_name: document.file_name,
          storage_bucket: document.storage_bucket,
          storage_path: document.storage_path,
          had_openai_file: Boolean(document.openai_file_id),
          had_vector_store_file: Boolean(document.openai_vector_store_file_id),
        },
      });

    if (eventError) {
      console.error(
        "Company document deletion audit event could not be recorded:",
        eventError,
      );

      return jsonResponse(
        {
          error:
            "The document was deleted, but its deletion audit event could not be recorded.",
          document: deletedDocument,
        },
        500,
      );
    }

    return jsonResponse(
      {
        message: `${document.file_name} was deleted successfully.`,
        document: deletedDocument,
      },
      200,
    );
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error);

    console.error("Company knowledge document deletion failed:", {
      organizationId,
      documentId,
      error: errorMessage,
    });

    const failureTime = new Date().toISOString();

    await adminClient
      .from("organization_knowledge_documents")
      .update({
        document_status: "failed",
        error_message: errorMessage,
        updated_at: failureTime,
      })
      .eq("id", document.id)
      .eq("organization_id", organizationId);

    await adminClient.from("organization_knowledge_events").insert({
      organization_id: organizationId,
      actor_user_id: caller.id,
      document_id: document.id,
      event_type: "document_failed",
      event_metadata: {
        operation: "delete",
        file_name: document.file_name,
        error: errorMessage,
      },
    });

    return jsonResponse(
      {
        error: errorMessage,
        documentId: document.id,
      },
      500,
    );
  }
});
