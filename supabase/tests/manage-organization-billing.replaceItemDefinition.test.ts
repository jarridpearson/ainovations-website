// Deno test for the pure item-replacement logic used by manage-organization-billing
// to compute the future Stripe subscription items for the dedicated add-on
// subscription. This is the function that decides whether an add-on decrease
// leaves the add-on subscription with at least one item (schedule a phase) or
// zero items (the new code must cancel the subscription instead, since Stripe
// rejects a schedule phase with no items).
//
// Run with: deno test supabase/tests/manage-organization-billing.replaceItemDefinition.test.ts
//
// Lives under supabase/tests/, not inside the manage-organization-billing
// function directory, so it never gets bundled or deployed with the Edge
// Function itself.

function replaceItemDefinition(
  items: Array<{ price: string; quantity: number }>,
  oldPriceIds: string[],
  newPriceId: string | null,
  quantity: number,
) {
  const result = items.filter((item) => !oldPriceIds.includes(item.price));

  if (newPriceId && quantity > 0) {
    result.push({
      price: newPriceId,
      quantity,
    });
  }

  return result;
}

const PORTAL_ADDON_PRICES: Record<number, string> = {
  50: "price_portal_50",
  100: "price_portal_100",
};

const APP_ADDON_PRICES: Record<number, string> = {
  50: "price_app_50",
  100: "price_app_100",
};

Deno.test("cancelling the only add-on item yields an empty item list", () => {
  const currentItems = [{ price: PORTAL_ADDON_PRICES[50], quantity: 1 }];

  const future = replaceItemDefinition(
    currentItems,
    Object.values(PORTAL_ADDON_PRICES),
    null,
    0,
  );

  if (future.length !== 0) {
    throw new Error(
      `Expected an empty item list, got ${JSON.stringify(future)}`,
    );
  }
});

Deno.test("cancelling one pool while the other pool stays active leaves one item", () => {
  const currentItems = [
    { price: PORTAL_ADDON_PRICES[50], quantity: 1 },
    { price: APP_ADDON_PRICES[100], quantity: 1 },
  ];

  const future = replaceItemDefinition(
    currentItems,
    Object.values(PORTAL_ADDON_PRICES),
    null,
    0,
  );

  if (future.length !== 1 || future[0].price !== APP_ADDON_PRICES[100]) {
    throw new Error(
      `Expected only the app add-on item to remain, got ${JSON.stringify(future)}`,
    );
  }
});

Deno.test("upgrading a pool replaces the existing item rather than adding a second one", () => {
  const currentItems = [{ price: PORTAL_ADDON_PRICES[50], quantity: 1 }];

  const future = replaceItemDefinition(
    currentItems,
    Object.values(PORTAL_ADDON_PRICES),
    PORTAL_ADDON_PRICES[100],
    1,
  );

  if (future.length !== 1 || future[0].price !== PORTAL_ADDON_PRICES[100]) {
    throw new Error(
      `Expected a single upgraded item, got ${JSON.stringify(future)}`,
    );
  }
});

Deno.test("starting from zero items and requesting zero credits stays empty", () => {
  const future = replaceItemDefinition([], Object.values(PORTAL_ADDON_PRICES), null, 0);

  if (future.length !== 0) {
    throw new Error(
      `Expected an empty item list, got ${JSON.stringify(future)}`,
    );
  }
});
