import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabase";

type BillingProduct = Record<
  string,
  unknown
> & {
  product_key?: string;
};

function getNumber(
  source: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = source[key];

    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return value;
    }

    if (
      typeof value === "string" &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }

  return 0;
}

function getProductPrice(
  product: BillingProduct,
) {
  return getNumber(product, [
    "monthly_price_cents",
    "recurring_monthly_price_cents",
    "recurring_price_cents",
    "price_cents",
    "unit_price_cents",
    "amount_cents",
    "stripe_unit_amount_cents",
    "monthly_amount_cents",
    "unit_amount_cents",
  ]);
}

function getProductCredits(
  product: BillingProduct,
) {
  return getNumber(product, [
    "portal_credits_per_unit",
    "app_credits_per_unit",
    "credit_quantity",
    "credits_per_unit",
    "included_credits",
  ]);
}

function getProductLabel(
  product: BillingProduct,
) {
  const labelFields = [
    "product_name",
    "display_name",
    "name",
    "label",
  ];

  for (const field of labelFields) {
    const value = product[field];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  const credits =
    getProductCredits(product);

  return credits > 0
    ? `${credits.toLocaleString()} AI credits`
    : product.product_key ??
        "AI credit package";
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

async function getFunctionErrorMessage(error: unknown) {
  let fallback =
    "The AI package checkout could not be created.";

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

  try {
    const context = error.context as Response;
    const responseText =
      await context.clone().text();

    const responseJson =
      JSON.parse(
        responseText,
      ) as Record<string, unknown>;

    const message =
      responseJson.error ??
      responseJson.message;

    return typeof message === "string"
      ? message
      : responseText;
  } catch {
    return fallback;
  }
}

export default function OrganizationAiUpsell() {
  const [
    billingProducts,
    setBillingProducts,
  ] = useState<BillingProduct[]>([]);

  const [
    portalProductKey,
    setPortalProductKey,
  ] = useState("");

  const [
    appProductKey,
    setAppProductKey,
  ] = useState("");

  const [organizationId, setOrganizationId] =
    useState("");

  const [isLoading, setIsLoading] =
    useState(true);

  const [
    isSubmitting,
    setIsSubmitting,
  ] = useState(false);

  const [message, setMessage] =
    useState("");

  const statusRef =
    useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadPage() {
      const {
        data: sessionResult,
      } =
        await supabase.auth.getSession();

      const user =
        sessionResult.session?.user;

      if (!user) {
        window.location.assign(
          "/?mode=signup",
        );
        return;
      }

      const {
        data: memberships,
        error: membershipError,
      } = await supabase
        .from("organization_users")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1);

      if (
        membershipError ||
        !memberships?.[0]
          ?.organization_id
      ) {
        if (isMounted) {
          setMessage(
            "Your organization could not be loaded. Refresh after the Stripe payment finishes processing.",
          );
          setIsLoading(false);
        }
        return;
      }

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

      setOrganizationId(
        memberships[0].organization_id,
      );

      setBillingProducts(
        Array.isArray(
          data?.billingProducts,
        )
          ? data.billingProducts
          : [],
      );

      setIsLoading(false);
    }

    void loadPage();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!message && !isSubmitting) {
      return;
    }

    statusRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [message, isSubmitting]);

  const portalProducts = useMemo(
    () =>
      billingProducts
        .filter((product) => {
          const searchable =
            Object.values(product)
              .filter(
                (value) =>
                  typeof value ===
                  "string",
              )
              .join(" ")
              .toLowerCase();

          return (
            searchable.includes(
              "portal",
            ) &&
            searchable.includes(
              "credit",
            )
          );
        })
        .sort(
          (first, second) =>
            getProductPrice(first) -
            getProductPrice(second),
        ),
    [billingProducts],
  );

  const appProducts = useMemo(
    () =>
      billingProducts
        .filter((product) => {
          const searchable =
            Object.values(product)
              .filter(
                (value) =>
                  typeof value ===
                  "string",
              )
              .join(" ")
              .toLowerCase();

          return (
            searchable.includes(
              "credit",
            ) &&
            !searchable.includes(
              "portal",
            ) &&
            (
              searchable.includes(
                "app",
              ) ||
              searchable.includes(
                "mobile",
              ) ||
              searchable.includes(
                "shared",
              ) ||
              searchable.includes(
                "user",
              )
            )
          );
        })
        .sort(
          (first, second) =>
            getProductPrice(first) -
            getProductPrice(second),
        ),
    [billingProducts],
  );

  const selectedPortal =
    portalProducts.find(
      (product) =>
        product.product_key ===
        portalProductKey,
    ) ?? null;

  const selectedApp =
    appProducts.find(
      (product) =>
        product.product_key ===
        appProductKey,
    ) ?? null;

  const monthlyTotal =
    (selectedPortal
      ? getProductPrice(
          selectedPortal,
        )
      : 0) +
    (selectedApp
      ? getProductPrice(
          selectedApp,
        )
      : 0);

  function continueToOnboarding() {
    window.location.assign("/");
  }

  async function openAddonCheckout() {
    if (
      !portalProductKey &&
      !appProductKey
    ) {
      continueToOnboarding();
      return;
    }

    setIsSubmitting(true);
    setMessage(
      "Opening secure Stripe Checkout...",
    );

    const { data, error } =
      await supabase.functions.invoke(
        "create-organization-addon-checkout",
        {
          body: {
            organizationId,
            requestId:
              crypto.randomUUID(),
            portalCreditAddonProductKey:
              portalProductKey,
            appCreditAddonProductKey:
              appProductKey,
          },
        },
      );

    if (error) {
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
        "Stripe did not return an AI package checkout link.",
      );
      setIsSubmitting(false);
      return;
    }

    window.location.assign(
      checkoutUrl,
    );
  }

  if (isLoading) {
    return (
      <main className="organization-signup-page">
        <section className="organization-signup-shell">
          <div className="setup-heading">
            <p className="eyebrow">
              Optional AI access
            </p>

            <h1>
              Loading AI packages...
            </h1>

            {message ? (
              <p className="form-message">
                {message}
              </p>
            ) : null}
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
            Your organization subscription
            is ready
          </p>

          <h1>
            Would you like additional
            monthly AI access?
          </h1>

          <p>
            AI credits power organization
            portal analysis and questions,
            plus AI analysis used by your
            organization’s Everward mobile
            app users.
          </p>
        </div>

        <section className="setup-section">
          <div className="ai-upsell-notice">
            <strong>
              AI packages are optional.
            </strong>

            <p>
              You can increase, reduce, or
              remove either recurring package
              later from organization billing.
              Packages renew monthly and are
              billed separately from an annual
              organization subscription.
            </p>
          </div>
        </section>

        <section className="setup-section">
          <div className="setup-section-heading">
            <span className="setup-step-number">
              1
            </span>

            <div>
              <h2>
                Portal AI credits
              </h2>

              <p>
                Used for AI questions,
                organization analysis, and
                other AI features inside the
                web portal.
              </p>
            </div>
          </div>

          <div className="setup-field">
            <label htmlFor="portal-ai-package">
              Monthly portal AI package
            </label>

            <select
              id="portal-ai-package"
              value={portalProductKey}
              disabled={isSubmitting}
              onChange={(event) => {
                setPortalProductKey(
                  event.target.value,
                );
                setMessage("");
              }}
            >
              <option value="">
                No additional portal AI
                credits
              </option>

              {portalProducts.map(
                (product) => (
                  <option
                    key={
                      product.product_key
                    }
                    value={
                      product.product_key
                    }
                  >
                    {getProductLabel(
                      product,
                    )}{" "}
                    —{" "}
                    {formatMoney(
                      getProductPrice(
                        product,
                      ),
                    )}{" "}
                    per month
                  </option>
                ),
              )}
            </select>
          </div>
        </section>

        <section className="setup-section">
          <div className="setup-section-heading">
            <span className="setup-step-number">
              2
            </span>

            <div>
              <h2>
                Shared mobile-app AI
                credits
              </h2>

              <p>
                Shared by your
                organization’s Everward
                mobile app users.
              </p>
            </div>
          </div>

          <div className="setup-field">
            <label htmlFor="app-ai-package">
              Monthly shared mobile-app
              package
            </label>

            <select
              id="app-ai-package"
              value={appProductKey}
              disabled={isSubmitting}
              onChange={(event) => {
                setAppProductKey(
                  event.target.value,
                );
                setMessage("");
              }}
            >
              <option value="">
                No additional shared
                mobile-app AI credits
              </option>

              {appProducts.map(
                (product) => (
                  <option
                    key={
                      product.product_key
                    }
                    value={
                      product.product_key
                    }
                  >
                    {getProductLabel(
                      product,
                    )}{" "}
                    —{" "}
                    {formatMoney(
                      getProductPrice(
                        product,
                      ),
                    )}{" "}
                    per month
                  </option>
                ),
              )}
            </select>
          </div>
        </section>

        <section className="organization-signup-summary">
          <h2>
            Optional AI summary
          </h2>

          <div>
            <span>
              Portal AI package
            </span>

            <strong>
              {selectedPortal
                ? `${formatMoney(
                    getProductPrice(
                      selectedPortal,
                    ),
                  )} per month`
                : "None"}
            </strong>
          </div>

          <div>
            <span>
              Shared mobile-app AI
              package
            </span>

            <strong>
              {selectedApp
                ? `${formatMoney(
                    getProductPrice(
                      selectedApp,
                    ),
                  )} per month`
                : "None"}
            </strong>
          </div>

          <div className="organization-signup-total">
            <span>
              AI packages per month
            </span>

            <strong>
              {formatMoney(
                monthlyTotal,
              )}
            </strong>
          </div>
        </section>

        <div
          ref={statusRef}
          className="organization-checkout-status"
        >
          <button
            className="primary-button organization-signup-submit"
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              void openAddonCheckout();
            }}
          >
            {isSubmitting
              ? "Preparing secure checkout..."
              : monthlyTotal > 0
                ? "Continue to AI checkout"
                : "Continue to onboarding"}
          </button>

          <button
            className="secondary-button organization-ai-skip"
            type="button"
            disabled={isSubmitting}
            onClick={
              continueToOnboarding
            }
          >
            Skip AI packages and continue
            to onboarding
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
      </section>
    </main>
  );
}
