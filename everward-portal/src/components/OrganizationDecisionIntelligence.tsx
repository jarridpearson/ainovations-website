import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type OrganizationDecisionIntelligenceProps = {
  organizationId: string;
  canTrigger: boolean;
  reportableUsers: Array<{ user_id: string; full_name: string }>;
};

type ConflictCheckMode = "batch" | "deep";

type PortalCreditSummary = {
  portal_credits_available: number;
  portal_credits_used: number;
};

type ConflictResult = {
  person_a: string;
  priority_a: string;
  person_b: string;
  priority_b: string;
  explanation: string;
};

type ConflictCheckHistoryRow = {
  id: string;
  mode: ConflictCheckMode;
  status: string;
  credit_status: string | null;
  credits_used: number | null;
  result_json: { conflicts?: ConflictResult[] } | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

type RunConflictCheckResponse = {
  message?: string;
  checkId?: string;
  mode?: ConflictCheckMode;
  conflicts?: ConflictResult[];
  creditsUsed?: number;
  duplicateRequest?: boolean;
  check?: ConflictCheckHistoryRow;
  error?: string;
  upgradeRequired?: boolean;
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

function getConflictCheckCost(
  mode: ConflictCheckMode,
  sideACount: number,
  sideBCount: number,
) {
  if (mode === "batch") {
    return sideACount * 1;
  }

  return (sideACount + sideBCount) * 1;
}

type CalibrationCategoryBreakdown = {
  category: string;
  total: number;
  overconfident: number;
  underconfident: number;
  well_calibrated: number;
};

type CalibrationMonthBreakdown = {
  month: string;
  total: number;
  well_calibrated: number;
};

type CalibrationMember = {
  user_id: string;
  band: "Overconfident" | "Underconfident" | "Well-Calibrated" | null;
  score: number | null;
  total_checkins: number;
  overconfident_count?: number;
  underconfident_count?: number;
  well_calibrated_count?: number;
  by_category: CalibrationCategoryBreakdown[];
  by_month: CalibrationMonthBreakdown[];
  open_loop_count: number;
};

type CalibrationAggregate = {
  band: string;
  score: number | null;
  totalCheckins: number;
  overconfident: number;
  underconfident: number;
  wellCalibrated: number;
  openLoopCount: number;
  topCategories: CalibrationCategoryBreakdown[];
  byMonth: CalibrationMonthBreakdown[];
};

function aggregateCalibrationMembers(
  members: CalibrationMember[],
): CalibrationAggregate {
  let totalCheckins = 0;
  let overconfident = 0;
  let underconfident = 0;
  let wellCalibrated = 0;
  let openLoopCount = 0;

  const categoryTotals = new Map<string, CalibrationCategoryBreakdown>();
  const monthTotals = new Map<string, CalibrationMonthBreakdown>();

  members.forEach((member) => {
    totalCheckins += member.total_checkins ?? 0;
    overconfident += member.overconfident_count ?? 0;
    underconfident += member.underconfident_count ?? 0;
    wellCalibrated += member.well_calibrated_count ?? 0;
    openLoopCount += member.open_loop_count ?? 0;

    (member.by_category ?? []).forEach((category) => {
      const existing = categoryTotals.get(category.category) ?? {
        category: category.category,
        total: 0,
        overconfident: 0,
        underconfident: 0,
        well_calibrated: 0,
      };

      existing.total += category.total;
      existing.overconfident += category.overconfident;
      existing.underconfident += category.underconfident;
      existing.well_calibrated += category.well_calibrated;

      categoryTotals.set(category.category, existing);
    });

    (member.by_month ?? []).forEach((month) => {
      const existing = monthTotals.get(month.month) ?? {
        month: month.month,
        total: 0,
        well_calibrated: 0,
      };

      existing.total += month.total;
      existing.well_calibrated += month.well_calibrated;

      monthTotals.set(month.month, existing);
    });
  });

  let band = "No Data";

  if (totalCheckins > 0) {
    if (overconfident > underconfident && overconfident > wellCalibrated) {
      band = "Overconfident";
    } else if (underconfident > overconfident && underconfident > wellCalibrated) {
      band = "Underconfident";
    } else {
      band = "Well-Calibrated";
    }
  }

  return {
    band,
    score: totalCheckins > 0 ? Math.round((wellCalibrated / totalCheckins) * 1000) / 10 : null,
    totalCheckins,
    overconfident,
    underconfident,
    wellCalibrated,
    openLoopCount,
    topCategories: Array.from(categoryTotals.values()).sort(
      (a, b) => b.total - a.total,
    ),
    byMonth: Array.from(monthTotals.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    ),
  };
}

function getCalibrationBandColor(band: string) {
  if (band === "Well-Calibrated") {
    return "#2f7e7e";
  }

  if (band === "Overconfident") {
    return "#b91c1c";
  }

  if (band === "Underconfident") {
    return "#b45309";
  }

  return "#647575";
}

function OrganizationDecisionIntelligence({
  organizationId,
  canTrigger,
  reportableUsers,
}: OrganizationDecisionIntelligenceProps) {
  const [mode, setMode] = useState<ConflictCheckMode>("batch");
  const [sideAUserIds, setSideAUserIds] = useState<Set<string>>(new Set());
  const [sideBUserIds, setSideBUserIds] = useState<Set<string>>(new Set());
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [isUpgradeMessage, setIsUpgradeMessage] = useState(false);
  const [lastResult, setLastResult] = useState<{
    mode: ConflictCheckMode;
    conflicts: ConflictResult[];
    creditsUsed: number;
  } | null>(null);

  const [creditSummary, setCreditSummary] =
    useState<PortalCreditSummary | null>(null);
  const [isLoadingCredits, setIsLoadingCredits] = useState(false);

  const [history, setHistory] = useState<ConflictCheckHistoryRow[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [calibrationMembers, setCalibrationMembers] = useState<
    CalibrationMember[]
  >([]);
  const [isLoadingCalibration, setIsLoadingCalibration] = useState(false);
  const [calibrationError, setCalibrationError] = useState("");
  const [comparisonSideAUserIds, setComparisonSideAUserIds] = useState<
    Set<string>
  >(new Set());
  const [comparisonSideBUserIds, setComparisonSideBUserIds] = useState<
    Set<string>
  >(new Set());

  const loadPortalCreditSummary = useCallback(async () => {
    setIsLoadingCredits(true);

    const { data, error } = await supabase.rpc(
      "get_organization_portal_credit_summary",
      { p_organization_id: organizationId },
    );

    if (error) {
      console.error("Decision Intelligence portal credits could not be loaded:", error);
      setCreditSummary(null);
      setIsLoadingCredits(false);
      return;
    }

    const summary = data?.[0];

    setCreditSummary(
      summary
        ? {
            portal_credits_available: Number(
              summary.portal_credits_available ?? 0,
            ),
            portal_credits_used: Number(summary.portal_credits_used ?? 0),
          }
        : null,
    );

    setIsLoadingCredits(false);
  }, [organizationId]);

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);

    const { data, error } = await supabase
      .from("organization_conflict_checks")
      .select(
        `id, mode, status, credit_status, credits_used, result_json, error_message, created_at, completed_at`,
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Conflict check history could not be loaded:", error);
      setHistory([]);
      setIsLoadingHistory(false);
      return;
    }

    setHistory((data ?? []) as ConflictCheckHistoryRow[]);
    setIsLoadingHistory(false);
  }, [organizationId]);

  const loadCalibrationReport = useCallback(async () => {
    if (reportableUsers.length === 0) {
      setCalibrationMembers([]);
      return;
    }

    setIsLoadingCalibration(true);
    setCalibrationError("");

    const { data, error } = await supabase.rpc(
      "get_organization_calibration_report",
      {
        p_organization_id: organizationId,
        p_user_ids: reportableUsers.map((user) => user.user_id),
      },
    );

    if (error) {
      console.error("Calibration report could not be loaded:", error);
      setCalibrationError(error.message);
      setCalibrationMembers([]);
      setIsLoadingCalibration(false);
      return;
    }

    setCalibrationMembers((data?.members ?? []) as CalibrationMember[]);
    setIsLoadingCalibration(false);
  }, [organizationId, reportableUsers]);

  useEffect(() => {
    void loadPortalCreditSummary();
    void loadHistory();
    void loadCalibrationReport();
  }, [loadPortalCreditSummary, loadHistory, loadCalibrationReport]);

  function toggleComparisonSideAUser(userId: string) {
    setComparisonSideAUserIds((current) => {
      const next = new Set(current);

      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }

      return next;
    });
  }

  function toggleComparisonSideBUser(userId: string) {
    setComparisonSideBUserIds((current) => {
      const next = new Set(current);

      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }

      return next;
    });
  }

  const calibrationMemberByUserId = new Map(
    calibrationMembers.map((member) => [member.user_id, member]),
  );

  const fullNameByUserId = new Map(
    reportableUsers.map((user) => [user.user_id, user.full_name]),
  );

  const orgWideCalibration = aggregateCalibrationMembers(calibrationMembers);

  const comparisonSideAAggregate =
    comparisonSideAUserIds.size > 0
      ? aggregateCalibrationMembers(
          Array.from(comparisonSideAUserIds)
            .map((userId) => calibrationMemberByUserId.get(userId))
            .filter((member): member is CalibrationMember => Boolean(member)),
        )
      : null;

  const comparisonSideBAggregate =
    comparisonSideBUserIds.size > 0
      ? aggregateCalibrationMembers(
          Array.from(comparisonSideBUserIds)
            .map((userId) => calibrationMemberByUserId.get(userId))
            .filter((member): member is CalibrationMember => Boolean(member)),
        )
      : null;

  function toggleSideAUser(userId: string) {
    setSideAUserIds((current) => {
      const next = new Set(current);

      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }

      return next;
    });
  }

  function toggleSideBUser(userId: string) {
    setSideBUserIds((current) => {
      const next = new Set(current);

      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }

      return next;
    });
  }

  const effectiveSideBUserIds = mode === "batch" ? new Set<string>() : sideBUserIds;

  const projectedCost = getConflictCheckCost(
    mode,
    sideAUserIds.size,
    effectiveSideBUserIds.size,
  );

  async function handleRunCheck() {
    if (sideAUserIds.size === 0) {
      setMessage("Select at least one person to check.");
      return;
    }

    if (creditSummary && creditSummary.portal_credits_available < projectedCost) {
      setMessage(
        `This run needs ${projectedCost} portal AI credit${projectedCost === 1 ? "" : "s"}, but only ${creditSummary.portal_credits_available} ${creditSummary.portal_credits_available === 1 ? "is" : "are"} available.`,
      );
      return;
    }

    const confirmed = window.confirm(
      `This will run a ${mode === "batch" ? "batch" : "deep team"} conflict check on ${sideAUserIds.size + effectiveSideBUserIds.size} ${sideAUserIds.size + effectiveSideBUserIds.size === 1 ? "person" : "people"} and use ${projectedCost} portal AI credit${projectedCost === 1 ? "" : "s"}. Continue?`,
    );

    if (!confirmed) {
      return;
    }

    setIsRunning(true);
    setMessage("Running conflict check...");
    setLastResult(null);

    try {
      const { data, error } =
        await supabase.functions.invoke<RunConflictCheckResponse>(
          "run-organization-conflict-check",
          {
            body: {
              organizationId,
              requestId: crypto.randomUUID(),
              mode,
              sideAUserIds: Array.from(sideAUserIds),
              sideBUserIds: Array.from(effectiveSideBUserIds),
            },
          },
        );

      if (error) {
        let functionErrorMessage = error.message;
        let functionUpgradeRequired = false;

        if ("context" in error && error.context instanceof Response) {
          try {
            const errorBody =
              (await error.context.json()) as RunConflictCheckResponse;

            if (errorBody.error) {
              functionErrorMessage = errorBody.error;
            }

            functionUpgradeRequired = errorBody.upgradeRequired === true;
          } catch {
            // Keep the original Supabase function error.
          }
        }

        const thrownError = new Error(functionErrorMessage);
        (thrownError as Error & { upgradeRequired?: boolean }).upgradeRequired =
          functionUpgradeRequired;
        throw thrownError;
      }

      if (data?.error) {
        const thrownError = new Error(data.error);
        (thrownError as Error & { upgradeRequired?: boolean }).upgradeRequired =
          data.upgradeRequired === true;
        throw thrownError;
      }

      const conflicts =
        data?.conflicts ?? data?.check?.result_json?.conflicts ?? [];
      const creditsUsed = data?.creditsUsed ?? data?.check?.credits_used ?? 0;
      const resolvedMode = data?.mode ?? data?.check?.mode ?? mode;

      setLastResult({ mode: resolvedMode, conflicts, creditsUsed });
      setIsUpgradeMessage(false);
      setMessage(
        data?.duplicateRequest
          ? "This check already ran. Showing the existing result."
          : conflicts.length === 0
            ? "No conflicts were found for the selected people."
            : `Found ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}.`,
      );

      await Promise.all([loadPortalCreditSummary(), loadHistory()]);
    } catch (error) {
      setIsUpgradeMessage(
        (error as Error & { upgradeRequired?: boolean })?.upgradeRequired ===
          true,
      );
      setMessage(
        error instanceof Error
          ? error.message
          : "The conflict check could not be completed.",
      );

      await Promise.all([loadPortalCreditSummary(), loadHistory()]);
    } finally {
      setIsRunning(false);
    }
  }

  function openHistoryResult(row: ConflictCheckHistoryRow) {
    setLastResult({
      mode: row.mode,
      conflicts: row.result_json?.conflicts ?? [],
      creditsUsed: row.credits_used ?? 0,
    });
    setMessage(
      row.status === "completed"
        ? "Previous conflict check result loaded."
        : row.error_message || `Previous check status: ${row.status}`,
    );
  }

  return (
    <section className="report-filter-section" style={{ marginTop: "22px" }}>
      <div className="dashboard-section-heading">
        <div>
          <p className="eyebrow">Decision Intelligence</p>
          <h2>Conflict Detection</h2>
          <p>
            Check whether selected people's active priorities compete for the
            same time, money, or other limited resources.
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

          <strong style={{ display: "block", color: "#2f7e7e", fontSize: "24px" }}>
            {isLoadingCredits ? "..." : (creditSummary?.portal_credits_available ?? 0)}
          </strong>

          <small>available</small>
        </div>
      </div>

      {!canTrigger ? (
        <div className="billing-availability-notice" style={{ marginBottom: "18px" }}>
          <strong>View-only access</strong>
          <p>
            Your role can view conflict check results but cannot run a new
            check. Ask an organization administrator, user administrator, or
            an authorized Group Manager to run one.
          </p>
        </div>
      ) : (
        <>
          <div className="billing-availability-notice" style={{ marginBottom: "18px" }}>
            <strong>Two ways to check for conflicts</strong>
            <p>
              Batch checks each selected person only against their own
              priorities. Deep checks compare every selected person against
              every other selected person, including everyone in the company
              at once for a full company health check. Both cost 1 credit
              per person, charged on the real headcount on every side
              selected.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
              backgroundColor: "#edf7f7",
              border: "1px solid #c9e2e2",
              borderRadius: "14px",
              padding: "14px 16px",
              marginBottom: "18px",
            }}
          >
            <div>
              <strong style={{ color: "#315f5f" }}>Company health check</strong>
              <p style={{ margin: "4px 0 0", color: "#647575" }}>
                Select every active app user in the company for a deep
                conflict check -- {reportableUsers.length} people, 1 credit
                each.
              </p>
            </div>

            <button
              type="button"
              className="secondary-button"
              disabled={isRunning || reportableUsers.length === 0}
              onClick={() => {
                setMode("deep");
                setSideAUserIds(
                  new Set(reportableUsers.map((user) => user.user_id)),
                );
                setSideBUserIds(new Set());
                setMessage("");
              }}
            >
              Select Everyone (Company Health Check)
            </button>
          </div>

          <div style={{ display: "flex", gap: "10px", marginBottom: "18px" }}>
            <button
              type="button"
              className={mode === "batch" ? "primary-button" : "secondary-button"}
              onClick={() => {
                setMode("batch");
                setSideBUserIds(new Set());
                setMessage("");
              }}
              disabled={isRunning}
            >
              Batch check (1 credit/person)
            </button>

            <button
              type="button"
              className={mode === "deep" ? "primary-button" : "secondary-button"}
              onClick={() => {
                setMode("deep");
                setMessage("");
              }}
              disabled={isRunning}
            >
              Deep team check (1 credit/person)
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                mode === "deep" ? "repeat(auto-fit, minmax(260px, 1fr))" : "1fr",
              gap: "18px",
              marginBottom: "18px",
            }}
          >
            <section className="report-selection-panel">
              <div className="report-selection-heading">
                <div>
                  <strong>{mode === "batch" ? "People" : "Side A"}</strong>
                  <span>{sideAUserIds.size} selected</span>
                </div>

                <button
                  className="text-button"
                  type="button"
                  disabled={sideAUserIds.size === 0}
                  onClick={() => setSideAUserIds(new Set())}
                >
                  Clear
                </button>
              </div>

              {reportableUsers.length === 0 ? (
                <p className="report-selection-empty">
                  No active app users are available.
                </p>
              ) : (
                <div className="report-checkbox-list">
                  {reportableUsers.map((user) => (
                    <label key={user.user_id} className="report-checkbox-option">
                      <input
                        type="checkbox"
                        checked={sideAUserIds.has(user.user_id)}
                        onChange={() => toggleSideAUser(user.user_id)}
                      />
                      <span>
                        <strong>{user.full_name}</strong>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            {mode === "deep" ? (
              <section className="report-selection-panel">
                <div className="report-selection-heading">
                  <div>
                    <strong>Side B (optional)</strong>
                    <span>{sideBUserIds.size} selected</span>
                  </div>

                  <button
                    className="text-button"
                    type="button"
                    disabled={sideBUserIds.size === 0}
                    onClick={() => setSideBUserIds(new Set())}
                  >
                    Clear
                  </button>
                </div>

                <p className="report-selection-empty" style={{ marginBottom: "10px" }}>
                  Leave empty to compare everyone in Side A against each
                  other. Select people here to compare Side A against this
                  separate team instead.
                </p>

                {reportableUsers.length === 0 ? (
                  <p className="report-selection-empty">
                    No active app users are available.
                  </p>
                ) : (
                  <div className="report-checkbox-list">
                    {reportableUsers.map((user) => (
                      <label key={user.user_id} className="report-checkbox-option">
                        <input
                          type="checkbox"
                          checked={sideBUserIds.has(user.user_id)}
                          onChange={() => toggleSideBUser(user.user_id)}
                        />
                        <span>
                          <strong>{user.full_name}</strong>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
              marginBottom: "12px",
            }}
          >
            <p style={{ margin: 0, color: "#315f5f", fontWeight: 800 }}>
              This run will use {projectedCost} portal AI credit
              {projectedCost === 1 ? "" : "s"}.
            </p>

            <button
              className="primary-button"
              type="button"
              disabled={isRunning || sideAUserIds.size === 0}
              onClick={() => {
                void handleRunCheck();
              }}
            >
              {isRunning
                ? "Running conflict check..."
                : mode === "batch"
                  ? "Run Batch Conflict Check"
                  : "Run Deep Team Conflict Check"}
            </button>
          </div>
        </>
      )}

      {message ? (
        <p
          className={
            isUpgradeMessage ? "form-message form-message-upgrade" : "form-message"
          }
          role="status"
        >
          {isUpgradeMessage ? `Upgrade to Unlock: ${message}` : message}
        </p>
      ) : null}

      {lastResult ? (
        <div className="company-knowledge-answer" style={{ marginTop: "18px" }}>
          <span className="dashboard-card-label">
            {lastResult.mode === "batch" ? "Batch" : "Deep team"} conflict check
            result -- {lastResult.creditsUsed} credit
            {lastResult.creditsUsed === 1 ? "" : "s"} used
          </span>

          {lastResult.conflicts.length === 0 ? (
            <p style={{ marginTop: "10px" }}>
              No conflicts were found for the selected people.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "12px", marginTop: "12px" }}>
              {lastResult.conflicts.map((conflict, index) => (
                <div
                  key={index}
                  style={{
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fca5a5",
                    borderRadius: "12px",
                    padding: "14px",
                  }}
                >
                  <strong style={{ color: "#b91c1c" }}>
                    {conflict.person_a} ({conflict.priority_a}) vs.{" "}
                    {conflict.person_b} ({conflict.priority_b})
                  </strong>
                  <p style={{ margin: "6px 0 0", color: "#647575" }}>
                    {conflict.explanation}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <section style={{ marginTop: "28px" }}>
        <div className="dashboard-section-heading">
          <div>
            <p className="eyebrow">Saved results</p>
            <h3>Conflict Check History</h3>
            <p>Reopen previous results without using another portal AI credit.</p>
          </div>

          <button
            className="text-button"
            type="button"
            disabled={isLoadingHistory}
            onClick={() => {
              void loadHistory();
            }}
          >
            {isLoadingHistory ? "Refreshing..." : "Refresh history"}
          </button>
        </div>

        {isLoadingHistory ? (
          <p className="form-message">Loading previous conflict checks...</p>
        ) : history.length === 0 ? (
          <p className="form-message">No conflict checks have been run yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {history.map((row) => (
              <article
                key={row.id}
                style={{
                  backgroundColor: "white",
                  border: "1px solid #d8e2e2",
                  borderRadius: "14px",
                  padding: "16px",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "14px",
                }}
              >
                <div>
                  <span className="dashboard-card-label">
                    {formatDateTime(row.created_at)}
                  </span>

                  <strong style={{ display: "block", fontSize: "16px", marginTop: "5px" }}>
                    {row.mode === "batch" ? "Batch check" : "Deep team check"}
                  </strong>

                  <p style={{ color: "#647575", margin: "8px 0 0" }}>
                    Status: {row.status}
                    {" · "}
                    Credits used: {row.credits_used ?? 0}
                  </p>

                  {row.error_message ? (
                    <p className="field-error">{row.error_message}</p>
                  ) : null}
                </div>

                <button
                  className="text-button"
                  type="button"
                  disabled={row.status !== "completed"}
                  onClick={() => openHistoryResult(row)}
                >
                  {row.status === "completed" ? "Open result" : "Not available"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: "40px" }}>
        <div className="dashboard-section-heading">
          <div>
            <p className="eyebrow">Decision Intelligence</p>
            <h2>Calibration Reporting</h2>
            <p>
              How well each person's decision predictions matched what
              actually happened. This is a read-only report -- viewing it
              never uses a portal AI credit.
            </p>
          </div>

          <button
            className="text-button"
            type="button"
            disabled={isLoadingCalibration}
            onClick={() => {
              void loadCalibrationReport();
            }}
          >
            {isLoadingCalibration ? "Refreshing..." : "Refresh report"}
          </button>
        </div>

        {calibrationError ? (
          <p className="field-error">{calibrationError}</p>
        ) : null}

        {isLoadingCalibration ? (
          <p className="form-message">Loading calibration report...</p>
        ) : (
          <>
            <div
              style={{
                backgroundColor: "white",
                border: "1px solid #d8e2e2",
                borderRadius: "14px",
                padding: "18px",
                marginBottom: "20px",
              }}
            >
              <span className="dashboard-card-label">Org-wide</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginTop: "6px" }}>
                <strong
                  style={{
                    fontSize: "22px",
                    color: getCalibrationBandColor(orgWideCalibration.band),
                  }}
                >
                  {orgWideCalibration.band}
                </strong>
                {orgWideCalibration.score !== null ? (
                  <span style={{ fontSize: "20px", fontWeight: 800, color: "#315f5f" }}>
                    {orgWideCalibration.score}%
                  </span>
                ) : null}
              </div>
              <p style={{ color: "#647575", margin: "8px 0 0" }}>
                {orgWideCalibration.totalCheckins} check-in
                {orgWideCalibration.totalCheckins === 1 ? "" : "s"} completed
                {" · "}
                {orgWideCalibration.openLoopCount} open-loop decision
                {orgWideCalibration.openLoopCount === 1 ? "" : "s"}
              </p>
            </div>

            <div style={{ display: "grid", gap: "12px", marginBottom: "28px" }}>
              {calibrationMembers.length === 0 ? (
                <p className="form-message">No calibration data yet.</p>
              ) : (
                calibrationMembers.map((member) => (
                  <article
                    key={member.user_id}
                    style={{
                      backgroundColor: "white",
                      border: "1px solid #d8e2e2",
                      borderRadius: "14px",
                      padding: "16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "12px",
                    }}
                  >
                    <div>
                      <strong style={{ display: "block", fontSize: "15px" }}>
                        {fullNameByUserId.get(member.user_id) ?? "Unnamed user"}
                      </strong>
                      <p style={{ color: "#647575", margin: "6px 0 0" }}>
                        {member.total_checkins} check-in
                        {member.total_checkins === 1 ? "" : "s"}
                        {" · "}
                        {member.open_loop_count} open-loop
                      </p>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <strong
                        style={{
                          display: "block",
                          color: getCalibrationBandColor(member.band ?? "No Data"),
                        }}
                      >
                        {member.band ?? "No Data"}
                      </strong>
                      {member.score !== null ? (
                        <span style={{ color: "#315f5f", fontWeight: 800 }}>
                          {member.score}%
                        </span>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="billing-availability-notice" style={{ marginBottom: "18px" }}>
              <strong>Compare two people or teams</strong>
              <p>
                Select people for each side to compare their calibration
                side by side. Select multiple people on a side to compare
                as a team.
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "18px",
                marginBottom: "18px",
              }}
            >
              <section className="report-selection-panel">
                <div className="report-selection-heading">
                  <div>
                    <strong>Side A</strong>
                    <span>{comparisonSideAUserIds.size} selected</span>
                  </div>

                  <button
                    className="text-button"
                    type="button"
                    disabled={comparisonSideAUserIds.size === 0}
                    onClick={() => setComparisonSideAUserIds(new Set())}
                  >
                    Clear
                  </button>
                </div>

                <div className="report-checkbox-list">
                  {reportableUsers.map((user) => (
                    <label key={user.user_id} className="report-checkbox-option">
                      <input
                        type="checkbox"
                        checked={comparisonSideAUserIds.has(user.user_id)}
                        onChange={() => toggleComparisonSideAUser(user.user_id)}
                      />
                      <span>
                        <strong>{user.full_name}</strong>
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="report-selection-panel">
                <div className="report-selection-heading">
                  <div>
                    <strong>Side B</strong>
                    <span>{comparisonSideBUserIds.size} selected</span>
                  </div>

                  <button
                    className="text-button"
                    type="button"
                    disabled={comparisonSideBUserIds.size === 0}
                    onClick={() => setComparisonSideBUserIds(new Set())}
                  >
                    Clear
                  </button>
                </div>

                <div className="report-checkbox-list">
                  {reportableUsers.map((user) => (
                    <label key={user.user_id} className="report-checkbox-option">
                      <input
                        type="checkbox"
                        checked={comparisonSideBUserIds.has(user.user_id)}
                        onChange={() => toggleComparisonSideBUser(user.user_id)}
                      />
                      <span>
                        <strong>{user.full_name}</strong>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            </div>

            {comparisonSideAAggregate || comparisonSideBAggregate ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "18px",
                }}
              >
                {[
                  { label: "Side A", aggregate: comparisonSideAAggregate },
                  { label: "Side B", aggregate: comparisonSideBAggregate },
                ].map(({ label, aggregate }) =>
                  aggregate ? (
                    <div
                      key={label}
                      style={{
                        backgroundColor: "white",
                        border: "1px solid #d8e2e2",
                        borderRadius: "14px",
                        padding: "18px",
                      }}
                    >
                      <span className="dashboard-card-label">{label}</span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: "10px",
                          margin: "6px 0 10px",
                        }}
                      >
                        <strong
                          style={{
                            fontSize: "18px",
                            color: getCalibrationBandColor(aggregate.band),
                          }}
                        >
                          {aggregate.band}
                        </strong>
                        {aggregate.score !== null ? (
                          <span style={{ fontWeight: 800, color: "#315f5f" }}>
                            {aggregate.score}%
                          </span>
                        ) : null}
                      </div>

                      <p style={{ color: "#647575", margin: "0 0 10px" }}>
                        {aggregate.totalCheckins} check-in
                        {aggregate.totalCheckins === 1 ? "" : "s"} completed
                        {" · "}
                        {aggregate.openLoopCount} open-loop
                      </p>

                      {aggregate.topCategories.length > 0 ? (
                        <>
                          <strong style={{ display: "block", fontSize: "13px", marginBottom: "6px" }}>
                            Top categories
                          </strong>
                          {aggregate.topCategories.slice(0, 4).map((category) => (
                            <p
                              key={category.category}
                              style={{ color: "#647575", margin: "2px 0", fontSize: "13px" }}
                            >
                              {category.category}: {category.overconfident} over ·{" "}
                              {category.underconfident} under ·{" "}
                              {category.well_calibrated} well-calibrated
                            </p>
                          ))}
                        </>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      key={label}
                      style={{
                        border: "1px dashed #d8e2e2",
                        borderRadius: "14px",
                        padding: "18px",
                        color: "#647575",
                      }}
                    >
                      {label}: select at least one person to compare.
                    </div>
                  ),
                )}
              </div>
            ) : null}
          </>
        )}
      </section>
    </section>
  );
}

export default OrganizationDecisionIntelligence;
