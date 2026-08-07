// Deno test for the seat/add-on proration-extraction logic used by
// manage-organization-billing (getPositiveProrationAmount), imported
// directly from the deployed function so this test exercises the real
// production implementation rather than a copy that could drift from it.
//
// The actual time-based proration math (how much of the current period is
// left, what fraction of a monthly vs. annual price that represents) is
// computed entirely by Stripe itself via
// `stripe.invoices.createPreview({ subscription_details: { proration_behavior:
// "create_prorations" } })` — this repo never re-derives day counts or
// interval length. getPositiveProrationAmount's only job is to correctly
// extract and sum the proration line(s) for the *target* item out of
// whatever Stripe returns, which is exactly what these tests verify: the
// extraction is correct and interval-agnostic, for both a small monthly
// proration and a much larger annual one, and it does not accidentally sum
// in unrelated or non-proration lines.
//
// Run with: deno test supabase/tests/manage-organization-billing.seatProration.test.ts
//
// Lives under supabase/tests/, not inside the manage-organization-billing
// function directory, so it never gets bundled or deployed with the Edge
// Function itself.

import type Stripe from "npm:stripe@^22";
import { getPositiveProrationAmount } from "../functions/manage-organization-billing/index.ts";

// Minimal fixtures covering only the fields getPositiveProrationAmount
// actually reads (line.amount, line.parent.subscription_item_details,
// line.pricing.price_details.price). Cast to Stripe.Invoice/InvoiceLineItem
// at each call site rather than constructing a fully valid Stripe.Invoice,
// matching the existing "as unknown as X" fixture pattern already used
// elsewhere in this codebase's tests.
type FakeLine = {
  amount: number;
  parent?: {
    subscription_item_details?: {
      proration?: boolean;
      subscription_item?: string | null;
    };
  } | null;
  pricing?: {
    price_details?: {
      price?: string | null;
    };
  };
};

function fakeInvoice(lines: FakeLine[]): Stripe.Invoice {
  return { lines: { data: lines } } as unknown as Stripe.Invoice;
}

function prorationLine(
  subscriptionItemId: string,
  amount: number,
): FakeLine {
  return {
    amount,
    parent: {
      subscription_item_details: {
        proration: true,
        subscription_item: subscriptionItemId,
      },
    },
  };
}

function newItemProrationLine(
  priceId: string,
  amount: number,
): FakeLine {
  return {
    amount,
    parent: {
      subscription_item_details: {
        proration: true,
        subscription_item: null,
      },
    },
    pricing: { price_details: { price: priceId } },
  };
}

function regularRenewalLine(
  subscriptionItemId: string,
  amount: number,
): FakeLine {
  return {
    amount,
    parent: {
      subscription_item_details: {
        proration: false,
        subscription_item: subscriptionItemId,
      },
    },
  };
}

Deno.test("monthly-interval seat increase: sums only the target item's proration lines", () => {
  // A monthly org adding 1 seat mid-period: Stripe returns a small credit
  // for the unused portion of the old quantity and a small charge for the
  // new quantity, both tagged to the seat subscription item.
  const invoice = fakeInvoice([
    prorationLine("si_seat", -1200), // unused credit, ~12 days left in a 30-day month
    prorationLine("si_seat", 1499), // new seat charge for the remaining days
  ]);

  const result = getPositiveProrationAmount(invoice, "si_seat", "price_seat_monthly");

  if (result !== 299) {
    throw new Error(`Expected 299 (2.99), got ${result}`);
  }
});

Deno.test("annual-interval seat increase: sums a much larger proration correctly, same code path", () => {
  // An annual org adding 1 seat mid-period: same structure, but Stripe's
  // period-aware engine returns figures roughly 12x larger because there
  // are ~340 days left in the annual period rather than ~12 days left in a
  // month. getPositiveProrationAmount must not care about this magnitude —
  // it just sums whatever Stripe tagged as proration for this item.
  const invoice = fakeInvoice([
    prorationLine("si_seat_annual", -14400), // unused credit, most of a year left
    prorationLine("si_seat_annual", 17988), // new seat charge for the remaining year
  ]);

  const result = getPositiveProrationAmount(
    invoice,
    "si_seat_annual",
    "price_seat_annual",
  );

  if (result !== 3588) {
    throw new Error(`Expected 3588 (35.88), got ${result}`);
  }
});

Deno.test("excludes proration lines belonging to a different subscription item", () => {
  // Stripe can return proration lines for other items on the same invoice
  // preview (e.g. if the base plan item was also touched). Only the target
  // item's lines should be summed.
  const invoice = fakeInvoice([
    prorationLine("si_seat", 1499),
    prorationLine("si_base_plan", 50000), // unrelated — must be ignored
  ]);

  const result = getPositiveProrationAmount(invoice, "si_seat", "price_seat_monthly");

  if (result !== 1499) {
    throw new Error(`Expected 1499, got ${result}`);
  }
});

Deno.test("excludes non-proration (regular renewal) lines even for the target item", () => {
  const invoice = fakeInvoice([
    prorationLine("si_seat", 1499),
    regularRenewalLine("si_seat", 999900), // next full-period renewal — must be ignored
  ]);

  const result = getPositiveProrationAmount(invoice, "si_seat", "price_seat_monthly");

  if (result !== 1499) {
    throw new Error(`Expected 1499, got ${result}`);
  }
});

Deno.test("a net-negative proration (net credit) floors at zero, never charges a negative amount", () => {
  const invoice = fakeInvoice([
    prorationLine("si_seat", -500),
    prorationLine("si_seat", 300),
  ]);

  const result = getPositiveProrationAmount(invoice, "si_seat", "price_seat_monthly");

  if (result !== 0) {
    throw new Error(`Expected 0 (floored), got ${result}`);
  }
});

Deno.test("matches by price id instead of subscription item id when adding a brand-new item (first-time add-on)", () => {
  // The add-on preview path passes currentItem?.id ?? null, which is null
  // the first time an organization buys a given add-on pool (no existing
  // subscription item yet). In that case matching falls back to price id.
  const invoice = fakeInvoice([
    newItemProrationLine("price_app_addon_500", 2499),
    prorationLine("si_unrelated", 100000),
  ]);

  const result = getPositiveProrationAmount(invoice, null, "price_app_addon_500");

  if (result !== 2499) {
    throw new Error(`Expected 2499, got ${result}`);
  }
});
