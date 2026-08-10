import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { supabase } from "../lib/supabase";

type OrganizationKnowledgeProps = {
  organizationId: string;
  role: string;
};

type KnowledgeDocument = {
  id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  document_status: string;
  is_active: boolean;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
  deleted_at: string | null;
};

type KnowledgeCitation = {
  fileId?: string;
  fileName?: string;
  index?: number;
  quote?: string;
};

type KnowledgeQuestion = {
  id: string;
  question_text: string;
  answer_text: string | null;
  citations: KnowledgeCitation[];
  answer_status: string;
  credits_used: number;
  credit_status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

type PrepareUploadResponse = {
  document?: {
    id: string;
    file_name: string;
    storage_bucket: string;
    storage_path: string;
    mime_type: string;
    file_size_bytes: number;
    document_status: string;
  };
  upload?: {
    bucket: string;
    path: string;
    token: string;
    signedUrl: string;
    expiresInSeconds: number;
  };
  limits?: {
    activeDocumentCountBeforeUpload: number;
    documentLimit: number;
    remainingDocumentSlotsAfterUpload: number;
  };
  error?: string;
};

type ProcessDocumentResponse = {
  document?: KnowledgeDocument;
  error?: string;
};

type DeleteDocumentResponse = {
  document?: KnowledgeDocument;
  error?: string;
};

type AskKnowledgeResponse = {
  answer?: string;
  citations?: KnowledgeCitation[];
  questionId?: string;
  creditsUsed?: number;
  creditStatus?: string;
  portalCreditsAvailable?: number | null;
  portalCreditsUsed?: number | null;
  portalCreditRenewalDate?: string | null;
  duplicateRequest?: boolean;
  question?: KnowledgeQuestion;
  error?: string;
};

type PortalCreditSummary = {
  portal_credits_available: number;
  portal_credits_used: number;
  portal_credit_renewal_date: string | null;
};

type StorageUsageSummary = {
  document_count: number;
  total_bytes: number;
  document_limit: number;
  free_tier_bytes: number;
  billable_bytes: number;
  estimated_daily_storage_cost_cents: number;
};

function formatFileSize(sizeInBytes: number) {
  if (!Number.isFinite(sizeInBytes) || sizeInBytes <= 0) {
    return "0 bytes";
  }

  if (sizeInBytes < 1024) {
    return `${sizeInBytes} bytes`;
  }

  const kilobytes = sizeInBytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function formatKnowledgeDate(value: string | null) {
  if (!value) {
    return "Not available";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return "Not available";
  }

  return parsedDate.toLocaleString();
}

function getDocumentStatusLabel(status: string) {
  switch (status) {
    case "uploaded":
      return "Uploaded";
    case "processing":
      return "Processing";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    case "deleting":
      return "Deleting";
    case "deleted":
      return "Deleted";
    default:
      return status
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }
}

function getCitationLabel(citation: KnowledgeCitation, citationIndex: number) {
  if (citation.fileName?.trim()) {
    return citation.fileName.trim();
  }

  if (citation.fileId?.trim()) {
    return citation.fileId.trim();
  }

  return `Source ${citationIndex + 1}`;
}

function normalizeCitations(value: unknown): KnowledgeCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (citation): citation is KnowledgeCitation =>
      Boolean(citation) && typeof citation === "object",
  );
}

function OrganizationKnowledge({
  organizationId,
  role,
}: OrganizationKnowledgeProps) {
  const canManageKnowledgeDocuments =
    role === "organization_admin" || role === "user_admin";

  const [hasKnowledgeAccess, setHasKnowledgeAccess] = useState<boolean | null>(
    null,
  );
  const [isLoadingAccess, setIsLoadingAccess] = useState(true);

  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [documentMessage, setDocumentMessage] = useState("");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);

  const [questionText, setQuestionText] = useState("");
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);
  const [questionMessage, setQuestionMessage] = useState("");
  const [latestAnswer, setLatestAnswer] = useState("");
  const [latestCitations, setLatestCitations] = useState<KnowledgeCitation[]>(
    [],
  );
  const [portalCreditSummary, setPortalCreditSummary] =
    useState<PortalCreditSummary | null>(null);
  const [isLoadingPortalCredits, setIsLoadingPortalCredits] = useState(false);

  const [storageUsage, setStorageUsage] =
    useState<StorageUsageSummary | null>(null);
  const [isLoadingStorageUsage, setIsLoadingStorageUsage] = useState(false);

  const [questionHistory, setQuestionHistory] = useState<KnowledgeQuestion[]>(
    [],
  );
  const [isLoadingQuestionHistory, setIsLoadingQuestionHistory] =
    useState(false);

  const loadKnowledgeAccess = useCallback(async () => {
    setIsLoadingAccess(true);

    const { data, error } = await supabase.rpc(
      "organization_has_company_knowledge_access",
      {
        p_organization_id: organizationId,
      },
    );

    if (error) {
      console.error("Company Knowledge access could not be checked:", error);
      setHasKnowledgeAccess(false);
      setIsLoadingAccess(false);
      return;
    }

    setHasKnowledgeAccess(data === true);
    setIsLoadingAccess(false);
  }, [organizationId]);

  const loadPortalCreditSummary = useCallback(async () => {
    setIsLoadingPortalCredits(true);

    const { data, error } = await supabase.rpc(
      "get_organization_portal_credit_summary",
      {
        p_organization_id: organizationId,
      },
    );

    if (error) {
      console.error(
        "Company Knowledge portal credits could not be loaded:",
        error,
      );
      setPortalCreditSummary(null);
      setIsLoadingPortalCredits(false);
      return;
    }

    const summary = data?.[0];

    if (!summary) {
      setPortalCreditSummary(null);
      setIsLoadingPortalCredits(false);
      return;
    }

    setPortalCreditSummary({
      portal_credits_available: Number(summary.portal_credits_available ?? 0),
      portal_credits_used: Number(summary.portal_credits_used ?? 0),
      portal_credit_renewal_date: summary.portal_credit_renewal_date ?? null,
    });

    setIsLoadingPortalCredits(false);
  }, [organizationId]);

  const loadStorageUsage = useCallback(async () => {
    setIsLoadingStorageUsage(true);

    const { data, error } = await supabase.rpc(
      "get_organization_document_storage_usage",
      {
        p_organization_id: organizationId,
      },
    );

    if (error) {
      console.error(
        "Company Knowledge storage usage could not be loaded:",
        error,
      );
      setStorageUsage(null);
      setIsLoadingStorageUsage(false);
      return;
    }

    const summary = data?.[0];

    if (!summary) {
      setStorageUsage(null);
      setIsLoadingStorageUsage(false);
      return;
    }

    setStorageUsage({
      document_count: Number(summary.document_count ?? 0),
      total_bytes: Number(summary.total_bytes ?? 0),
      document_limit: Number(summary.document_limit ?? 0),
      free_tier_bytes: Number(summary.free_tier_bytes ?? 0),
      billable_bytes: Number(summary.billable_bytes ?? 0),
      estimated_daily_storage_cost_cents: Number(
        summary.estimated_daily_storage_cost_cents ?? 0,
      ),
    });

    setIsLoadingStorageUsage(false);
  }, [organizationId]);

  useEffect(() => {
    if (hasKnowledgeAccess === true) {
      void loadPortalCreditSummary();
      void loadStorageUsage();
    }
  }, [hasKnowledgeAccess, loadPortalCreditSummary, loadStorageUsage]);

  const loadDocuments = useCallback(async () => {
    setIsLoadingDocuments(true);
    setDocumentMessage("");

    const { data, error } = await supabase
      .from("organization_knowledge_documents")
      .select(
        `
          id,
          file_name,
          mime_type,
          file_size_bytes,
          document_status,
          is_active,
          error_message,
          created_at,
          processed_at,
          deleted_at
        `,
      )
      .eq("organization_id", organizationId)
      .neq("document_status", "deleted")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("Company Knowledge documents could not be loaded:", error);
      setDocuments([]);
      setDocumentMessage("The company document library could not be loaded.");
      setIsLoadingDocuments(false);
      return;
    }

    setDocuments((data ?? []) as KnowledgeDocument[]);
    setIsLoadingDocuments(false);
  }, [organizationId]);

  const loadQuestionHistory = useCallback(async () => {
    setIsLoadingQuestionHistory(true);

    const { data, error } = await supabase
      .from("organization_knowledge_questions")
      .select(
        `
          id,
          question_text,
          answer_text,
          citations,
          answer_status,
          credits_used,
          credit_status,
          error_message,
          created_at,
          completed_at
        `,
      )
      .eq("organization_id", organizationId)
      .order("created_at", {
        ascending: false,
      })
      .limit(20);

    if (error) {
      console.error(
        "Company Knowledge question history could not be loaded:",
        error,
      );
      setQuestionHistory([]);
      setIsLoadingQuestionHistory(false);
      return;
    }

    setQuestionHistory(
      (data ?? []).map((question) => ({
        ...question,
        citations: normalizeCitations(question.citations),
      })) as KnowledgeQuestion[],
    );
    setIsLoadingQuestionHistory(false);
  }, [organizationId]);

  useEffect(() => {
    void loadKnowledgeAccess();
  }, [loadKnowledgeAccess]);

  useEffect(() => {
    if (hasKnowledgeAccess !== true) {
      return;
    }

    void loadDocuments();
    void loadQuestionHistory();
  }, [hasKnowledgeAccess, loadDocuments, loadQuestionHistory]);

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;

    setSelectedFile(nextFile);
    setDocumentMessage("");
  }

  async function handleUploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile) {
      setDocumentMessage("Select a company document to upload.");
      return;
    }

    if (!canManageKnowledgeDocuments) {
      setDocumentMessage(
        "Only an Organization Admin can upload company documents.",
      );
      return;
    }

    setIsUploadingDocument(true);
    setDocumentMessage("Preparing the secure document upload...");

    try {
      const { data: prepareData, error: prepareError } =
        await supabase.functions.invoke<PrepareUploadResponse>(
          "prepare-organization-knowledge-upload",
          {
            body: {
              organizationId,
              fileName: selectedFile.name,
              mimeType: selectedFile.type || "application/octet-stream",
              fileSizeBytes: selectedFile.size,
            },
          },
        );

      if (prepareError) {
        throw new Error(prepareError.message);
      }

      if (prepareData?.error) {
        throw new Error(prepareData.error);
      }

      if (
        !prepareData?.document?.id ||
        !prepareData.upload?.bucket ||
        !prepareData.upload.path ||
        !prepareData.upload.token
      ) {
        throw new Error(
          "The secure document upload information was incomplete.",
        );
      }

      setDocumentMessage("Uploading the company document...");

      const { error: uploadError } = await supabase.storage
        .from(prepareData.upload.bucket)
        .uploadToSignedUrl(
          prepareData.upload.path,
          prepareData.upload.token,
          selectedFile,
          {
            contentType: selectedFile.type || "application/octet-stream",
          },
        );

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      setDocumentMessage("Processing the document for Company Knowledge AI...");

      const { data: processData, error: processError } =
        await supabase.functions.invoke<ProcessDocumentResponse>(
          "process-organization-knowledge-document",
          {
            body: {
              organizationId,
              documentId: prepareData.document.id,
            },
          },
        );

      if (processError) {
        throw new Error(processError.message);
      }

      if (processData?.error) {
        throw new Error(processData.error);
      }

      setSelectedFile(null);

      const fileInput = document.getElementById(
        "organization-knowledge-file",
      ) as HTMLInputElement | null;

      if (fileInput) {
        fileInput.value = "";
      }

      setDocumentMessage(
        `${selectedFile.name} is ready for Company Knowledge AI.`,
      );

      await loadDocuments();
      void loadStorageUsage();
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The company document could not be uploaded.";

      console.error("Company Knowledge upload failed:", error);
      setDocumentMessage(errorMessage);
      await loadDocuments();
      void loadStorageUsage();
    } finally {
      setIsUploadingDocument(false);
    }
  }

  async function handleDeleteDocument(knowledgeDocument: KnowledgeDocument) {
    if (!canManageKnowledgeDocuments) {
      setDocumentMessage(
        "Only an Organization Admin can delete company documents.",
      );
      return;
    }

    const shouldDelete = window.confirm(
      `Delete "${knowledgeDocument.file_name}" from Company Knowledge AI?`,
    );

    if (!shouldDelete) {
      return;
    }

    setDocumentMessage(`Deleting ${knowledgeDocument.file_name}...`);

    try {
      const { data, error } =
        await supabase.functions.invoke<DeleteDocumentResponse>(
          "delete-organization-knowledge-document",
          {
            body: {
              organizationId,
              documentId: knowledgeDocument.id,
            },
          },
        );

      if (error) {
        throw new Error(error.message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setDocumentMessage(
        `${knowledgeDocument.file_name} was deleted successfully.`,
      );

      await loadDocuments();
      void loadStorageUsage();
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The company document could not be deleted.";

      console.error("Company Knowledge document deletion failed:", error);
      setDocumentMessage(errorMessage);
      await loadDocuments();
      void loadStorageUsage();
    }
  }

  async function handleAskQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedQuestion = questionText.trim();

    if (!normalizedQuestion) {
      setQuestionMessage(
        "Enter a question about the approved company documents.",
      );
      return;
    }

    const readyDocumentCount = documents.filter(
      (knowledgeDocument) =>
        knowledgeDocument.is_active &&
        knowledgeDocument.document_status === "ready",
    ).length;

    if (readyDocumentCount === 0) {
      setQuestionMessage(
        "At least one approved company document must be ready before asking a question.",
      );
      return;
    }

    setIsAskingQuestion(true);
    setQuestionMessage("Searching the approved company documents...");
    setLatestAnswer("");
    setLatestCitations([]);

    const requestId = crypto.randomUUID();

    try {
      const { data, error } =
        await supabase.functions.invoke<AskKnowledgeResponse>(
          "ask-organization-knowledge",
          {
            body: {
              organizationId,
              question: normalizedQuestion,
              requestId,
              creditSource: "portal",
            },
          },
        );

      if (error) {
        let functionErrorMessage = error.message;

        const errorContext = (
          error as {
            context?: Response;
          }
        ).context;

        if (errorContext) {
          try {
            const errorBody = (await errorContext.clone().json()) as {
              error?: string;
              message?: string;
              creditStatus?: string;
              remainingPersonalCredits?: number | null;
            };

            functionErrorMessage =
              errorBody.error || errorBody.message || functionErrorMessage;
          } catch {
            try {
              const errorText = await errorContext.clone().text();

              if (errorText.trim()) {
                functionErrorMessage = errorText.trim();
              }
            } catch {
              // Keep the original Supabase error message.
            }
          }
        }

        throw new Error(functionErrorMessage);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      const answer = data?.answer ?? data?.question?.answer_text ?? "";

      const citations = normalizeCitations(
        data?.citations ?? data?.question?.citations,
      );

      if (!answer.trim()) {
        throw new Error("Company Knowledge AI did not return an answer.");
      }

      setLatestAnswer(answer);
      setLatestCitations(citations);
      setQuestionText("");
      setQuestionMessage(
        data?.duplicateRequest
          ? "The existing answer was loaded."
          : "The company document question was answered successfully.",
      );

      if (
        typeof data?.portalCreditsAvailable === "number" &&
        typeof data?.portalCreditsUsed === "number"
      ) {
        setPortalCreditSummary({
          portal_credits_available: data.portalCreditsAvailable,
          portal_credits_used: data.portalCreditsUsed,
          portal_credit_renewal_date: data.portalCreditRenewalDate ?? null,
        });
      } else {
        await loadPortalCreditSummary();
      }

      await loadQuestionHistory();
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The company document question could not be answered.";

      console.error("Company Knowledge question failed:", error);
      setQuestionMessage(errorMessage);
      await loadQuestionHistory();
    } finally {
      setIsAskingQuestion(false);
    }
  }

  if (isLoadingAccess) {
    return (
      <section className="dashboard-management-section">
        <p className="form-message">Checking Company Knowledge AI access...</p>
      </section>
    );
  }

  if (!hasKnowledgeAccess) {
    return (
      <section className="dashboard-management-section">
        <div className="dashboard-section-heading">
          <div>
            <p className="eyebrow">Organization Pro</p>
            <h1>Company Knowledge AI</h1>
            <p>Ask questions using approved company documents as the source.</p>
          </div>
        </div>

        <div className="company-knowledge-locked-state">
          <strong>Organization Pro is required</strong>
          <p>
            Company Knowledge AI is available only to organizations with an
            active Organization Pro plan.
          </p>
        </div>
      </section>
    );
  }

  const readyDocuments = documents.filter(
    (knowledgeDocument) =>
      knowledgeDocument.is_active &&
      knowledgeDocument.document_status === "ready",
  );

  return (
    <section className="dashboard-management-section company-knowledge-section">
      <div className="dashboard-section-heading">
        <div>
          <p className="eyebrow">Organization Pro</p>
          <h1>Company Knowledge AI</h1>
          <p>
            Ask questions using your organization’s approved documents as the
            source. Each successfully answered question uses 1 organization
            portal AI credit.
          </p>
        </div>

        <div
          style={{
            backgroundColor: "white",
            border: "1px solid #d8e2e2",
            borderRadius: "14px",
            padding: "12px 16px",
            minWidth: "190px",
            textAlign: "right",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.06)",
          }}
        >
          <span
            style={{
              display: "block",
              color: "#647575",
              fontSize: "12px",
              fontWeight: 800,
              marginBottom: "4px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Portal AI Credits
          </span>

          <strong
            style={{
              display: "block",
              color: "#2f7e7e",
              fontSize: "24px",
              lineHeight: 1.1,
            }}
          >
            {isLoadingPortalCredits
              ? "..."
              : (portalCreditSummary?.portal_credits_available ?? 0)}
          </strong>

          <small
            style={{
              display: "block",
              color: "#647575",
              marginTop: "4px",
            }}
          >
            available
          </small>
        </div>
      </div>

      <div className="company-knowledge-grid">
        <article className="company-knowledge-panel">
          <div className="company-knowledge-panel-heading">
            <div>
              <span className="dashboard-card-label">Approved sources</span>
              <h2>Company Documents</h2>
            </div>

            <span className="company-knowledge-count">
              {readyDocuments.length} ready
            </span>
          </div>

          {storageUsage ? (
            <p className="company-knowledge-credit-note">
              {storageUsage.document_count} of {storageUsage.document_limit}{" "}
              documents used
              {" · "}
              {formatFileSize(storageUsage.total_bytes)} stored
              {storageUsage.billable_bytes > 0 ? (
                <>
                  {" · "}
                  <strong>
                    Over the free storage tier -- roughly $
                    {(storageUsage.estimated_daily_storage_cost_cents / 100).toFixed(2)}
                    /day in storage cost
                  </strong>
                </>
              ) : (
                <>{" · "}within the free storage tier, no extra storage cost</>
              )}
            </p>
          ) : isLoadingStorageUsage ? (
            <p className="company-knowledge-credit-note">
              Loading storage usage...
            </p>
          ) : null}

          {canManageKnowledgeDocuments ? (
            <form
              className="company-knowledge-upload-form"
              onSubmit={handleUploadDocument}
            >
              <div className="setup-field">
                <label htmlFor="organization-knowledge-file">
                  Add a company document
                </label>

                <input
                  id="organization-knowledge-file"
                  type="file"
                  disabled={isUploadingDocument}
                  onChange={handleFileSelection}
                  accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.html,.htm,.json,.ppt,.pptx"
                />

                <small>
                  Maximum file size: 50 MB. Upload only documents your
                  organization is authorized to use.
                </small>
              </div>

              <button
                className="primary-button company-knowledge-action-button"
                type="submit"
                disabled={isUploadingDocument || !selectedFile}
              >
                {isUploadingDocument
                  ? "Uploading and processing..."
                  : "Upload document"}
              </button>
            </form>
          ) : (
            <p className="company-knowledge-admin-note">
              Organization Admins and User Admins manage the approved document
              library.
            </p>
          )}

          {documentMessage ? (
            <p className="form-message">{documentMessage}</p>
          ) : null}

          {isLoadingDocuments ? (
            <p className="form-message">Loading company documents...</p>
          ) : documents.length === 0 ? (
            <div className="dashboard-empty-state">
              <strong>No company documents yet</strong>
              <p>
                An Organization Admin or User Admin must upload and process at
                least one approved document before questions can be asked.
              </p>
            </div>
          ) : (
            <div className="company-knowledge-document-list">
              {documents.map((knowledgeDocument) => (
                <article
                  className="company-knowledge-document-card"
                  key={knowledgeDocument.id}
                >
                  <div className="company-knowledge-document-main">
                    <div>
                      <strong>{knowledgeDocument.file_name}</strong>

                      <p>
                        {formatFileSize(knowledgeDocument.file_size_bytes)}
                        {" · "}
                        Added{" "}
                        {formatKnowledgeDate(knowledgeDocument.created_at)}
                      </p>
                    </div>

                    <span
                      className={`company-knowledge-status company-knowledge-status-${knowledgeDocument.document_status}`}
                    >
                      {getDocumentStatusLabel(
                        knowledgeDocument.document_status,
                      )}
                    </span>
                  </div>

                  {knowledgeDocument.error_message ? (
                    <p className="company-knowledge-document-error">
                      {knowledgeDocument.error_message}
                    </p>
                  ) : null}

                  {canManageKnowledgeDocuments ? (
                    <button
                      className="company-knowledge-delete-button"
                      type="button"
                      disabled={
                        isUploadingDocument ||
                        knowledgeDocument.document_status === "deleting"
                      }
                      onClick={() => {
                        void handleDeleteDocument(knowledgeDocument);
                      }}
                    >
                      Delete document
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="company-knowledge-panel">
          <div className="company-knowledge-panel-heading">
            <div>
              <span className="dashboard-card-label">Document questions</span>
              <h2>Ask Company Knowledge AI</h2>
            </div>
          </div>

          <div
            className="billing-availability-notice"
            style={{ marginBottom: "18px" }}
          >
            <strong>Uses 1 portal AI credit per successful answer</strong>
            <p>
              The credit is taken from the organization’s portal AI credit pool.
              Failed AI requests are automatically refunded.
            </p>
          </div>

          <form
            className="company-knowledge-question-form"
            onSubmit={handleAskQuestion}
          >
            <div className="setup-field">
              <label htmlFor="organization-knowledge-question">Question</label>

              <textarea
                id="organization-knowledge-question"
                value={questionText}
                disabled={isAskingQuestion || readyDocuments.length === 0}
                maxLength={4000}
                rows={6}
                placeholder="Ask a question that can be answered from the approved company documents."
                onChange={(event) => {
                  setQuestionText(event.target.value);
                  setQuestionMessage("");
                }}
              />

              <small>
                {questionText.length.toLocaleString()} of 4,000 characters
              </small>
            </div>

            <button
              className="primary-button company-knowledge-action-button"
              type="submit"
              disabled={
                isAskingQuestion ||
                !questionText.trim() ||
                readyDocuments.length === 0
              }
            >
              {isAskingQuestion ? "Searching documents..." : "Ask question"}
            </button>
          </form>

          {portalCreditSummary ? (
            <p className="company-knowledge-credit-note">
              Portal AI credits remaining:{" "}
              <strong>{portalCreditSummary.portal_credits_available}</strong>
              {" · "}
              Used this billing period:{" "}
              <strong>{portalCreditSummary.portal_credits_used}</strong>
            </p>
          ) : null}

          {questionMessage ? (
            <p className="form-message">{questionMessage}</p>
          ) : null}

          {latestAnswer ? (
            <div className="company-knowledge-answer">
              <span className="dashboard-card-label">Answer</span>

              <p>{latestAnswer}</p>

              {latestCitations.length > 0 ? (
                <div className="company-knowledge-citations">
                  <strong>Sources</strong>

                  <ul>
                    {latestCitations.map((citation, citationIndex) => (
                      <li
                        key={`${getCitationLabel(
                          citation,
                          citationIndex,
                        )}-${citationIndex}`}
                      >
                        <span>{getCitationLabel(citation, citationIndex)}</span>

                        {citation.quote?.trim() ? (
                          <small>{citation.quote.trim()}</small>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </article>
      </div>

      <article className="company-knowledge-panel company-knowledge-history-panel">
        <div className="company-knowledge-panel-heading">
          <div>
            <span className="dashboard-card-label">Recent activity</span>
            <h2>Question History</h2>
          </div>
        </div>

        {isLoadingQuestionHistory ? (
          <p className="form-message">Loading question history...</p>
        ) : questionHistory.length === 0 ? (
          <div className="dashboard-empty-state">
            <strong>No questions asked yet</strong>
            <p>Completed Company Knowledge AI questions will appear here.</p>
          </div>
        ) : (
          <div className="company-knowledge-history-list">
            {questionHistory.map((question) => (
              <details
                className="company-knowledge-history-item"
                key={question.id}
              >
                <summary>
                  <span>{question.question_text}</span>
                  <small>{formatKnowledgeDate(question.created_at)}</small>
                </summary>

                <div className="company-knowledge-history-content">
                  {question.answer_status === "completed" &&
                  question.answer_text ? (
                    <>
                      <p>{question.answer_text}</p>

                      {question.citations.length > 0 ? (
                        <div className="company-knowledge-citations">
                          <strong>Sources</strong>

                          <ul>
                            {question.citations.map(
                              (citation, citationIndex) => (
                                <li key={`${question.id}-${citationIndex}`}>
                                  <span>
                                    {getCitationLabel(citation, citationIndex)}
                                  </span>

                                  {citation.quote?.trim() ? (
                                    <small>{citation.quote.trim()}</small>
                                  ) : null}
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p>
                      {question.error_message ||
                        `Status: ${question.answer_status}`}
                    </p>
                  )}

                  <small>
                    Credits used: {question.credits_used}
                    {" · "}
                    Credit status: {question.credit_status}
                  </small>
                </div>
              </details>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

export default OrganizationKnowledge;
