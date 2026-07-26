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
const maximumPollingAttempts = 45;
const pollingDelayMilliseconds = 2000;

type ProcessKnowledgeDocumentRequest = {
  organizationId?: unknown;
  documentId?: unknown;
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
  uploaded_by_user_id: string | null;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
  document_status: string;
  is_active: boolean;
  openai_file_id: string | null;
  openai_vector_store_file_id: string | null;
};

type OpenAiErrorBody = {
  error?: {
    message?: string;
  };
};

type OpenAiFileResponse = OpenAiErrorBody & {
  id?: string;
  filename?: string;
  purpose?: string;
  status?: string;
};

type OpenAiVectorStoreResponse = OpenAiErrorBody & {
  id?: string;
  name?: string;
  status?: string;
};

type OpenAiVectorStoreFileResponse = OpenAiErrorBody & {
  id?: string;
  vector_store_id?: string;
  status?: string;
  last_error?: {
    code?: string;
    message?: string;
  } | null;
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

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getOpenAiHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "OpenAI-Beta": "assistants=v2",
  };
}

async function readOpenAiResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const responseText = await response.text();

  let responseBody: T & OpenAiErrorBody;

  try {
    responseBody = JSON.parse(responseText) as T & OpenAiErrorBody;
  } catch {
    console.error("OpenAI returned a non-JSON response.", {
      fallbackMessage,
      status: response.status,
      statusText: response.statusText,
      responseText: responseText.slice(0, 4000),
    });

    throw new Error(
      `${fallbackMessage} OpenAI returned status ${response.status}.`,
    );
  }

  if (!response.ok) {
    console.error("OpenAI request failed.", {
      fallbackMessage,
      status: response.status,
      statusText: response.statusText,
      responseBody,
    });

    throw new Error(
      responseBody.error?.message ||
        `${fallbackMessage} OpenAI returned status ${response.status}.`,
    );
  }

  return responseBody;
}

async function createOpenAiVectorStore(apiKey: string, organizationId: string) {
  const response = await fetch("https://api.openai.com/v1/vector_stores", {
    method: "POST",
    headers: {
      ...getOpenAiHeaders(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Everward Organization Knowledge ${organizationId}`,
      metadata: {
        organization_id: organizationId,
        source: "everward_organization_portal",
      },
    }),
  });

  const responseBody = await readOpenAiResponse<OpenAiVectorStoreResponse>(
    response,
    "The OpenAI vector store could not be created.",
  );

  if (!responseBody.id) {
    throw new Error("OpenAI did not return a vector store ID.");
  }

  return responseBody.id;
}

async function uploadFileToOpenAi(
  apiKey: string,
  fileName: string,
  mimeType: string,
  fileData: ArrayBuffer,
) {
  const formData = new FormData();

  formData.append("purpose", "assistants");
  formData.append(
    "file",
    new Blob([fileData], {
      type: mimeType || "application/octet-stream",
    }),
    fileName,
  );

  const response = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: getOpenAiHeaders(apiKey),
    body: formData,
  });

  const responseBody = await readOpenAiResponse<OpenAiFileResponse>(
    response,
    "The company document could not be uploaded to OpenAI.",
  );

  if (!responseBody.id) {
    throw new Error("OpenAI did not return a file ID.");
  }

  return responseBody.id;
}

async function attachFileToVectorStore(
  apiKey: string,
  vectorStoreId: string,
  openAiFileId: string,
) {
  const response = await fetch(
    `https://api.openai.com/v1/vector_stores/${encodeURIComponent(
      vectorStoreId,
    )}/files`,
    {
      method: "POST",
      headers: {
        ...getOpenAiHeaders(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_id: openAiFileId,
      }),
    },
  );

  const responseBody = await readOpenAiResponse<OpenAiVectorStoreFileResponse>(
    response,
    "The company document could not be attached to the OpenAI vector store.",
  );

  if (!responseBody.id) {
    throw new Error("OpenAI did not return a vector store file ID.");
  }

  return responseBody.id;
}

async function waitForVectorStoreFile(
  apiKey: string,
  vectorStoreId: string,
  vectorStoreFileId: string,
) {
  for (let attempt = 1; attempt <= maximumPollingAttempts; attempt += 1) {
    const response = await fetch(
      `https://api.openai.com/v1/vector_stores/${encodeURIComponent(
        vectorStoreId,
      )}/files/${encodeURIComponent(vectorStoreFileId)}`,
      {
        method: "GET",
        headers: getOpenAiHeaders(apiKey),
      },
    );

    const responseBody =
      await readOpenAiResponse<OpenAiVectorStoreFileResponse>(
        response,
        "The company document processing status could not be retrieved.",
      );

    if (responseBody.status === "completed") {
      return;
    }

    if (
      responseBody.status === "failed" ||
      responseBody.status === "cancelled"
    ) {
      throw new Error(
        responseBody.last_error?.message ||
          `OpenAI document processing ended with status "${responseBody.status}".`,
      );
    }

    if (attempt < maximumPollingAttempts) {
      await delay(pollingDelayMilliseconds);
    }
  }

  throw new Error(
    "The company document is still processing after the permitted wait period. Try processing it again.",
  );
}

async function deleteOpenAiFile(apiKey: string, openAiFileId: string) {
  try {
    await fetch(
      `https://api.openai.com/v1/files/${encodeURIComponent(openAiFileId)}`,
      {
        method: "DELETE",
        headers: getOpenAiHeaders(apiKey),
      },
    );
  } catch (error) {
    console.error(
      "OpenAI file cleanup failed:",
      error instanceof Error ? error.message : error,
    );
  }
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
      "Required document-processing environment variables are missing.",
    );

    return jsonResponse(
      {
        error: "The company knowledge document processor is not configured.",
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

  let requestBody: ProcessKnowledgeDocumentRequest;

  try {
    requestBody = (await request.json()) as ProcessKnowledgeDocumentRequest;
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
        error: "A valid company knowledge document ID is required.",
      },
      400,
    );
  }

  const [membershipResult, knowledgeAccessResult, documentResult] =
    await Promise.all([
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

      adminClient
        .from("organization_knowledge_documents")
        .select(
          `
          id,
          organization_id,
          knowledge_base_id,
          uploaded_by_user_id,
          file_name,
          storage_bucket,
          storage_path,
          mime_type,
          file_size_bytes,
          document_status,
          is_active,
          openai_file_id,
          openai_vector_store_file_id
        `,
        )
        .eq("id", documentId)
        .eq("organization_id", organizationId)
        .maybeSingle(),
    ]);

  if (
    membershipResult.error ||
    !membershipResult.data ||
    !["organization_admin", "user_admin"].includes(membershipResult.data.role)
  ) {
    return jsonResponse(
      {
        error:
          "Only an active Organization Admin or User Admin can process company knowledge documents.",
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

  if (documentResult.error || !documentResult.data) {
    return jsonResponse(
      {
        error: "The selected company knowledge document was not found.",
      },
      404,
    );
  }

  const document = documentResult.data as KnowledgeDocumentRecord;

  if (
    document.storage_bucket !== storageBucket ||
    !document.storage_path.startsWith(`${organizationId}/${documentId}/`)
  ) {
    return jsonResponse(
      {
        error: "The company knowledge document storage location is invalid.",
      },
      400,
    );
  }

  if (
    !document.is_active ||
    document.document_status === "deleted" ||
    document.document_status === "deleting"
  ) {
    return jsonResponse(
      {
        error: "The selected company knowledge document is not active.",
      },
      409,
    );
  }

  if (document.document_status === "ready") {
    return jsonResponse(
      {
        message: "The company knowledge document is already ready.",
        document: {
          id: document.id,
          fileName: document.file_name,
          status: document.document_status,
          openAiFileId: document.openai_file_id,
          openAiVectorStoreFileId: document.openai_vector_store_file_id,
        },
      },
      200,
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

  if (knowledgeBaseError || !knowledgeBaseData) {
    return jsonResponse(
      {
        error: "The organization company knowledge base could not be loaded.",
      },
      500,
    );
  }

  const knowledgeBase = knowledgeBaseData as KnowledgeBaseRecord;

  const processingStartedAt = new Date().toISOString();

  const { error: processingUpdateError } = await adminClient
    .from("organization_knowledge_documents")
    .update({
      document_status: "processing",
      error_message: null,
      updated_at: processingStartedAt,
    })
    .eq("id", documentId)
    .eq("organization_id", organizationId);

  if (processingUpdateError) {
    console.error(
      "Company document processing status could not be saved:",
      processingUpdateError,
    );

    return jsonResponse(
      {
        error: "The company document could not be marked for processing.",
      },
      500,
    );
  }

  const { error: startedEventError } = await adminClient
    .from("organization_knowledge_events")
    .insert({
      organization_id: organizationId,
      actor_user_id: caller.id,
      document_id: documentId,
      event_type: "document_processing_started",
      event_metadata: {
        file_name: document.file_name,
        storage_path: document.storage_path,
      },
    });

  if (startedEventError) {
    console.error(
      "Document processing-start event could not be recorded:",
      startedEventError,
    );
  }

  let openAiFileId = document.openai_file_id;
  let vectorStoreId = knowledgeBase.openai_vector_store_id;
  let vectorStoreFileId = document.openai_vector_store_file_id;

  try {
    const { data: storageFile, error: storageDownloadError } =
      await adminClient.storage
        .from(storageBucket)
        .download(document.storage_path);

    if (storageDownloadError || !storageFile) {
      throw new Error(
        storageDownloadError?.message ||
          "The uploaded company document could not be downloaded from secure storage.",
      );
    }

    const fileData = await storageFile.arrayBuffer();

    if (fileData.byteLength <= 0) {
      throw new Error("The uploaded company document is empty.");
    }

    if (fileData.byteLength > maximumFileSizeBytes) {
      throw new Error("Company documents cannot be larger than 50 MB.");
    }

    if (Number(document.file_size_bytes) !== fileData.byteLength) {
      throw new Error(
        "The uploaded company document size does not match the prepared upload.",
      );
    }

    if (!vectorStoreId) {
      const createdVectorStoreId = await createOpenAiVectorStore(
        openAiApiKey,
        organizationId,
      );

      const { data: updatedKnowledgeBase, error: vectorStoreSaveError } =
        await adminClient
          .from("organization_knowledge_bases")
          .update({
            openai_vector_store_id: createdVectorStoreId,
            status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("id", knowledgeBase.id)
          .eq("organization_id", organizationId)
          .is("openai_vector_store_id", null)
          .select(
            `
              id,
              organization_id,
              openai_vector_store_id,
              status
            `,
          )
          .maybeSingle();

      if (vectorStoreSaveError) {
        throw new Error(
          `The OpenAI vector store was created but could not be saved: ${vectorStoreSaveError.message}`,
        );
      }

      if (updatedKnowledgeBase?.openai_vector_store_id) {
        vectorStoreId = updatedKnowledgeBase.openai_vector_store_id;

        await adminClient.from("organization_knowledge_events").insert({
          organization_id: organizationId,
          actor_user_id: caller.id,
          document_id: documentId,
          event_type: "knowledge_base_created",
          event_metadata: {
            openai_vector_store_id: vectorStoreId,
          },
        });
      } else {
        const { data: concurrentKnowledgeBase, error: concurrentLoadError } =
          await adminClient
            .from("organization_knowledge_bases")
            .select("openai_vector_store_id")
            .eq("id", knowledgeBase.id)
            .eq("organization_id", organizationId)
            .maybeSingle();

        if (
          concurrentLoadError ||
          !concurrentKnowledgeBase?.openai_vector_store_id
        ) {
          throw new Error(
            "The organization OpenAI vector store could not be resolved.",
          );
        }

        vectorStoreId = concurrentKnowledgeBase.openai_vector_store_id;
      }
    }

    if (!vectorStoreId) {
      throw new Error(
        "The organization does not have a valid OpenAI vector store.",
      );
    }

    if (!openAiFileId) {
      openAiFileId = await uploadFileToOpenAi(
        openAiApiKey,
        document.file_name,
        document.mime_type,
        fileData,
      );

      const { error: openAiFileSaveError } = await adminClient
        .from("organization_knowledge_documents")
        .update({
          openai_file_id: openAiFileId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("organization_id", organizationId);

      if (openAiFileSaveError) {
        await deleteOpenAiFile(openAiApiKey, openAiFileId);

        throw new Error(
          `The OpenAI file was uploaded but its ID could not be saved: ${openAiFileSaveError.message}`,
        );
      }
    }

    if (!vectorStoreFileId) {
      vectorStoreFileId = await attachFileToVectorStore(
        openAiApiKey,
        vectorStoreId,
        openAiFileId,
      );

      const { error: vectorStoreFileSaveError } = await adminClient
        .from("organization_knowledge_documents")
        .update({
          openai_vector_store_file_id: vectorStoreFileId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("organization_id", organizationId);

      if (vectorStoreFileSaveError) {
        throw new Error(
          `The file was attached to the vector store but its ID could not be saved: ${vectorStoreFileSaveError.message}`,
        );
      }
    }

    await waitForVectorStoreFile(
      openAiApiKey,
      vectorStoreId,
      vectorStoreFileId,
    );

    const processedAt = new Date().toISOString();

    const { data: readyDocument, error: readyUpdateError } = await adminClient
      .from("organization_knowledge_documents")
      .update({
        document_status: "ready",
        openai_file_id: openAiFileId,
        openai_vector_store_file_id: vectorStoreFileId,
        error_message: null,
        processed_at: processedAt,
        updated_at: processedAt,
      })
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .select(
        `
            id,
            organization_id,
            knowledge_base_id,
            file_name,
            mime_type,
            file_size_bytes,
            document_status,
            openai_file_id,
            openai_vector_store_file_id,
            processed_at
          `,
      )
      .single();

    if (readyUpdateError || !readyDocument) {
      throw new Error(
        readyUpdateError?.message ||
          "The completed document status could not be saved.",
      );
    }

    const { error: uploadedEventError } = await adminClient
      .from("organization_knowledge_events")
      .insert({
        organization_id: organizationId,
        actor_user_id: caller.id,
        document_id: documentId,
        event_type: "document_uploaded",
        event_metadata: {
          file_name: document.file_name,
          storage_path: document.storage_path,
          openai_file_id: openAiFileId,
        },
      });

    if (uploadedEventError) {
      console.error(
        "Document-uploaded event could not be recorded:",
        uploadedEventError,
      );
    }

    const { error: readyEventError } = await adminClient
      .from("organization_knowledge_events")
      .insert({
        organization_id: organizationId,
        actor_user_id: caller.id,
        document_id: documentId,
        event_type: "document_ready",
        event_metadata: {
          file_name: document.file_name,
          openai_file_id: openAiFileId,
          openai_vector_store_id: vectorStoreId,
          openai_vector_store_file_id: vectorStoreFileId,
        },
      });

    if (readyEventError) {
      console.error(
        "Document-ready event could not be recorded:",
        readyEventError,
      );
    }

    return jsonResponse(
      {
        message:
          "The company document was processed and added to Company Knowledge AI.",
        knowledgeBase: {
          id: knowledgeBase.id,
          openAiVectorStoreId: vectorStoreId,
          status: "active",
        },
        document: readyDocument,
      },
      200,
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "The company document could not be processed.";

    console.error("Company knowledge document processing failed:", {
      organizationId,
      documentId,
      error: errorMessage,
    });

    const failedAt = new Date().toISOString();

    await adminClient
      .from("organization_knowledge_documents")
      .update({
        document_status: "failed",
        openai_file_id: openAiFileId,
        openai_vector_store_file_id: vectorStoreFileId,
        error_message: errorMessage,
        updated_at: failedAt,
      })
      .eq("id", documentId)
      .eq("organization_id", organizationId);

    await adminClient.from("organization_knowledge_events").insert({
      organization_id: organizationId,
      actor_user_id: caller.id,
      document_id: documentId,
      event_type: "document_failed",
      event_metadata: {
        file_name: document.file_name,
        error: errorMessage,
        openai_file_id: openAiFileId,
        openai_vector_store_id: vectorStoreId,
        openai_vector_store_file_id: vectorStoreFileId,
      },
    });

    return jsonResponse(
      {
        error: errorMessage,
        documentId,
      },
      500,
    );
  }
});
