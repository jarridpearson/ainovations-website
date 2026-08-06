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

  const [selectedPlan, setSelectedPlan] =
    useState("organization_starter");

  const [selectedInterval, setSelectedInterval] =
    useState("monthly");

  const [seatQuantity, setSeatQuantity] =
    useState(1);

  const [portalCredits, setPortalCredits] =
    useState(0);

  const [appCredits, setAppCredits] =
    useState(0);

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

        if (
          "context" in error &&
          error.context instanceof Response
        ) {
          try {
            const responseBody =
              (await error.context.json()) as {
                error?: string;
              };

            if (responseBody.error) {
              errorMessage = responseBody.error;
            }
          } catch {
            // Keep normal function error.
          }
        }

        throw new Error(errorMessage);
      }

      if (data?.error) {
        throw new Error(String(data.error));
      }

      return data;
    },
    [organizationId],
  );

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

        setSelectedPlan(
          data.pendingPlanKey ??
            data.currentPlanKey ??
            "organization_starter",
        );

        setSelectedInterval(
          data.pendingBillingInterval ??
            data.billingInterval ??
            "monthly",
        );

        setSeatQuantity(
          Math.max(
            1,
            data.pendingPaidSeatCount ??
              data.purchasedSeatCount,
          ),
        );

        setPortalCredits(
          data.currentPortalAddonCredits,
        );

        setAppCredits(
          data.currentAppAddonCredits,
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
    }, [invokeBilling]);

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
          <small>
            {formatLabel(
              billingState.billingInterval,
            )}
          </small>
        </div>

        <div>
          <span>Renews</span>
          <strong>
            {formatDate(
              billingState.renewalDate,
            )}
          </strong>
          <small>
            {billingState.cancelAtPeriodEnd
              ? "Cancellation scheduled"
              : "Subscription active"}
          </small>
        </div>

        <div>
          <span>App seats</span>
          <strong>
            {billingState.usedSeatCount} /{" "}
            {billingState.purchasedSeatCount}
          </strong>
          <small>
            {Math.max(
              0,
              billingState.purchasedSeatCount -
                billingState.usedSeatCount,
            )}{" "}
            available
          </small>
        </div>

        <div>
          <span>Monthly portal AI credits</span>

          <strong>
            {(
              portalCreditSummary
                ?.total_monthly_credits ?? 0
            ).toLocaleString("en-US")}
          </strong>

          <small>
            {(
              portalCreditSummary
                ?.included_monthly_credits ?? 0
            ).toLocaleString("en-US")}{" "}
            included +{" "}
            {(
              portalCreditSummary
                ?.recurring_addon_credits ?? 0
            ).toLocaleString("en-US")}{" "}
            portal add-on
          </small>
        </div>

        <div>
          <span>Monthly shared app AI credits</span>

          <strong>
            {(
              appCreditSummary
                ?.total_monthly_credits ?? 0
            ).toLocaleString("en-US")}
          </strong>

          <small>
            {(
              appCreditSummary
                ?.included_monthly_credits ?? 0
            ).toLocaleString("en-US")}{" "}
            pooled from{" "}
            {billingState.purchasedSeatCount.toLocaleString(
              "en-US",
            )}{" "}
            seats +{" "}
            {(
              appCreditSummary
                ?.recurring_addon_credits ?? 0
            ).toLocaleString("en-US")}{" "}
            shared app add-on
          </small>
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
                <option value="organization_starter">
                  Organization Starter
                </option>
                <option value="organization_pro">
                  Organization Pro
                </option>
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
                <option value="monthly">
                  Monthly
                </option>
                <option value="annual">
                  Annual prepaid
                </option>
              </select>
            </label>
          </div>

          <button
            className="primary-button"
            type="button"
            disabled={Boolean(busyAction)}
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
            disabled={Boolean(busyAction)}
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

        <article className="billing-control-card">
          <div className="billing-control-heading">
            <div>
              <span>Portal AI</span>
              <h3>Web portal credits</h3>
            </div>
          </div>

          <div className="billing-credit-breakdown">
            <strong>
              {(
                portalCreditSummary
                  ?.total_monthly_credits ?? 0
              ).toLocaleString("en-US")}{" "}
              total monthly portal credits
            </strong>

            <span>
              {(
                portalCreditSummary
                  ?.included_monthly_credits ?? 0
              ).toLocaleString("en-US")}{" "}
              included with the portal plan
            </span>

            <span>
              {(
                portalCreditSummary
                  ?.recurring_addon_credits ?? 0
              ).toLocaleString("en-US")}{" "}
              recurring portal add-on
            </span>

            <small>
              {(
                portalCreditSummary
                  ?.used_credits ?? 0
              ).toLocaleString("en-US")}{" "}
              used ·{" "}
              {(
                portalCreditSummary
                  ?.remaining_credits ?? 0
              ).toLocaleString("en-US")}{" "}
              remaining
            </small>
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
                    {credits.toLocaleString(
                      "en-US",
                    )}{" "}
                    credits
                  </option>
                ),
              )}
            </select>
          </label>

          <button
            className="primary-button"
            type="button"
            disabled={Boolean(busyAction)}
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

        <article className="billing-control-card">
          <div className="billing-control-heading">
            <div>
              <span>App AI</span>
              <h3>Shared app credits</h3>
            </div>
          </div>

          <div className="billing-credit-breakdown">
            <strong>
              {(
                appCreditSummary
                  ?.total_monthly_credits ?? 0
              ).toLocaleString("en-US")}{" "}
              total monthly shared app credits
            </strong>

            <span>
              {(
                appCreditSummary
                  ?.included_monthly_credits ?? 0
              ).toLocaleString("en-US")}{" "}
              included in the pooled seat allocation
            </span>

            <span>
              {(
                appCreditSummary
                  ?.recurring_addon_credits ?? 0
              ).toLocaleString("en-US")}{" "}
              recurring shared app add-on
            </span>

            <small>
              The app add-on is added once to the organization
              pool, not once for every seat.
            </small>

            <small>
              {(
                appCreditSummary
                  ?.used_credits ?? 0
              ).toLocaleString("en-US")}{" "}
              used ·{" "}
              {(
                appCreditSummary
                  ?.remaining_credits ?? 0
              ).toLocaleString("en-US")}{" "}
              remaining
            </small>
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
                    {credits.toLocaleString(
                      "en-US",
                    )}{" "}
                    credits
                  </option>
                ),
              )}
            </select>
          </label>

          <button
            className="primary-button"
            type="button"
            disabled={Boolean(busyAction)}
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
            Scheduled changes (
            {billingState.pendingChanges.length})
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
