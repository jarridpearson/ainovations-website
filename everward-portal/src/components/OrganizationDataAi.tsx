import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";

type OrganizationDataAiProps = {
  organizationId: string;
  scopeLabel: string;
  selectedUserIds: string[];
  selectedGroupIds: string[];
  reportDetailSearchQuery: string;
};

type PortalCreditSummary = {
  portal_credits_available: number;
  portal_credits_used: number;
  portal_credit_renewal_date: string | null;
};

type JsonRecord = Record<string, unknown>;

type OrganizationDataQuestion = {
  id: string;
  question_text: string;
  answer_text: string | null;
  answer_status: string;
  credit_status: string | null;
  credits_used: number | null;
  error_message: string | null;
  scope_snapshot: JsonRecord | null;
  data_snapshot: JsonRecord | null;
  created_at: string;
  completed_at: string | null;
};

type AskOrganizationDataResponse = {
  answer?: string;
  questionId?: string;
  duplicateRequest?: boolean;
  question?: Partial<OrganizationDataQuestion>;
  error?: string;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not completed";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsedDate);
}

function sanitizeFileName(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized || "organization-data-ai-answer";
}

function getObjectKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value as JsonRecord);
}

function getCollectionCount(value: unknown) {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (value && typeof value === "object") {
    return Object.keys(value as JsonRecord).length;
  }

  return value === null || value === undefined ? 0 : 1;
}

function formatEvidenceLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getSavedReportingScope(
  scopeSnapshot: JsonRecord | null | undefined,
  fallback: string,
) {
  const savedLabel = scopeSnapshot?.reportingScopeLabel;

  return typeof savedLabel === "string" && savedLabel.trim()
    ? savedLabel.trim()
    : fallback;
}

function OrganizationDataAi({
  organizationId,
  scopeLabel,
  selectedUserIds,
  selectedGroupIds,
  reportDetailSearchQuery,
}: OrganizationDataAiProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [creditSummary, setCreditSummary] =
    useState<PortalCreditSummary | null>(null);
  const [isLoadingCredits, setIsLoadingCredits] = useState(false);

  const [questionHistory, setQuestionHistory] = useState<
    OrganizationDataQuestion[]
  >([]);
  const [selectedHistoryQuestion, setSelectedHistoryQuestion] =
    useState<OrganizationDataQuestion | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyMessage, setHistoryMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  const activeAnswerRecord = useMemo(() => {
    if (
      selectedHistoryQuestion &&
      selectedHistoryQuestion.answer_text?.trim() === answer.trim()
    ) {
      return selectedHistoryQuestion;
    }

    return null;
  }, [answer, selectedHistoryQuestion]);

  const loadPortalCreditSummary = useCallback(async () => {
    setIsLoadingCredits(true);

    const { data, error } = await supabase.rpc(
      "get_organization_portal_credit_summary",
      {
        p_organization_id: organizationId,
      },
    );

    if (error) {
      console.error(
        "Organization data AI portal credits could not be loaded:",
        error,
      );
      setCreditSummary(null);
      setIsLoadingCredits(false);
      return;
    }

    const summary = data?.[0];

    if (!summary) {
      setCreditSummary(null);
      setIsLoadingCredits(false);
      return;
    }

    setCreditSummary({
      portal_credits_available: Number(summary.portal_credits_available ?? 0),
      portal_credits_used: Number(summary.portal_credits_used ?? 0),
      portal_credit_renewal_date: summary.portal_credit_renewal_date ?? null,
    });

    setIsLoadingCredits(false);
  }, [organizationId]);

  const loadQuestionHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryMessage("");

    const { data, error } = await supabase
      .from("organization_ai_questions")
      .select(
        `
          id,
          question_text,
          answer_text,
          answer_status,
          credit_status,
          credits_used,
          error_message,
          scope_snapshot,
          data_snapshot,
          created_at,
          completed_at
        `,
      )
      .eq("organization_id", organizationId)
      .eq("portal_view", "analyze")
      .order("created_at", {
        ascending: false,
      })
      .limit(20);

    if (error) {
      console.error(
        "Organization Data AI question history could not be loaded:",
        error,
      );
      setQuestionHistory([]);
      setHistoryMessage("Unable to load previous Organization Data AI answers.");
      setIsLoadingHistory(false);
      return;
    }

    setQuestionHistory((data ?? []) as OrganizationDataQuestion[]);
    setIsLoadingHistory(false);
  }, [organizationId]);

  useEffect(() => {
    void loadPortalCreditSummary();
    void loadQuestionHistory();
  }, [loadPortalCreditSummary, loadQuestionHistory]);

  async function handleAskQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedQuestion = question.trim();

    if (!normalizedQuestion) {
      setMessage("Enter a question about the selected organization data.");
      return;
    }

    if (creditSummary && creditSummary.portal_credits_available < 1) {
      setMessage("No portal AI credits are currently available.");
      return;
    }

    setIsAsking(true);
    setAnswer("");
    setSelectedHistoryQuestion(null);
    setCopyMessage("");
    setMessage(`Analyzing data for ${scopeLabel}...`);

    try {
      const { data, error } =
        await supabase.functions.invoke<AskOrganizationDataResponse>(
          "ask-organization-data",
          {
            body: {
              organizationId,
              requestId: crypto.randomUUID(),
              portalView: "analyze",
              question: normalizedQuestion,
              scopeLabel:
                selectedUserIds.length === 0 &&
                selectedGroupIds.length === 0
                  ? "Whole organization"
                  : scopeLabel,
              selectedUserIds,
              selectedGroupIds,
              reportDetailSearchQuery: reportDetailSearchQuery.trim(),
            },
          },
        );

      if (error) {
        let functionErrorMessage = error.message;

        if ("context" in error && error.context instanceof Response) {
          try {
            const errorBody =
              (await error.context.json()) as AskOrganizationDataResponse;

            if (errorBody.error) {
              functionErrorMessage = errorBody.error;
            }
          } catch {
            // Keep the original Supabase function error.
          }
        }

        throw new Error(functionErrorMessage);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      const returnedAnswer = data?.answer ?? data?.question?.answer_text ?? "";

      if (!returnedAnswer.trim()) {
        throw new Error("Organization Data AI did not return an answer.");
      }

      setAnswer(returnedAnswer);
      setQuestion("");
      setMessage(
        data?.duplicateRequest
          ? "The existing answer was loaded."
          : "The selected organization data was analyzed successfully.",
      );

      await Promise.all([
        loadPortalCreditSummary(),
        loadQuestionHistory(),
      ]);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The organization data question could not be answered.";

      console.error("Organization Data AI question failed:", error);
      setMessage(errorMessage);

      await Promise.all([
        loadPortalCreditSummary(),
        loadQuestionHistory(),
      ]);
    } finally {
      setIsAsking(false);
    }
  }

  function openHistoryQuestion(historyQuestion: OrganizationDataQuestion) {
    setSelectedHistoryQuestion(historyQuestion);
    setAnswer(historyQuestion.answer_text ?? "");
    setMessage(
      historyQuestion.answer_status === "completed"
        ? "Previous Organization Data AI answer loaded."
        : historyQuestion.error_message ||
            `Previous question status: ${historyQuestion.answer_status}`,
    );
    setCopyMessage("");
  }

  async function copyAnswer() {
    if (!answer.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(answer);
      setCopyMessage("Answer copied.");
    } catch (error) {
      console.error("Organization Data AI answer could not be copied:", error);
      setCopyMessage("Unable to copy the answer.");
    }
  }

  function exportAnswer() {
    if (!answer.trim()) {
      return;
    }

    const answerRecord = activeAnswerRecord;
    const exportedQuestion =
      answerRecord?.question_text ?? "Organization Data AI question";
    const exportedCreatedAt = answerRecord?.created_at
      ? formatDateTime(answerRecord.created_at)
      : formatDateTime(new Date().toISOString());

    const exportParts = [
      "Everward Organization Data AI",
      "",
      `Question: ${exportedQuestion}`,
      `Generated: ${exportedCreatedAt}`,
      `Scope: ${scopeLabel}`,
      "",
      "Answer",
      "------",
      answer,
    ];

    if (answerRecord?.scope_snapshot) {
      exportParts.push(
        "",
        "Authorized Scope Snapshot",
        "-------------------------",
        JSON.stringify(answerRecord.scope_snapshot, null, 2),
      );
    }

    if (answerRecord?.data_snapshot) {
      exportParts.push(
        "",
        "Evidence Snapshot",
        "-----------------",
        JSON.stringify(answerRecord.data_snapshot, null, 2),
      );
    }

    const blob = new Blob([exportParts.join("\n")], {
      type: "text/plain;charset=utf-8",
    });

    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    downloadLink.href = downloadUrl;
    downloadLink.download = `${sanitizeFileName(exportedQuestion)}.txt`;

    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();

    URL.revokeObjectURL(downloadUrl);
  }

  return (
    <section className="report-filter-section" style={{ marginTop: "22px" }}>
      <div className="dashboard-section-heading">
        <div>
          <p className="eyebrow">Portal AI analysis</p>
          <h2>Ask AI About This Data</h2>
          <p>
            Ask questions about priorities, decisions, Trackables, progress,
            patterns, risks, or opportunities for the currently selected people
            or groups.
          </p>
        </div>

        <div
          style={{
            backgroundColor: "white",
            border: "1px solid #d8e2e2",
            borderRadius: "14px",
            padding: "12px 16px",
            minWidth: "170px",
            textAlign: "right",
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
            }}
          >
            Portal AI Credits
          </span>

          <strong
            style={{
              display: "block",
              color: "#2f7e7e",
              fontSize: "24px",
            }}
          >
            {isLoadingCredits
              ? "..."
              : (creditSummary?.portal_credits_available ?? 0)}
          </strong>

          <small>available</small>
        </div>
      </div>

      <div className="report-scope-summary">
        <span>AI analysis scope</span>
        <strong>{scopeLabel}</strong>
      </div>

      <div
        className="billing-availability-notice"
        style={{ marginBottom: "18px" }}
      >
        <strong>Uses 1 portal AI credit per question</strong>
        <p>
          The AI can only analyze organization data the signed-in portal user is
          authorized to access.
        </p>
      </div>

      <form onSubmit={handleAskQuestion}>
        <div className="setup-field">
          <label htmlFor="organization-data-ai-question">
            Question about the selected data
          </label>

          <textarea
            id="organization-data-ai-question"
            value={question}
            rows={6}
            maxLength={4000}
            disabled={isAsking}
            placeholder="Example: What patterns are preventing this group from making progress on its active priorities?"
            onChange={(event) => {
              setQuestion(event.target.value);
              setMessage("");
            }}
          />

          <small>{question.length.toLocaleString()} of 4,000 characters</small>
        </div>

        <button
          className="primary-button"
          type="submit"
          disabled={
            isAsking ||
            !question.trim() ||
            creditSummary?.portal_credits_available === 0
          }
        >
          {isAsking ? "Analyzing selected data..." : "Ask AI About This Data"}
        </button>
      </form>

      {creditSummary ? (
        <p className="company-knowledge-credit-note">
          Portal AI credits remaining:{" "}
          <strong>{creditSummary.portal_credits_available}</strong>
          {" · "}
          Used this billing period:{" "}
          <strong>{creditSummary.portal_credits_used}</strong>
        </p>
      ) : null}

      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}

      {answer ? (
        <div className="company-knowledge-answer" style={{ marginTop: "18px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "14px",
            }}
          >
            <div>
              <span className="dashboard-card-label">
                Organization Data AI Answer
              </span>

              {activeAnswerRecord ? (
                <p style={{ margin: "4px 0 0", color: "#647575" }}>
                  Asked {formatDateTime(activeAnswerRecord.created_at)}
                </p>
              ) : null}

              <div
                style={{
                  marginTop: "8px",
                  backgroundColor: "#edf7f7",
                  border: "1px solid #c9e2e2",
                  borderRadius: "10px",
                  color: "#315f5f",
                  fontSize: "14px",
                  fontWeight: 800,
                  padding: "9px 12px",
                }}
              >
                Data scope:{" "}
                {getSavedReportingScope(
                  activeAnswerRecord?.scope_snapshot,
                  selectedUserIds.length === 0 &&
                    selectedGroupIds.length === 0
                    ? "Whole organization"
                    : scopeLabel,
                )}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
              }}
            >
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  void copyAnswer();
                }}
              >
                Copy answer
              </button>

              <button
                className="text-button"
                type="button"
                onClick={exportAnswer}
              >
                Export answer
              </button>
            </div>
          </div>

          {copyMessage ? (
            <p className="form-message" role="status">
              {copyMessage}
            </p>
          ) : null}

          <p style={{ whiteSpace: "pre-wrap" }}>{answer}</p>

          {activeAnswerRecord ? (
            <details
              style={{
                marginTop: "18px",
                borderTop: "1px solid #d8e2e2",
                paddingTop: "16px",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  color: "#2f7e7e",
                  fontWeight: 800,
                }}
              >
                View evidence and authorized scope
              </summary>

              <div
                style={{
                  display: "grid",
                  gap: "18px",
                  marginTop: "16px",
                }}
              >
                <div>
                  <span className="dashboard-card-label">
                    Evidence included in this analysis
                  </span>

                  {getObjectKeys(activeAnswerRecord.data_snapshot).length > 0 ? (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "10px",
                        marginTop: "10px",
                      }}
                    >
                      {getObjectKeys(activeAnswerRecord.data_snapshot).map(
                        (evidenceKey) => (
                          <span
                            key={evidenceKey}
                            style={{
                              backgroundColor: "#edf7f7",
                              border: "1px solid #c9e2e2",
                              borderRadius: "999px",
                              color: "#315f5f",
                              fontSize: "13px",
                              fontWeight: 700,
                              padding: "7px 11px",
                            }}
                          >
                            {formatEvidenceLabel(evidenceKey)}:{" "}
                            {getCollectionCount(
                              activeAnswerRecord.data_snapshot?.[evidenceKey],
                            )}
                          </span>
                        ),
                      )}
                    </div>
                  ) : (
                    <p>No saved evidence summary is available.</p>
                  )}
                </div>

                <div>
                  <span className="dashboard-card-label">
                    Authorized scope used
                  </span>

                  <pre
                    style={{
                      backgroundColor: "#f6f9f9",
                      border: "1px solid #d8e2e2",
                      borderRadius: "12px",
                      fontFamily: "inherit",
                      fontSize: "13px",
                      lineHeight: 1.55,
                      margin: "10px 0 0",
                      maxHeight: "320px",
                      overflow: "auto",
                      padding: "14px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(
                      activeAnswerRecord.scope_snapshot ?? {},
                      null,
                      2,
                    )}
                  </pre>
                </div>

                <details>
                  <summary
                    style={{
                      cursor: "pointer",
                      color: "#2f7e7e",
                      fontWeight: 800,
                    }}
                  >
                    View complete saved evidence snapshot
                  </summary>

                  <pre
                    style={{
                      backgroundColor: "#f6f9f9",
                      border: "1px solid #d8e2e2",
                      borderRadius: "12px",
                      fontFamily: "inherit",
                      fontSize: "13px",
                      lineHeight: 1.55,
                      margin: "10px 0 0",
                      maxHeight: "520px",
                      overflow: "auto",
                      padding: "14px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(
                      activeAnswerRecord.data_snapshot ?? {},
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      <section style={{ marginTop: "28px" }}>
        <div className="dashboard-section-heading">
          <div>
            <p className="eyebrow">Saved analysis</p>
            <h3>Organization Data AI History</h3>
            <p>
              Reopen previous answers without using another portal AI credit.
            </p>
          </div>

          <button
            className="text-button"
            type="button"
            disabled={isLoadingHistory}
            onClick={() => {
              void loadQuestionHistory();
            }}
          >
            {isLoadingHistory ? "Refreshing..." : "Refresh history"}
          </button>
        </div>

        {historyMessage ? (
          <p className="form-message" role="alert">
            {historyMessage}
          </p>
        ) : null}

        {isLoadingHistory ? (
          <p className="form-message">Loading previous AI questions...</p>
        ) : questionHistory.length === 0 ? (
          <p className="form-message">
            No Organization Data AI questions have been saved yet.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "12px",
            }}
          >
            {questionHistory.map((historyQuestion) => (
              <article
                key={historyQuestion.id}
                style={{
                  backgroundColor: "white",
                  border:
                    selectedHistoryQuestion?.id === historyQuestion.id
                      ? "2px solid #2f7e7e"
                      : "1px solid #d8e2e2",
                  borderRadius: "14px",
                  padding: "16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "14px",
                  }}
                >
                  <div style={{ flex: "1 1 420px" }}>
                    <span className="dashboard-card-label">
                      {formatDateTime(historyQuestion.created_at)}
                    </span>

                    <div
                      style={{
                        margin: "7px 0 10px",
                        color: "#315f5f",
                        fontSize: "13px",
                        fontWeight: 800,
                      }}
                    >
                      Data scope:{" "}
                      {getSavedReportingScope(
                        historyQuestion.scope_snapshot,
                        "Reporting scope unavailable",
                      )}
                    </div>

                    <strong
                      style={{
                        display: "block",
                        fontSize: "16px",
                        marginTop: "5px",
                      }}
                    >
                      {historyQuestion.question_text}
                    </strong>

                    <p
                      style={{
                        color: "#647575",
                        margin: "8px 0 0",
                      }}
                    >
                      Status: {formatEvidenceLabel(historyQuestion.answer_status)}
                      {" · "}
                      Credits used: {historyQuestion.credits_used ?? 0}
                    </p>

                    {historyQuestion.error_message ? (
                      <p className="field-error">
                        {historyQuestion.error_message}
                      </p>
                    ) : null}
                  </div>

                  <button
                    className="text-button"
                    type="button"
                    disabled={!historyQuestion.answer_text?.trim()}
                    onClick={() => {
                      openHistoryQuestion(historyQuestion);
                    }}
                  >
                    {historyQuestion.answer_text?.trim()
                      ? "Open answer"
                      : "No answer available"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

export default OrganizationDataAi;
