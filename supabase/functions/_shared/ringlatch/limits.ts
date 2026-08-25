/**
 * Plans, caps and unit economics.
 *
 * The margin killer in a voice product is minutes, and metered overage billing
 * does not protect you: it bills after the damage and arrives as a surprise,
 * and surprise bills cause churn and chargebacks. So overage here is PREPAID
 * only — a client buys a minute pack (or opts into auto-refill) and full
 * service continues; nothing is ever metered onto a bill after the fact.
 *
 * The rule is DEGRADE, DO NOT DIE. A client who runs out of both plan and
 * purchased minutes still gets their leads caught — the agent just stops
 * chatting and takes a name and a number. That costs roughly a third as much
 * per call and keeps the promise the product is sold on. Only a client far past
 * their minutes with no balance stops being answered, and they get told loudly
 * before it happens.
 */

export type PlanKey = "standard" | "busy";
export type CallMode = "full" | "brief" | "closed";

export interface Plan {
  key: PlanKey;
  label: string;
  price_cents: number;
  included_minutes: number;
  /**
   * One AI tier across all plans (owner's call: simple beats segmented).
   * Chosen because every hard client commitment — urgency detection, caps,
   * spam screening, alert content — lives in this codebase, not the model;
   * the LLM only runs the scripted capture conversation. Margins hold above
   * the 60% floor even at premium-model cost, so a quality upgrade is always
   * affordable without touching prices.
   */
  ai_tier: string;
  /**
   * Real vendor cost per minute in cents: voice platform (as displayed for the
   * tier's model config) plus ~1.3c inbound telephony. Update from the
   * platform's own price readout, never from memory.
   */
  cost_per_minute_cents: number;
}

export const PLANS: Record<PlanKey, Plan> = {
  standard: {
    key: "standard",
    label: "Standard",
    price_cents: 14900,
    included_minutes: 150,
    ai_tier: "GPT 5 mini",
    cost_per_minute_cents: 9.5, // 8.2 platform (verified on-screen) + 1.3 tel
  },
  busy: {
    key: "busy",
    label: "Busy",
    price_cents: 29900,
    included_minutes: 400,
    ai_tier: "GPT 5 mini",
    cost_per_minute_cents: 9.5, // 8.2 platform (verified on-screen) + 1.3 tel
  },
};

/**
 * The overage product: a one-time pack of extra minutes.
 *
 * Rules, decided by the owner and enforced in code:
 *   - Plan minutes reset monthly and are always consumed FIRST.
 *   - Pack minutes are a persistent balance: they ROLL OVER month to month and
 *     are drawn only after plan minutes are exhausted.
 *   - Auto-refill (per-client opt-in) buys one pack the moment the combined
 *     balance hits zero, so full answering never stops.
 *
 * Priced above the Busy plan's effective per-minute rate (~75c/min) on
 * purpose: packs are for occasional overflow, and upgrading plans must always
 * be the better deal for sustained volume.
 */
export const MINUTE_PACK = {
  label: "Minute pack",
  price_cents: 7900,
  minutes: 100,
  cost_per_minute_cents: 9.5,
};

/**
 * Cost assumptions, in cents. Tune these as real invoices come in — every
 * margin number in the product derives from here and nowhere else.
 */
export const COSTS = {
  /** Phone number ($1.15) + campaign share ($1.50) + SMS for a typical month. */
  fixed_monthly: 600,
  /** Stripe: 2.9% + 30c. */
  stripe_percent: 0.029,
  stripe_fixed: 30,
};

/**
 * Hard ceiling on a single call, in seconds.
 *
 * A stuck or looping voice agent is a known failure mode and one runaway call
 * can eat a client's whole month. Nothing legitimate needs five minutes to take
 * a name, a number and a job.
 */
export const PER_CALL_SECONDS_CAP = 300;

/** A brief-mode call takes a name and a number, then ends. */
export const BRIEF_CALL_SECONDS_CAP = 45;

/** Warn the owner at this share of included minutes. */
export const WARN_AT = 0.8;

/**
 * Past this multiple of included minutes, stop answering entirely.
 *
 * 1.5 rather than 2: it lifts the worst reachable margin on the Busy plan from
 * 55% to 65%, and a client who is 50% over their minutes should be upgrading,
 * not being quietly subsidised.
 */
export const CLOSE_AT_MULTIPLE = 1.5;

export interface CapDecision {
  mode: CallMode;
  /** Hard stop for this call, in seconds. */
  seconds_cap: number;
  /** True when the owner should be told they are running out. */
  warn_owner: boolean;
  reason: string;
}

/**
 * Decides how to handle an inbound call given the client's usage so far this
 * billing period and their purchased-minute balance. Call this when the call
 * arrives, not when it ends.
 *
 * Purchased minutes keep the FULL agent running after plan minutes are gone —
 * that is what they are for. The degrade ladder (brief, then closed) only
 * applies once both plan and purchased minutes are exhausted, and buying a
 * pack at any point reopens full service immediately.
 */
export function decideCallMode(
  plan: Plan,
  minutesUsedThisPeriod: number,
  purchasedMinutes = 0,
): CapDecision {
  const included = plan.included_minutes;

  if (minutesUsedThisPeriod >= included) {
    if (purchasedMinutes > 0) {
      return {
        mode: "full",
        seconds_cap: PER_CALL_SECONDS_CAP,
        warn_owner: true,
        reason:
          `plan minutes used — answering on purchased minutes (${purchasedMinutes} left)`,
      };
    }

    if (minutesUsedThisPeriod >= included * CLOSE_AT_MULTIPLE) {
      return {
        mode: "closed",
        seconds_cap: 0,
        warn_owner: true,
        reason:
          `used ${minutesUsedThisPeriod} of ${included} minutes — past the hard ceiling`,
      };
    }

    return {
      mode: "brief",
      seconds_cap: BRIEF_CALL_SECONDS_CAP,
      warn_owner: true,
      reason:
        `used ${minutesUsedThisPeriod} of ${included} minutes — taking name and number only`,
    };
  }

  return {
    mode: "full",
    seconds_cap: PER_CALL_SECONDS_CAP,
    warn_owner: minutesUsedThisPeriod >= included * WARN_AT,
    reason: "within included minutes",
  };
}

/**
 * How much of one call's billable time comes out of the purchased balance.
 *
 * Plan minutes are consumed first: only the portion of this call that pushed
 * period usage past the plan allowance draws the balance down. Pass the
 * period's total billable seconds INCLUDING this call.
 */
export function purchasedDrawSeconds(
  billableThisCall: number,
  periodSecondsAfterCall: number,
  includedMinutes: number,
): number {
  const overflow = periodSecondsAfterCall - includedMinutes * 60;

  return Math.max(0, Math.min(billableThisCall, overflow));
}

/** Screened spam is never billed against a client's minutes. */
export function billableSeconds(
  durationSeconds: number,
  isSpam: boolean,
  mode: CallMode = "full",
): number {
  if (isSpam || mode === "closed") {
    return 0;
  }

  const cap = mode === "brief" ? BRIEF_CALL_SECONDS_CAP : PER_CALL_SECONDS_CAP;

  return Math.max(0, Math.min(durationSeconds, cap));
}

export interface UnitEconomics {
  revenue_cents: number;
  cost_cents: number;
  gross_profit_cents: number;
  margin: number;
}

/** Monthly unit economics for one client at a given usage level. */
export function unitEconomics(
  plan: Plan,
  minutesUsed: number,
): UnitEconomics {
  const revenue = plan.price_cents;

  const stripe = Math.round(
    revenue * COSTS.stripe_percent + COSTS.stripe_fixed,
  );

  // Usage is bounded by the caps, so cost cannot run away with the client.
  const billedMinutes = Math.min(
    minutesUsed,
    plan.included_minutes * CLOSE_AT_MULTIPLE,
  );

  const cost = Math.round(billedMinutes * plan.cost_per_minute_cents) +
    COSTS.fixed_monthly + stripe;

  return {
    revenue_cents: revenue,
    cost_cents: cost,
    gross_profit_cents: revenue - cost,
    margin: (revenue - cost) / revenue,
  };
}

/**
 * The worst case that is actually reachable: a client who uses every minute
 * they are allowed to before the hard ceiling closes them. If this margin is
 * ever unacceptable, the caps are wrong — not the price.
 */
export function worstCaseMargin(plan: Plan): number {
  return unitEconomics(plan, plan.included_minutes * CLOSE_AT_MULTIPLE).margin;
}

/**
 * Pack economics stand alone: every purchased minute carries its own revenue,
 * so packs can never dilute plan margins — only add to them.
 */
export function packEconomics(): UnitEconomics {
  const revenue = MINUTE_PACK.price_cents;

  const stripe = Math.round(
    revenue * COSTS.stripe_percent + COSTS.stripe_fixed,
  );

  const cost =
    Math.round(MINUTE_PACK.minutes * MINUTE_PACK.cost_per_minute_cents) +
    stripe;

  return {
    revenue_cents: revenue,
    cost_cents: cost,
    gross_profit_cents: revenue - cost,
    margin: (revenue - cost) / revenue,
  };
}
