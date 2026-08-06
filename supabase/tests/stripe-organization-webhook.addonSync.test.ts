// Proves the gating behavior fixed in stripe-organization-webhook/index.ts:
// - base-plan subscription/invoice events must never touch the AI credit
//   ledgers (that was the original bug: they were zeroing add-on allocations)
// - add-on subscription/invoice events must still synchronize them
// - stripe_addon_subscription_id is cleared only on actual cancellation
//   (subscription.status === "canceled"), never on a merely-scheduled one
//   (cancel_at_period_end: true while status stays "active")
// - the cleared value is exactly what create-organization-addon-checkout's
//   real repurchase guard checks (imported and exercised directly below,
//   not re-implemented)
//
// Run with: deno test --node-modules-dir=none supabase/tests/stripe-organization-webhook.addonSync.test.ts

import {
  handleInvoiceEvent,
  synchronizeSubscription,
} from "../functions/stripe-organization-webhook/index.ts";
import { hasExistingAddonSubscription } from "../functions/create-organization-addon-checkout/index.ts";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

type RpcCall = { name: string; args: Record<string, unknown> };

function createFakeAdminClient(config: {
  organizationRow: Record<string, unknown>;
  seatsInUse?: number;
}) {
  const rpcCalls: RpcCall[] = [];
  const updateCalls: { table: string; values: Record<string, unknown> }[] =
    [];
  const insertCalls: { table: string; values: Record<string, unknown> }[] =
    [];

  // deno-lint-ignore no-explicit-any
  function builder(table: string, finalResult: Record<string, unknown>): any {
    const self = {
      select: () => self,
      eq: () => self,
      update: (values: Record<string, unknown>) => {
        updateCalls.push({ table, values });
        return self;
      },
      insert: (values: Record<string, unknown>) => {
        insertCalls.push({ table, values });
        return Promise.resolve({ error: null });
      },
      maybeSingle: () =>
        Promise.resolve({ data: config.organizationRow, error: null }),
      then: (resolve: (value: Record<string, unknown>) => void) =>
        resolve(finalResult),
    };
    return self;
  }

  const client = {
    from(table: string) {
      if (table === "organization_users") {
        return builder(table, { count: config.seatsInUse ?? 0, error: null });
      }
      return builder(table, { error: null });
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: 0, error: null });
    },
  };

  return { client, rpcCalls, updateCalls, insertCalls };
}

function addonSyncRpcNames(calls: RpcCall[]) {
  return calls.map((call) => call.name).sort();
}

const BASE_ORGANIZATION_ROW = {
  id: ORG_ID,
  current_plan_key: "organization_starter",
  subscription_status: "active",
  paid_seat_count: 1,
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_base_1",
  stripe_addon_subscription_id: null,
};

function fakeBaseSubscription(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "sub_base_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    start_date: 1700000000,
    metadata: {
      organization_id: ORG_ID,
      plan_key: "organization_starter",
      billing_interval: "monthly",
    },
    items: { data: [] },
    ...overrides,
  };
}

function fakeAddonSubscription(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "sub_addon_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: {
      organization_id: ORG_ID,
      subscription_kind: "ai_addons",
    },
    items: { data: [] },
    ...overrides,
  };
}

const noopStripe = {} as never;

Deno.test("base subscription event never synchronizes add-on credits", async () => {
  const { client, rpcCalls } = createFakeAdminClient({
    organizationRow: BASE_ORGANIZATION_ROW,
    seatsInUse: 0,
  });

  await synchronizeSubscription(
    noopStripe,
    // deno-lint-ignore no-explicit-any
    client as any,
    "evt_base_1",
    fakeBaseSubscription() as never,
  );

  if (rpcCalls.length !== 0) {
    throw new Error(
      `Expected no add-on sync RPCs for a base subscription event, got: ${
        JSON.stringify(addonSyncRpcNames(rpcCalls))
      }`,
    );
  }
});

Deno.test("add-on subscription event always synchronizes add-on credits", async () => {
  const { client, rpcCalls } = createFakeAdminClient({
    organizationRow: BASE_ORGANIZATION_ROW,
  });

  await synchronizeSubscription(
    noopStripe,
    // deno-lint-ignore no-explicit-any
    client as any,
    "evt_addon_1",
    fakeAddonSubscription() as never,
  );

  const names = addonSyncRpcNames(rpcCalls);

  if (
    names.length !== 2 ||
    !names.includes("sync_organization_app_pool_recurring_addons") ||
    !names.includes("sync_organization_portal_recurring_addons")
  ) {
    throw new Error(
      `Expected both add-on sync RPCs for an add-on subscription event, got: ${
        JSON.stringify(names)
      }`,
    );
  }
});

Deno.test("base invoice event never synchronizes add-on credits", async () => {
  const { client, rpcCalls } = createFakeAdminClient({
    organizationRow: BASE_ORGANIZATION_ROW,
  });

  const fakeStripe = {
    subscriptions: {
      retrieve: () => Promise.resolve(fakeBaseSubscription()),
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  const fakeInvoice = {
    id: "in_base_1",
    customer: "cus_1",
    parent: { subscription_details: { subscription: "sub_base_1" } },
    amount_paid: 1000,
    amount_due: 1000,
    currency: "usd",
  };

  await handleInvoiceEvent(
    fakeStripe,
    // deno-lint-ignore no-explicit-any
    client as any,
    "evt_inv_base_1",
    fakeInvoice as never,
    true,
  );

  if (rpcCalls.length !== 0) {
    throw new Error(
      `Expected no add-on sync RPCs for a base invoice event, got: ${
        JSON.stringify(addonSyncRpcNames(rpcCalls))
      }`,
    );
  }
});

Deno.test("add-on invoice event synchronizes add-on credits", async () => {
  const { client, rpcCalls } = createFakeAdminClient({
    organizationRow: BASE_ORGANIZATION_ROW,
  });

  const fakeStripe = {
    subscriptions: {
      retrieve: () => Promise.resolve(fakeAddonSubscription()),
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  const fakeInvoice = {
    id: "in_addon_1",
    customer: "cus_1",
    parent: { subscription_details: { subscription: "sub_addon_1" } },
    amount_paid: 500,
    amount_due: 500,
    currency: "usd",
  };

  await handleInvoiceEvent(
    fakeStripe,
    // deno-lint-ignore no-explicit-any
    client as any,
    "evt_inv_addon_1",
    fakeInvoice as never,
    true,
  );

  const names = addonSyncRpcNames(rpcCalls);

  if (
    names.length !== 2 ||
    !names.includes("sync_organization_app_pool_recurring_addons") ||
    !names.includes("sync_organization_portal_recurring_addons")
  ) {
    throw new Error(
      `Expected both add-on sync RPCs for an add-on invoice event, got: ${
        JSON.stringify(names)
      }`,
    );
  }
});

Deno.test("a failed (unsuccessful) invoice event never synchronizes add-on credits, even for an add-on subscription", async () => {
  const { client, rpcCalls } = createFakeAdminClient({
    organizationRow: BASE_ORGANIZATION_ROW,
  });

  const fakeStripe = {
    subscriptions: {
      retrieve: () => Promise.resolve(fakeAddonSubscription()),
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  const fakeInvoice = {
    id: "in_addon_failed_1",
    customer: "cus_1",
    parent: { subscription_details: { subscription: "sub_addon_1" } },
    amount_paid: 0,
    amount_due: 500,
    currency: "usd",
  };

  await handleInvoiceEvent(
    fakeStripe,
    // deno-lint-ignore no-explicit-any
    client as any,
    "evt_inv_addon_failed_1",
    fakeInvoice as never,
    false,
  );

  if (rpcCalls.length !== 0) {
    throw new Error(
      `Expected no add-on sync RPCs for a payment_failed invoice event, got: ${
        JSON.stringify(addonSyncRpcNames(rpcCalls))
      }`,
    );
  }
});

Deno.test("scheduled cancellation (cancel_at_period_end, still active) keeps stripe_addon_subscription_id set", async () => {
  const { client, updateCalls } = createFakeAdminClient({
    organizationRow: BASE_ORGANIZATION_ROW,
  });

  await synchronizeSubscription(
    noopStripe,
    // deno-lint-ignore no-explicit-any
    client as any,
    "evt_addon_scheduled_cancel",
    fakeAddonSubscription({
      status: "active",
      cancel_at_period_end: true,
    }) as never,
  );

  const organizationsUpdate = updateCalls.find(
    (call) => call.table === "organizations",
  );

  if (!organizationsUpdate) {
    throw new Error("Expected an update to the organizations table.");
  }

  if (organizationsUpdate.values.stripe_addon_subscription_id !== "sub_addon_1") {
    throw new Error(
      `Expected stripe_addon_subscription_id to remain "sub_addon_1" while the cancellation is only scheduled, got: ${
        JSON.stringify(organizationsUpdate.values.stripe_addon_subscription_id)
      }`,
    );
  }
});

Deno.test("actual cancellation (status canceled) clears stripe_addon_subscription_id", async () => {
  const { client, updateCalls } = createFakeAdminClient({
    organizationRow: BASE_ORGANIZATION_ROW,
  });

  await synchronizeSubscription(
    noopStripe,
    // deno-lint-ignore no-explicit-any
    client as any,
    "evt_addon_actual_cancel",
    fakeAddonSubscription({
      status: "canceled",
      cancel_at_period_end: true,
    }) as never,
  );

  const organizationsUpdate = updateCalls.find(
    (call) => call.table === "organizations",
  );

  if (!organizationsUpdate) {
    throw new Error("Expected an update to the organizations table.");
  }

  if (organizationsUpdate.values.stripe_addon_subscription_id !== null) {
    throw new Error(
      `Expected stripe_addon_subscription_id to be cleared once the subscription is actually canceled, got: ${
        JSON.stringify(organizationsUpdate.values.stripe_addon_subscription_id)
      }`,
    );
  }
});

Deno.test("repurchase after cancellation: the cleared value passes create-organization-addon-checkout's real guard", async () => {
  const { client, updateCalls } = createFakeAdminClient({
    organizationRow: BASE_ORGANIZATION_ROW,
  });

  await synchronizeSubscription(
    noopStripe,
    // deno-lint-ignore no-explicit-any
    client as any,
    "evt_addon_repurchase_cancel",
    fakeAddonSubscription({ status: "canceled" }) as never,
  );

  const organizationsUpdate = updateCalls.find(
    (call) => call.table === "organizations",
  );

  const clearedId = organizationsUpdate?.values
    .stripe_addon_subscription_id as string | null;

  // This is the actual exported guard from create-organization-addon-checkout,
  // not a re-implementation — proving the postcondition our webhook produces
  // is exactly what unblocks a repurchase.
  const blocked = hasExistingAddonSubscription({
    stripe_addon_subscription_id: clearedId,
  });

  if (blocked) {
    throw new Error(
      "Expected the real create-organization-addon-checkout guard to allow a repurchase once stripe_addon_subscription_id is cleared, but it still reports an existing subscription.",
    );
  }

  // And the inverse, for contrast: before cancellation the same guard blocks it.
  const stillBlocked = hasExistingAddonSubscription({
    stripe_addon_subscription_id: "sub_addon_1",
  });

  if (!stillBlocked) {
    throw new Error(
      "Expected the guard to still block a second purchase while stripe_addon_subscription_id is set.",
    );
  }
});
