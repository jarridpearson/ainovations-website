import {
  useEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";

type BillingInterval = "monthly" | "annual";

type PendingOrganizationSignup = {
  organizationName: string;
  contactName: string;
  email: string;
  planKey: string;
  billingInterval: BillingInterval;
  seatQuantity: number;
};

type OrganizationPlan = {
  plan_key: string;
  plan_name: string;
  portal_monthly_price_cents: number;
  portal_annual_price_cents: number;
  per_user_monthly_price_cents: number;
  per_user_annual_price_cents: number;
  included_admin_ai_credits_monthly: number | null;
  included_user_ai_credits_monthly: number | null;
  company_document_limit: number | null;
  allows_company_activity_questions: boolean | null;
  allows_advanced_reporting: boolean | null;
  allows_full_data_export: boolean | null;
};

const pendingSignupStorageKey =
  "everward-pending-organization-signup";

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function getPlanFeatures(plan: OrganizationPlan) {
  const features: string[] = [];

  if (
    typeof plan.company_document_limit === "number" &&
    plan.company_document_limit > 0
  ) {
    features.push(
      `Company Knowledge supports up to ${plan.company_document_limit.toLocaleString()} documents`,
    );
  }

  if (plan.allows_company_activity_questions) {
    features.push("Company activity questions");
  }

  if (plan.allows_advanced_reporting) {
    features.push("Advanced reporting");
  }

  if (plan.allows_full_data_export) {
    features.push("Full data export");
  }

  return features;
}

async function getFunctionErrorMessage(error: unknown) {
  let fallback =
    "Organization signup could not be completed.";

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    fallback = error.message;
  }

  if (
    !error ||
    typeof error !== "object" ||
    !("context" in error)
  ) {
    return fallback;
  }

  const context = error.context as {
    clone?: () => Response;
    text?: () => Promise<string>;
  };

  try {
    const response =
      typeof context.clone === "function"
        ? context.clone()
        : context;

    if (typeof response.text !== "function") {
      return fallback;
    }

    const responseText = await response.text();

    if (!responseText.trim()) {
      return fallback;
    }

    try {
      const responseJson = JSON.parse(
        responseText,
      ) as Record<string, unknown>;

      const possibleMessage =
        responseJson.error ??
        responseJson.message ??
        responseJson.details;

      return typeof possibleMessage === "string"
        ? possibleMessage
        : responseText;
    } catch {
      return responseText;
    }
  } catch {
    return fallback;
  }
}

export default function OrganizationSignup() {
  const [plans, setPlans] = useState<
    OrganizationPlan[]
  >([]);

  const [contactName, setContactName] =
    useState("");

  const [
    organizationName,
    setOrganizationName,
  ] = useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [planKey, setPlanKey] =
    useState("");

  const [
    billingInterval,
    setBillingInterval,
  ] =
    useState<BillingInterval>("monthly");

  const [
    mobileAppUserQuantity,
    setMobileAppUserQuantity,
  ] = useState(1);

  const [isLoading, setIsLoading] =
    useState(true);

  const [
    isSubmitting,
    setIsSubmitting,
  ] = useState(false);

  const [message, setMessage] =
    useState("");

  const checkoutStatusRef =
    useRef<HTMLDivElement | null>(null);

  const resumeAttemptedRef =
    useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function loadPlans() {
      const { data, error } =
        await supabase.functions.invoke(
          "get-organization-signup-options",
          {
            body: {},
          },
        );

      if (!isMounted) {
        return;
      }

      if (error) {
        setMessage(
          await getFunctionErrorMessage(error),
        );
        setIsLoading(false);
        return;
      }

      const loadedPlans =
        Array.isArray(data?.plans)
          ? (data.plans as OrganizationPlan[])
          : [];

      setPlans(loadedPlans);

      setPlanKey(
        loadedPlans.some(
          (plan) =>
            plan.plan_key ===
            "organization_starter",
        )
          ? "organization_starter"
          : loadedPlans[0]?.plan_key ?? "",
      );

      setIsLoading(false);
    }

    void loadPlans();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const saved =
      sessionStorage.getItem(
        pendingSignupStorageKey,
      );

    if (!saved) {
      return;
    }

    try {
      const pending =
        JSON.parse(
          saved,
        ) as PendingOrganizationSignup;

      setContactName(
        pending.contactName,
      );

      setOrganizationName(
        pending.organizationName,
      );

      setEmail(
        pending.email,
      );

      setPlanKey(
        pending.planKey,
      );

      setBillingInterval(
        pending.billingInterval,
      );

      setMobileAppUserQuantity(
        pending.seatQuantity,
      );
    } catch {
      sessionStorage.removeItem(
        pendingSignupStorageKey,
      );
    }
  }, []);

  useEffect(() => {
    if (!message && !isSubmitting) {
      return;
    }

    const scroll = () => {
      checkoutStatusRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    };

    const frame =
      window.requestAnimationFrame(scroll);

    const timeout =
      window.setTimeout(scroll, 150);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [message, isSubmitting]);

  useEffect(() => {
    if (
      isLoading ||
      resumeAttemptedRef.current
    ) {
      return;
    }

    const params =
      new URLSearchParams(
        window.location.search,
      );

    if (
      params.get("resume") !==
      "checkout"
    ) {
      return;
    }

    const saved =
      sessionStorage.getItem(
        pendingSignupStorageKey,
      );

    if (!saved) {
      setMessage(
        "Your saved signup information could not be found.",
      );
      return;
    }

    let pending:
      | PendingOrganizationSignup
      | null = null;

    try {
      pending =
        JSON.parse(
          saved,
        ) as PendingOrganizationSignup;
    } catch {
      setMessage(
        "Your saved signup information could not be read.",
      );
      return;
    }

    resumeAttemptedRef.current = true;

    async function openCheckout() {
      setIsSubmitting(true);
      setMessage(
        "Opening secure Stripe Checkout...",
      );

      const { data, error } =
        await supabase.functions.invoke(
          "create-organization-signup",
          {
            body: {
              organizationName:
                pending!.organizationName,
              contactName:
                pending!.contactName,
              planKey:
                pending!.planKey,
              billingInterval:
                pending!.billingInterval,
              seatQuantity:
                pending!.seatQuantity,
            },
          },
        );

      if (error) {
        const currentUrl =
          new URL(window.location.href);

        currentUrl.searchParams.delete(
          "resume",
        );

        window.history.replaceState(
          {},
          "",
          `${currentUrl.pathname}${currentUrl.search}#checkout-status`,
        );

        setMessage(
          `Checkout could not open: ${await getFunctionErrorMessage(
            error,
          )}`,
        );

        setIsSubmitting(false);
        return;
      }

      const checkoutUrl =
        typeof data?.checkoutUrl ===
        "string"
          ? data.checkoutUrl
          : "";

      if (!checkoutUrl) {
        setMessage(
          "Checkout could not open because Stripe did not return a checkout link.",
        );

        setIsSubmitting(false);
        return;
      }

      sessionStorage.removeItem(
        pendingSignupStorageKey,
      );

      window.location.assign(
        checkoutUrl,
      );
    }

    void openCheckout();
  }, [isLoading]);

  const selectedPlan =
    plans.find(
      (plan) =>
        plan.plan_key === planKey,
    ) ?? null;

  const portalBasePrice =
    selectedPlan
      ? billingInterval === "annual"
        ? selectedPlan
            .portal_annual_price_cents
        : selectedPlan
            .portal_monthly_price_cents
      : 0;

  const mobileUserUnitPrice =
    selectedPlan
      ? billingInterval === "annual"
        ? selectedPlan
            .per_user_annual_price_cents
        : selectedPlan
            .per_user_monthly_price_cents
      : 0;

  const mobileUsersPrice =
    mobileUserUnitPrice *
    mobileAppUserQuantity;

  const recurringTotal =
    portalBasePrice +
    mobileUsersPrice;

  async function handleSignup(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const normalizedContactName =
      contactName.trim();

    const normalizedOrganizationName =
      organizationName.trim();

    const normalizedEmail =
      email.trim();

    if (!normalizedContactName) {
      setMessage("Enter your name.");
      return;
    }

    if (!normalizedOrganizationName) {
      setMessage(
        "Enter the organization name.",
      );
      return;
    }

    if (!normalizedEmail) {
      setMessage(
        "Enter your email address.",
      );
      return;
    }

    if (password.length < 8) {
      setMessage(
        "Create a password with at least 8 characters.",
      );
      return;
    }

    if (!selectedPlan) {
      setMessage(
        "Select Starter or Pro.",
      );
      return;
    }

    const pending:
      PendingOrganizationSignup = {
        contactName:
          normalizedContactName,
        organizationName:
          normalizedOrganizationName,
        email:
          normalizedEmail,
        planKey,
        billingInterval,
        seatQuantity:
          mobileAppUserQuantity,
      };

    sessionStorage.setItem(
      pendingSignupStorageKey,
      JSON.stringify(pending),
    );

    setIsSubmitting(true);
    setMessage(
      "Creating your organization account...",
    );

    const {
      data: currentSession,
    } =
      await supabase.auth.getSession();

    if (
      currentSession.session?.user
        .email === normalizedEmail
    ) {
      window.location.replace(
        "/?mode=signup&resume=checkout#checkout-status",
      );
      return;
    }

    const {
      data: signupResult,
      error: signupError,
    } = await supabase.auth.signUp({
      email:
        normalizedEmail,
      password,
      options: {
        data: {
          full_name:
            normalizedContactName,
        },
      },
    });

    if (signupError) {
      if (
        signupError.message
          .toLowerCase()
          .includes(
            "already registered",
          )
      ) {
        const signInResult =
          await supabase.auth
            .signInWithPassword({
              email:
                normalizedEmail,
              password,
            });

        if (signInResult.error) {
          setMessage(
            "This email already has an account. Use the correct password or return to sign in.",
          );
          setIsSubmitting(false);
          return;
        }

        window.location.replace(
          "/?mode=signup&resume=checkout#checkout-status",
        );
        return;
      }

      setMessage(
        signupError.message,
      );
      setIsSubmitting(false);
      return;
    }

    if (!signupResult.session) {
      setMessage(
        "Check your email to confirm the account. Your selections have been saved.",
      );
      setIsSubmitting(false);
      return;
    }

    window.location.replace(
      "/?mode=signup&resume=checkout#checkout-status",
    );
  }

  if (isLoading) {
    return (
      <main className="organization-signup-page">
        <section className="organization-signup-shell">
          <div className="setup-heading">
            <p className="eyebrow">
              Everward for Organizations
            </p>

            <h1>
              Loading Starter and Pro
              pricing...
            </h1>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="organization-signup-page">
      <section className="organization-signup-shell">
        <div className="setup-heading">
          <p className="eyebrow">
            Everward for Organizations
          </p>

          <h1>
            Create your organization
            account.
          </h1>

          <p>
            First select the organization
            plan and number of mobile app
            users. Optional monthly AI access
            is offered after the initial
            subscription checkout.
          </p>
        </div>

        <form
          className="organization-signup-form"
          onSubmit={handleSignup}
          noValidate
        >
          <section className="setup-section">
            <div className="setup-section-heading">
              <span className="setup-step-number">
                1
              </span>

              <div>
                <h2>
                  Account and organization
                </h2>

                <p>
                  This account becomes the
                  first organization
                  administrator.
                </p>
              </div>
            </div>

            <div className="organization-signup-grid">
              <div className="setup-field">
                <label htmlFor="signup-contact-name">
                  Your name
                </label>

                <input
                  id="signup-contact-name"
                  type="text"
                  autoComplete="name"
                  value={contactName}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setContactName(
                      event.target.value,
                    );
                    setMessage("");
                  }}
                />
              </div>

              <div className="setup-field">
                <label htmlFor="signup-organization-name">
                  Organization name
                </label>

                <input
                  id="signup-organization-name"
                  type="text"
                  value={organizationName}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setOrganizationName(
                      event.target.value,
                    );
                    setMessage("");
                  }}
                />
              </div>

              <div className="setup-field">
                <label htmlFor="signup-email">
                  Email address
                </label>

                <input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setEmail(
                      event.target.value,
                    );
                    setMessage("");
                  }}
                />
              </div>

              <div className="setup-field">
                <label htmlFor="signup-password">
                  Password
                </label>

                <input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setPassword(
                      event.target.value,
                    );
                    setMessage("");
                  }}
                />

                <p className="setup-help">
                  Use at least 8 characters.
                </p>
              </div>
            </div>
          </section>

          <section className="setup-section">
            <div className="setup-section-heading">
              <span className="setup-step-number">
                2
              </span>

              <div>
                <h2>
                  Organization plan
                </h2>

                <p>
                  The portal subscription and
                  mobile app users share the
                  same monthly or annual
                  billing schedule.
                </p>
              </div>
            </div>

            <div className="billing-toggle">
              <button
                className={
                  billingInterval ===
                  "monthly"
                    ? "billing-option billing-option-active"
                    : "billing-option"
                }
                type="button"
                disabled={isSubmitting}
                onClick={() =>
                  setBillingInterval(
                    "monthly",
                  )
                }
              >
                Monthly billing
              </button>

              <button
                className={
                  billingInterval ===
                  "annual"
                    ? "billing-option billing-option-active"
                    : "billing-option"
                }
                type="button"
                disabled={isSubmitting}
                onClick={() =>
                  setBillingInterval(
                    "annual",
                  )
                }
              >
                Annual billing
              </button>
            </div>

            <div className="organization-plan-choice-grid">
              {plans.map((plan) => {
                const selected =
                  plan.plan_key ===
                  planKey;

                const portalPrice =
                  billingInterval ===
                  "annual"
                    ? plan
                        .portal_annual_price_cents
                    : plan
                        .portal_monthly_price_cents;

                const userPrice =
                  billingInterval ===
                  "annual"
                    ? plan
                        .per_user_annual_price_cents
                    : plan
                        .per_user_monthly_price_cents;

                return (
                  <button
                    key={plan.plan_key}
                    className={
                      selected
                        ? "organization-plan-choice organization-plan-choice-selected"
                        : "organization-plan-choice"
                    }
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      setPlanKey(
                        plan.plan_key,
                      )
                    }
                  >
                    <span className="organization-plan-choice-indicator">
                      {selected
                        ? "Selected"
                        : "Select plan"}
                    </span>

                    <h3>
                      {plan.plan_name}
                    </h3>

                    <div className="organization-plan-price">
                      <strong>
                        {formatMoney(
                          portalPrice,
                        )}
                      </strong>

                      <span>
                        portal base{" "}
                        {billingInterval ===
                        "annual"
                          ? "per year"
                          : "per month"}
                      </span>
                    </div>

                    <div className="organization-plan-user-price">
                      <strong>
                        {formatMoney(
                          userPrice,
                        )}
                      </strong>

                      <span>
                        per mobile app user{" "}
                        {billingInterval ===
                        "annual"
                          ? "per year"
                          : "per month"}
                      </span>
                    </div>

                    <ul>
                      {getPlanFeatures(
                        plan,
                      ).map(
                        (feature) => (
                          <li key={feature}>
                            {feature}
                          </li>
                        ),
                      )}
                    </ul>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="setup-section">
            <div className="setup-section-heading">
              <span className="setup-step-number">
                3
              </span>

              <div>
                <h2>
                  Mobile app users
                </h2>

                <p>
                  These are paid end-user
                  seats for people using the
                  Everward mobile app.
                </p>
              </div>
            </div>

            <div className="organization-user-explanation">
              <strong>
                Portal roles are separate.
              </strong>

              <p>
                Organization administrators,
                billing administrators, user
                administrators, and group
                managers are configured later
                during onboarding.
              </p>
            </div>

            <div className="setup-field">
              <label htmlFor="signup-mobile-user-quantity">
                Number of mobile app users
              </label>

              <input
                id="signup-mobile-user-quantity"
                type="number"
                min={1}
                max={10000}
                step={1}
                value={
                  mobileAppUserQuantity
                }
                disabled={isSubmitting}
                onChange={(event) =>
                  setMobileAppUserQuantity(
                    Math.max(
                      1,
                      Number(
                        event.target.value,
                      ) || 1,
                    ),
                  )
                }
              />
            </div>
          </section>

          <section className="organization-signup-summary">
            <h2>
              Subscription summary
            </h2>

            <div>
              <span>
                {selectedPlan?.plan_name ??
                  "Organization portal"}{" "}
                base
              </span>

              <strong>
                {formatMoney(
                  portalBasePrice,
                )}
              </strong>
            </div>

            <div>
              <span>
                {mobileAppUserQuantity.toLocaleString()}{" "}
                mobile app{" "}
                {mobileAppUserQuantity ===
                1
                  ? "user"
                  : "users"}
              </span>

              <strong>
                {formatMoney(
                  mobileUsersPrice,
                )}
              </strong>
            </div>

            <div className="organization-signup-total">
              <span>
                Total{" "}
                {billingInterval ===
                "annual"
                  ? "per year"
                  : "per month"}
              </span>

              <strong>
                {formatMoney(
                  recurringTotal,
                )}
              </strong>
            </div>

            <p className="setup-help">
              Optional monthly portal and
              shared mobile-app AI packages
              are offered after this checkout.
            </p>
          </section>

          <div
            id="checkout-status"
            ref={checkoutStatusRef}
            className="organization-checkout-status"
          >
            <button
              className="primary-button organization-signup-submit"
              type="submit"
              disabled={
                isSubmitting ||
                !selectedPlan
              }
            >
              {isSubmitting
                ? "Preparing secure checkout..."
                : "Continue to secure checkout"}
            </button>

            {message ? (
              <p
                className="form-message"
                role="status"
              >
                {message}
              </p>
            ) : null}
          </div>

          <a
            className="text-button organization-signup-return"
            href="/"
          >
            Return to organization sign in
          </a>
        </form>
      </section>
    </main>
  );
}
