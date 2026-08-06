import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { supabase } from "../lib/supabase";

type PendingChange = {
  id: string;
  change_type: string;
  change_status: string;
  current_plan_key: string | null;
  requested_plan_key: string | null;
  current_billing_interval: string | null;
  requested_billing_interval: string | null;
  current_seat_quantity: number | null;
  requested_seat_quantity: number | null;
  current_addon_quantity: number | null;
  requested_addon_quantity: number | null;
  effective_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

type BillingState = {
  organizationName: string;
  currentPlanKey: string | null;
  billingInterval: string | null;
  pendingPlanKey: string | null;
  pendingBillingInterval: string | null;
  pendingPaidSeatCount: number | null;
  subscriptionStatus: string | null;
  purchasedSeatCount: number;
  usedSeatCount: number;
  renewalDate: string | null;
  cancelAtPeriodEnd: boolean;
  hasAddonSubscription: boolean;
  currentPortalAddonCredits: number;
  currentAppAddonCredits: number;
  portalAddonOptions: number[];
  appAddonOptions: number[];
  pendingChanges: PendingChange[];
};

type OrganizationCreditBreakdown = {
  credit_pool_type: "portal" | "app";
  included_monthly_credits: number;
  recurring_addon_credits: number;
  total_monthly_credits: number;
  used_credits: number;
  remaining_credits: number;
  renewal_date: string | null;
};

type BillingPreview = {
  changeType: "plan" | "seats" | "addon";
  changeTiming: "immediate" | "renewal";
  description: string;
  amountDueToday: number;
  estimatedRenewalAmount: number | null;
  currency: string;
  effectiveAt: string | null;
  estimateNote: string | null;
};

type ConfirmationRequest = {
  title: string;
  action: string;
  body: Record<string, unknown>;
  preview: BillingPreview;
  warning?: string;
};

type Props = {
  organizationId: string;
};

// The only two plan keys every write path in manage-organization-billing,
// create-organization-checkout, and create-organization-signup validates
// against. Kept as the single source of truth for the dropdown so it can
// never silently diverge from what the backend actually accepts.
const PLAN_OPTIONS: { value: string; label: string }[] = [
  { value: "organization_starter", label: "Organization Starter" },
  { value: "organization_pro", label: "Organization Pro" },
];

const BILLING_INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual prepaid" },
];

// Defensive only: if the organization's actual current value is ever
// something outside the known option set, surface it instead of silently
// selecting nothing. Does not change what the backend accepts.
function withCurrentValueOption(
  options: { value: string; label: string }[],
  currentValue: string | null,
  labelForUnknown: (value: string) => string,
) {
  if (
    !currentValue ||
    options.some((option) => option.value === currentValue)
  ) {
    return options;
  }

  return [
    { value: currentValue, label: labelForUnknown(currentValue) },
    ...options,
  ];
}

function formatLabel(value: string | null) {
  if (!value) {
    return "Not available";
  }

  return value
    .replace(/^organization_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(
  amount: number,
  currency: string,
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function getUsagePercentage(used: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

function getStatusBadge(
  status: string | null,
  cancelAtPeriodEnd: boolean,
) {
  if (cancelAtPeriodEnd) {
    return {
      label: "Cancels at renewal",
      className: "billing-status-badge-warning",
    };
  }

  if (status === "active") {
    return {
      label: "Active",
      className: "billing-status-badge-active",
    };
  }

  if (status === "past_due" || status === "unpaid") {
    return {
      label: formatLabel(status),
      className: "billing-status-badge-warning",
    };
  }

  if (status === "canceled") {
    return {
      label: "Canceled",
      className: "billing-status-badge-canceled",
    };
  }

  return {
    label: status ? formatLabel(status) : "Not available",
    className: "billing-status-badge-neutral",
  };
}

function getPendingPoolLabel(
  change: PendingChange,
) {
  const pool = String(
    change.metadata?.addon_pool ?? "",
  );

  if (pool === "portal") {
    return "Portal AI credits";
  }

  if (pool === "app") {
    return "Shared app AI credits";
  }

  return "Recurring AI credits";
}

function describePendingChange(
  change: PendingChange,
) {
  if (change.change_type === "plan_change") {
    const currentPlan =
      formatLabel(change.current_plan_key);
    const requestedPlan =
      formatLabel(change.requested_plan_key);
    const currentInterval =
      formatLabel(change.current_billing_interval);
    const requestedInterval =
      formatLabel(change.requested_billing_interval);

    return (
      `${currentPlan} — ${currentInterval} → ` +
      `${requestedPlan} — ${requestedInterval}`
    );
  }

  if (change.change_type === "seat_decrease") {
    return (
      `${change.current_seat_quantity ?? "Current"} → ` +
      `${change.requested_seat_quantity ?? "Requested"} purchased app seats`
    );
  }

  if (
    change.change_type === "portal_credit_change" ||
    change.change_type === "app_credit_change"
  ) {
    const label = getPendingPoolLabel(change);
    const current =
      change.current_addon_quantity ?? 0;
    const requested =
      change.requested_addon_quantity ?? 0;

    return (
      `${label}: ` +
      `${current.toLocaleString("en-US")} → ` +
      `${requested.toLocaleString("en-US")}`
    );
  }

  if (
    change.change_type === "subscription_cancellation"
  ) {
    return "Subscription access ends at renewal";
  }

  return "Scheduled billing change";
}

export default function OrganizationBillingManager({
  organizationId,
}: Props) {
  const [billingState, setBillingState] =
    useState<BillingState | null>(null);

  // Initial values are intentionally empty/zero, never a hardcoded plan or
  // interval. They are populated exclusively from the organization's actual
  // *current* billing state once loadBillingState resolves — never from a
  // pending scheduled change, so the controls always match what the summary
  // card shows. See loadBillingState below for the single place these are set.
  const [selectedPlan, setSelectedPlan] =
    useState("");

  const [selectedInterval, setSelectedInterval] =
    useState("");

  const [seatQuantity, setSeatQuantity] =
    useState(1);

  const [portalCredits, setPortalCredits] =
    useState(0);

  const [appCredits, setAppCredits] =
    useState(0);

  const [hasAddonSubscription, setHasAddonSubscription] =
    useState(true);

  const [confirmation, setConfirmation] =
    useState<ConfirmationRequest | null>(null);

  const [creditBreakdown, setCreditBreakdown] =
    useState<OrganizationCreditBreakdown[]>([]);

  const [isLoading, setIsLoading] =
    useState(true);

  const [busyAction, setBusyAction] =
    useState("");

  const [message, setMessage] =
    useState("");

  const invokeBilling = useCallback(
    async (
      action: string,
      extraBody: Record<string, unknown> = {},
    ) => {
      const { data, error } =
        await supabase.functions.invoke(
          "manage-organization-billing",
          {
            body: {
              organizationId,
              action,
              ...extraBody,
            },
          },
        );

      if (error) {
        let errorMessage =
          error.message ||
          "Organization billing could not be updated.";
        let requiresAddonCheckout = false;

        if (
          "context" in error &&
          error.context instanceof Response
        ) {
          try {
            const responseBody =
              (await error.context.json()) as {
                error?: string;
                requiresAddonCheckout?: boolean;
              };

            if (responseBody.error) {
              errorMessage = responseBody.error;
            }

            requiresAddonCheckout =
              responseBody.requiresAddonCheckout === true;
          } catch {
            // Keep normal function error.
          }
        }

        throw Object.assign(new Error(errorMessage), {
          requiresAddonCheckout,
        });
      }

      if (data?.error) {
        throw Object.assign(new Error(String(data.error)), {
          requiresAddonCheckout:
            data?.requiresAddonCheckout === true,
        });
      }

      return data;
    },
    [organizationId],
  );

  // The organization's *current* state — not any pending/scheduled value —
  // is the only source for these five controls. Using pendingPlanKey /
  // pendingBillingInterval / pendingPaidSeatCount here was the root cause of
  // the dropdowns not matching the summary card: whenever a change was
  // already scheduled, the controls silently pre-filled with the *future*
  // value instead of the organization's actual current one. Scheduled
  // changes are still fully visible in the "Scheduled changes" section below
  // — they're just no longer used to seed what these editable controls show.
  const loadBillingState =
    useCallback(async () => {
      setIsLoading(true);
      setMessage("");

      try {
        const [
          data,
          creditBreakdownResult,
        ] = await Promise.all([
          invokeBilling(
            "get_state",
          ) as Promise<BillingState>,

          supabase.rpc(
            "get_organization_credit_breakdown",
            {
              p_organization_id: organizationId,
            },
          ),
        ]);

        if (creditBreakdownResult.error) {
          throw creditBreakdownResult.error;
        }

        setBillingState(data);

        setCreditBreakdown(
          (creditBreakdownResult.data ?? []).map(
            (row: {
  credit_pool_type?: unknown;
  included_monthly_credits?: unknown;
  recurring_addon_credits?: unknown;
  total_monthly_credits?: unknown;
  used_credits?: unknown;
  remaining_credits?: unknown;
  renewal_date?: string | null;
}) => ({
              credit_pool_type:
                row.credit_pool_type === "app"
                  ? "app"
                  : "portal",

              included_monthly_credits: Number(
                row.included_monthly_credits ?? 0,
              ),

              recurring_addon_credits: Number(
                row.recurring_addon_credits ?? 0,
              ),

              total_monthly_credits: Number(
                row.total_monthly_credits ?? 0,
              ),

              used_credits: Number(
                row.used_credits ?? 0,
              ),

              remaining_credits: Number(
                row.remaining_credits ?? 0,
              ),

              renewal_date:
                row.renewal_date ?? null,
            }),
          ),
        );

        setSelectedPlan(data.currentPlanKey ?? "");
        setSelectedInterval(data.billingInterval ?? "");

        setSeatQuantity(
          Math.max(1, data.purchasedSeatCount),
        );

        setPortalCredits(
          data.currentPortalAddonCredits,
        );

        setAppCredits(
          data.currentAppAddonCredits,
        );

        setHasAddonSubscription(
          data.hasAddonSubscription,
        );
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Organization billing could not be loaded.",
        );
      } finally {
        setIsLoading(false);
      }
    }, [invokeBilling, organizationId]);

  useEffect(() => {
    void loadBillingState();
  }, [loadBillingState]);

  async function previewChange(
    request: Omit<
      ConfirmationRequest,
      "preview"
    > & {
      previewBody: Record<string, unknown>;
    },
  ) {
    setBusyAction("preview");
    setMessage("");

    try {
      const preview =
        (await invokeBilling(
          "preview_change",
          request.previewBody,
        )) as BillingPreview;

      setConfirmation({
        title: request.title,
        action: request.action,
        body: request.body,
        preview,
        warning: request.warning,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error as Error & { requiresAddonCheckout?: boolean })
          .requiresAddonCheckout
      ) {
        setHasAddonSubscription(false);
      }

      setMessage(
        error instanceof Error
          ? error.message
          : "The billing change could not be previewed.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function confirmChange() {
    if (!confirmation) {
      return;
    }

    setBusyAction(confirmation.action);
    setMessage("");

    try {
      const response = await invokeBilling(
        confirmation.action,
        confirmation.body,
      );

      if (
        response?.paymentRequired === true &&
        response?.paymentUrl
      ) {
        window.location.assign(
          String(response.paymentUrl),
        );
        return;
      }

      const nextMessage = String(
        response?.message ??
          "Billing was updated successfully.",
      );

      setConfirmation(null);
      await loadBillingState();
      setMessage(nextMessage);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Organization billing could not be updated.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function runSimpleAction(
    action: string,
    body: Record<string, unknown>,
  ) {
    setBusyAction(action);
    setMessage("");

    try {
      const response =
        await invokeBilling(action, body);

      await loadBillingState();

      setMessage(
        String(
          response?.message ??
            "Billing was updated successfully.",
        ),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Organization billing could not be updated.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function openStripePortal() {
    setBusyAction("open_portal");
    setMessage("");

    try {
      const response =
        await invokeBilling("open_portal");

      if (!response?.billingPortalUrl) {
        throw new Error(
          "Stripe did not provide a billing portal URL.",
        );
      }

      window.location.assign(
        String(response.billingPortalUrl),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Stripe billing could not be opened.",
      );
      setBusyAction("");
    }
  }

  if (isLoading) {
    return (
      <section className="billing-compact">
        <p className="form-message">
          Loading organization billing controls...
        </p>
      </section>
    );
  }

  if (!billingState) {
    return (
      <section className="billing-compact">
        <p
          className="form-message"
          role="alert"
        >
          {message ||
            "Organization billing could not be loaded."}
        </p>
      </section>
    );
  }

  const seatReduction =
    seatQuantity <
    billingState.purchasedSeatCount;

  const seatLossCount =
    Math.max(
      0,
      billingState.usedSeatCount -
        seatQuantity,
    );

  const portalCreditSummary =
    creditBreakdown.find(
      (row) =>
        row.credit_pool_type === "portal",
    ) ?? null;

  const appCreditSummary =
    creditBreakdown.find(
      (row) =>
        row.credit_pool_type === "app",
    ) ?? null;

  const planOptions = withCurrentValueOption(
    PLAN_OPTIONS,
    billingState.currentPlanKey,
    formatLabel,
  );

  const billingIntervalOptions = withCurrentValueOption(
    BILLING_INTERVAL_OPTIONS,
    billingState.billingInterval,
    formatLabel,
  );

  // Every "Review ... change" button stays disabled until the selection
  // genuinely differs from the organization's loaded current state — never
  // from busyAction alone. This is what stops an untouched control from
  // submitting a no-op "change".
  const hasPlanChange =
    selectedPlan !== (billingState.currentPlanKey ?? "") ||
    selectedInterval !== (billingState.billingInterval ?? "");

  const hasSeatChange =
    seatQuantity !== billingState.purchasedSeatCount;

  const hasPortalAddonChange =
    portalCredits !== billingState.currentPortalAddonCredits;

  const hasAppAddonChange =
    appCredits !== billingState.currentAppAddonCredits;

  const statusBadge = getStatusBadge(
    billingState.subscriptionStatus,
    billingState.cancelAtPeriodEnd,
  );

  const portalUsagePercentage = getUsagePercentage(
    portalCreditSummary?.used_credits ?? 0,
    portalCreditSummary?.total_monthly_credits ?? 0,
  );

  const appUsagePercentage = getUsagePercentage(
    appCreditSummary?.used_credits ?? 0,
    appCreditSummary?.total_monthly_credits ?? 0,
  );

  return (
    <section className="billing-compact">
      <div className="billing-summary-strip">
        <div>
          <span>Plan</span>
          <strong>
            {formatLabel(
              billingState.currentPlanKey,
            )}
          </strong>
        </div>

        <div>
          <span>Billing interval</span>
          <strong>
            {formatLabel(
              billingState.billingInterval,
            )}
          </strong>
        </div>

        <div>
          <span>Renews</span>
          <strong>
            {formatDate(
              billingState.renewalDate,
            )}
          </strong>
        </div>

        <div>
          <span>Status</span>
          <span
            className={`billing-status-badge ${statusBadge.className}`}
          >
            {statusBadge.label}
          </span>
        </div>

        <div>
          <span>Purchased seats</span>
          <strong>
            {formatNumber(
              billingState.purchasedSeatCount,
            )}
          </strong>
        </div>

        <div>
          <span>Available seats</span>
          <strong>
            {formatNumber(
              Math.max(
                0,
                billingState.purchasedSeatCount -
                  billingState.usedSeatCount,
              ),
            )}
          </strong>
        </div>
      </div>

      <div className="billing-control-grid">
        <article className="billing-control-card">
          <div className="billing-control-heading">
            <div>
              <span>Plan</span>
              <h3>Subscription plan</h3>
            </div>
          </div>

          <div className="billing-inline-fields">
            <label>
              Plan
              <select
                value={selectedPlan}
                onChange={(event) =>
                  setSelectedPlan(
                    event.target.value,
                  )
                }
              >
                {planOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Billing
              <select
                value={selectedInterval}
                onChange={(event) =>
                  setSelectedInterval(
                    event.target.value,
                  )
                }
              >
                {billingIntervalOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="billing-helper-text">
            Upgrades apply immediately after payment. Downgrades
            and interval changes apply at renewal on{" "}
            {formatDate(billingState.renewalDate)}.
          </p>

          <button
            className="primary-button"
            type="button"
            disabled={Boolean(busyAction) || !hasPlanChange}
            onClick={() =>
              void previewChange({
                title:
                  "Confirm subscription change",
                action: "schedule_plan",
                body: {
                  planKey: selectedPlan,
                  billingInterval:
                    selectedInterval,
                },
                previewBody: {
                  changeType: "plan",
                  planKey: selectedPlan,
                  billingInterval:
                    selectedInterval,
                },
              })
            }
          >
            Review plan change
          </button>
        </article>

        <article className="billing-control-card">
          <div className="billing-control-heading">
            <div>
              <span>Seats</span>
              <h3>Purchased app seats</h3>
            </div>
          </div>

          <label>
            Seat quantity
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              value={seatQuantity}
              onChange={(event) =>
                setSeatQuantity(
                  Math.max(
                    1,
                    Number(
                      event.target.value || 1,
                    ),
                  ),
                )
              }
            />
          </label>

          <p className="billing-helper-text">
            Increasing seats charges a prorated amount today.
            Decreasing seats takes effect at renewal with no
            refund for the prepaid period.
          </p>

          {seatLossCount > 0 ? (
            <p className="billing-inline-warning">
              {seatLossCount} active account
              {seatLossCount === 1 ? "" : "s"}{" "}
              will lose app access at renewal.
            </p>
          ) : null}

          <button
            className="primary-button"
            type="button"
            disabled={Boolean(busyAction) || !hasSeatChange}
            onClick={() =>
              void previewChange({
                title:
                  seatReduction
                    ? "Confirm seat reduction"
                    : "Confirm seat increase",
                action: "update_seats",
                body: {
                  seatQuantity,
                },
                previewBody: {
                  changeType: "seats",
                  seatQuantity,
                },
                warning:
                  seatLossCount > 0
                    ? `${seatLossCount} active app account${
                        seatLossCount === 1
                          ? ""
                          : "s"
                      } will lose access at renewal.`
                    : undefined,
              })
            }
          >
            Review seat change
          </button>
        </article>
      </div>

      {!hasAddonSubscription ? (
        <div className="billing-addon-notice">
          <h3>No recurring AI add-on subscription</h3>
          <p>
            Purchase a recurring add-on subscription to enable
            portal and shared app credit packages below.
          </p>
          <a
            className="primary-button"
            href="?mode=ai-access"
          >
            Purchase from AI access
          </a>
        </div>
      ) : null}

      <div className="billing-control-grid">
        <article className="billing-control-card billing-credit-card">
          <div className="billing-control-heading">
            <div>
              <span>Portal AI</span>
              <h3>Web portal credits</h3>
            </div>
          </div>

          <div className="billing-credit-total">
            <span>Total monthly portal credits</span>
            <strong>
              {formatNumber(
                portalCreditSummary
                  ?.total_monthly_credits ?? 0,
              )}
            </strong>
          </div>

          <div
            className="billing-utilization-track"
            role="progressbar"
            aria-label="Web portal AI credits used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={portalUsagePercentage}
          >
            <div
              className="billing-utilization-fill"
              style={{
                width: `${portalUsagePercentage}%`,
              }}
            />
          </div>

          <div className="billing-credit-metrics">
            <div>
              <span>Included with plan</span>
              <strong>
                {formatNumber(
                  portalCreditSummary
                    ?.included_monthly_credits ?? 0,
                )}
              </strong>
            </div>

            <div>
              <span>Recurring add-on</span>
              <strong>
                {formatNumber(
                  portalCreditSummary
                    ?.recurring_addon_credits ?? 0,
                )}
              </strong>
            </div>

            <div>
              <span>Used</span>
              <strong>
                {formatNumber(
                  portalCreditSummary
                    ?.used_credits ?? 0,
                )}
              </strong>
            </div>

            <div>
              <span>Remaining</span>
              <strong>
                {formatNumber(
                  portalCreditSummary
                    ?.remaining_credits ?? 0,
                )}
              </strong>
            </div>
          </div>

          <label>
            Recurring portal add-on package
            <select
              value={portalCredits}
              onChange={(event) =>
                setPortalCredits(
                  Number(event.target.value),
                )
              }
            >
              <option value={0}>
                No recurring add-on
              </option>

              {billingState.portalAddonOptions.map(
                (credits) => (
                  <option
                    key={credits}
                    value={credits}
                  >
                    {formatNumber(credits)} credits
                  </option>
                ),
              )}
            </select>
          </label>

          <p className="billing-helper-text">
            Billed on the organization&rsquo;s dedicated add-on
            subscription, separate from the plan above.
          </p>

          <button
            className="primary-button"
            type="button"
            disabled={
              Boolean(busyAction) || !hasPortalAddonChange
            }
            onClick={() =>
              void previewChange({
                title:
                  "Confirm portal AI package",
                action: "update_addon",
                body: {
                  addonPool: "portal",
                  addonCredits: portalCredits,
                },
                previewBody: {
                  changeType: "addon",
                  addonPool: "portal",
                  addonCredits: portalCredits,
                },
              })
            }
          >
            Review portal package
          </button>
        </article>

        <article className="billing-control-card billing-credit-card">
          <div className="billing-control-heading">
            <div>
              <span>App AI</span>
              <h3>Shared app credits</h3>
            </div>
          </div>

          <div className="billing-credit-total">
            <span>Total monthly shared app credits</span>
            <strong>
              {formatNumber(
                appCreditSummary
                  ?.total_monthly_credits ?? 0,
              )}
            </strong>
          </div>

          <div
            className="billing-utilization-track"
            role="progressbar"
            aria-label="Shared app AI credits used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={appUsagePercentage}
          >
            <div
              className="billing-utilization-fill"
              style={{
                width: `${appUsagePercentage}%`,
              }}
            />
          </div>

          <div className="billing-credit-metrics">
            <div>
              <span>Pooled from seats</span>
              <strong>
                {formatNumber(
                  appCreditSummary
                    ?.included_monthly_credits ?? 0,
                )}
              </strong>
            </div>

            <div>
              <span>Recurring add-on</span>
              <strong>
                {formatNumber(
                  appCreditSummary
                    ?.recurring_addon_credits ?? 0,
                )}
              </strong>
            </div>

            <div>
              <span>Used</span>
              <strong>
                {formatNumber(
                  appCreditSummary
                    ?.used_credits ?? 0,
                )}
              </strong>
            </div>

            <div>
              <span>Remaining</span>
              <strong>
                {formatNumber(
                  appCreditSummary
                    ?.remaining_credits ?? 0,
                )}
              </strong>
            </div>
          </div>

          <label>
            Recurring shared app add-on package
            <select
              value={appCredits}
              onChange={(event) =>
                setAppCredits(
                  Number(event.target.value),
                )
              }
            >
              <option value={0}>
                No recurring add-on
              </option>

              {billingState.appAddonOptions.map(
                (credits) => (
                  <option
                    key={credits}
                    value={credits}
                  >
                    {formatNumber(credits)} credits
                  </option>
                ),
              )}
            </select>
          </label>

          <p className="billing-helper-text">
            Added once to the organization&rsquo;s shared pool,
            not once per seat. Billed on the dedicated add-on
            subscription.
          </p>

          <button
            className="primary-button"
            type="button"
            disabled={
              Boolean(busyAction) || !hasAppAddonChange
            }
            onClick={() =>
              void previewChange({
                title:
                  "Confirm shared app AI package",
                action: "update_addon",
                body: {
                  addonPool: "app",
                  addonCredits: appCredits,
                },
                previewBody: {
                  changeType: "addon",
                  addonPool: "app",
                  addonCredits: appCredits,
                },
              })
            }
          >
            Review app package
          </button>
        </article>
      </div>

      {confirmation ? (
        <section
          className="billing-confirmation-panel"
          aria-live="polite"
        >
          <div className="billing-confirmation-heading">
            <div>
              <span>Review and confirm</span>
              <h3>{confirmation.title}</h3>
            </div>

            <button
              className="billing-close-button"
              type="button"
              onClick={() =>
                setConfirmation(null)
              }
              aria-label="Close confirmation"
            >
              ×
            </button>
          </div>

          <div className="billing-confirmation-grid">
            <div>
              <span>Requested change</span>
              <strong>
                {confirmation.preview.description}
              </strong>
            </div>

            <div>
              <span>Effective date</span>
              <strong>
                {formatDate(
                  confirmation.preview.effectiveAt,
                )}
              </strong>
            </div>

            <div>
              <span>Due today</span>
              <strong>
                {formatCurrency(
                  confirmation.preview.amountDueToday,
                  confirmation.preview.currency,
                )}
              </strong>
            </div>

            <div>
              <span>
                Change timing
              </span>
              <strong>
                {confirmation.preview.changeTiming ===
                "immediate"
                  ? "Immediately after payment"
                  : "At subscription renewal"}
              </strong>
            </div>
          </div>

          {confirmation.warning ? (
            <p className="billing-confirmation-warning">
              {confirmation.warning}
            </p>
          ) : null}

          <p className="billing-confirmation-consent">
            {confirmation.preview.estimateNote}
          </p>

          <p className="billing-confirmation-consent">
            By confirming, you authorize this change to the
            organization’s existing Stripe subscription.
            Immediate increases are applied after Stripe confirms
            payment. Reductions and billing-interval changes take
            effect at renewal.
          </p>

          <div className="button-row">
            <button
              className="secondary-button"
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() =>
                setConfirmation(null)
              }
            >
              Go back
            </button>

            <button
              className="primary-button"
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() =>
                void confirmChange()
              }
            >
              {busyAction
                ? "Applying change..."
                : "Confirm billing change"}
            </button>
          </div>
        </section>
      ) : null}

      {billingState.pendingChanges.length > 0 ? (
        <details className="billing-pending-details">
          <summary>
            Scheduled changes
            <span className="billing-count-badge">
              {billingState.pendingChanges.length}
            </span>
          </summary>

          <div className="billing-pending-list">
            {billingState.pendingChanges.map(
              (change) => (
                <div
                  className="billing-pending-row"
                  key={change.id}
                >
                  <div>
                    <strong>
                      {formatLabel(
                        change.change_type,
                      )}
                    </strong>

                    <p>
                      {describePendingChange(change)}
                    </p>
                  </div>

                  <div className="billing-pending-timing">
                    <span>
                      Effective{" "}
                      {formatDate(
                        change.effective_at,
                      )}
                    </span>

                    <small>
                      No charge today ·{" "}
                      {formatLabel(
                        change.change_status,
                      )}
                    </small>
                  </div>
                </div>
              ),
            )}
          </div>
        </details>
      ) : null}

      <div className="billing-footer-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={Boolean(busyAction)}
          onClick={() =>
            void openStripePortal()
          }
        >
          Invoices and payment method
        </button>
      </div>

      <div className="billing-danger-zone">
        <div>
          <h3>
            {billingState.cancelAtPeriodEnd
              ? "Subscription cancellation scheduled"
              : "Cancel subscription"}
          </h3>
          <p>
            {billingState.cancelAtPeriodEnd
              ? `Access continues through ${formatDate(billingState.renewalDate)}. No refund or prorated credit will be issued.`
              : "Cancels at the end of the current paid term. Access continues until then. No refund or prorated credit will be issued."}
          </p>
        </div>

        {billingState.cancelAtPeriodEnd ? (
          <button
            className="primary-button"
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() =>
              void runSimpleAction(
                "resume_subscription",
                {},
              )
            }
          >
            Keep subscription active
          </button>
        ) : (
          <button
            className="danger-button"
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => {
              const confirmed =
                window.confirm(
                  "Cancel the organization subscription at renewal? Access continues through the paid term and no refund or prorated credit will be issued.",
                );

              if (confirmed) {
                void runSimpleAction(
                  "cancel_subscription",
                  {},
                );
              }
            }}
          >
            Cancel at renewal
          </button>
        )}
      </div>

      {message ? (
        <p
          className="form-message"
          role="status"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
