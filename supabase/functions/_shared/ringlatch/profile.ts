/**
 * Ringlatch client profile.
 *
 * One agent template, config-driven: every client is a single JSON profile plus
 * a phone number. Nothing in this repo should ever contain per-client code.
 */

export type CoverageMode = "missed_call" | "full_answering";

export type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const DAY_KEYS: readonly DayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** `null` means closed that day. Times are local 24h "HH:MM". */
export type WeeklyHours = Record<
  DayKey,
  { open: string; close: string } | null
>;

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface UrgencyRules {
  /** Off for businesses where nothing genuinely can't wait. */
  enabled: boolean;
  /**
   * Vertical keyword packs from URGENCY_PACKS — "trades", "clinic", "auto",
   * "property", "appointment". The "general" pack always applies. Choosing
   * packs rather than hardcoding trade words is what lets one engine serve
   * every business type.
   */
  packs: string[];
  /** Extra client-specific triggers, merged with the selected packs. */
  keywords: string[];
  /** Attempt a live transfer to the owner's cell before falling back to SMS. */
  live_transfer: boolean;
  /** Transfer outside business hours too. */
  transfer_after_hours: boolean;
}

export interface ClientProfile {
  /** Stable identifier, also the Supabase lookup key. */
  slug: string;
  business_name: string;
  /** What the agent says out loud, if different from the legal name. */
  spoken_name?: string;
  timezone: string;

  coverage_mode: CoverageMode;

  phone: {
    /** The client's real, published number. Never changes. */
    main: string;
    /** The dedicated Ringlatch number calls forward to. */
    ringlatch: string;
    /** Where urgent calls and lead alerts go. */
    owner_cell: string;
  };

  hours: WeeklyHours;
  services: string[];
  service_area: string[];
  /**
   * What kind of business this is, in the owner's own words — "dental office",
   * "excavation contractor", "hair salon". The agent uses it to describe the
   * business naturally instead of assuming a trade.
   */
  business_type: string;
  /** Ballpark guidance only — the agent must never quote a firm price. */
  pricing_notes: string[];
  faqs: FaqEntry[];
  urgency: UrgencyRules;

  notify: {
    sms_to: string[];
    email_to: string[];
  };

  /**
   * Additional businesses answered on this SAME account and number. One
   * owner, one subscription, one minutes pool — the agent asks callers which
   * business they need. Never a second account.
   */
  businesses?: { name: string; business_type: string }[];
}

export class ProfileError extends Error {}

/**
 * Kept in sync with URGENCY_PACKS in triage.ts. Duplicated rather than imported
 * because triage.ts imports this module, and a cycle here would break the
 * edge-function bundle.
 */
const VALID_PACKS = [
  "general",
  "trades",
  "clinic",
  "auto",
  "property",
  "appointment",
];

const E164 = /^\+1\d{10}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProfileError(`${field} is required`);
  }

  return value.trim();
}

function requirePhone(value: unknown, field: string): string {
  const phone = requireString(value, field);

  if (!E164.test(phone)) {
    throw new ProfileError(`${field} must be E.164, e.g. +13155550142`);
  }

  return phone;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ProfileError(`${field} must be an array of strings`);
  }

  return (value as string[]).map((item) => item.trim()).filter(Boolean);
}

/**
 * A misspelled pack would silently disable every trigger it was meant to add,
 * so an unknown name is a hard failure during onboarding rather than a client
 * quietly running without urgency detection.
 */
function parsePacks(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  const packs = requireStringArray(value, "urgency.packs");

  for (const pack of packs) {
    if (!VALID_PACKS.includes(pack)) {
      throw new ProfileError(
        `urgency.packs contains unknown pack "${pack}" — valid packs: ${
          VALID_PACKS.join(", ")
        }`,
      );
    }
  }

  return packs;
}

function parseHours(value: unknown): WeeklyHours {
  if (typeof value !== "object" || value === null) {
    throw new ProfileError("hours is required");
  }

  const raw = value as Record<string, unknown>;
  const hours = {} as WeeklyHours;

  for (const day of DAY_KEYS) {
    const entry = raw[day];

    if (entry === null || entry === undefined) {
      hours[day] = null;
      continue;
    }

    if (typeof entry !== "object") {
      throw new ProfileError(`hours.${day} must be null or {open, close}`);
    }

    const { open, close } = entry as Record<string, unknown>;
    const openTime = requireString(open, `hours.${day}.open`);
    const closeTime = requireString(close, `hours.${day}.close`);

    if (!TIME.test(openTime) || !TIME.test(closeTime)) {
      throw new ProfileError(`hours.${day} times must be 24h "HH:MM"`);
    }

    if (openTime >= closeTime) {
      throw new ProfileError(`hours.${day} closes before it opens`);
    }

    hours[day] = { open: openTime, close: closeTime };
  }

  return hours;
}

/**
 * Validates an untrusted profile (intake form, JSON file) into a ClientProfile.
 * Throws ProfileError with a message safe to show during onboarding.
 */
export function parseProfile(input: unknown): ClientProfile {
  if (typeof input !== "object" || input === null) {
    throw new ProfileError("profile must be an object");
  }

  const raw = input as Record<string, unknown>;
  const phone = (raw.phone ?? {}) as Record<string, unknown>;
  const urgency = (raw.urgency ?? {}) as Record<string, unknown>;
  const notify = (raw.notify ?? {}) as Record<string, unknown>;

  const coverageMode = requireString(raw.coverage_mode, "coverage_mode");

  if (coverageMode !== "missed_call" && coverageMode !== "full_answering") {
    throw new ProfileError(
      'coverage_mode must be "missed_call" or "full_answering"',
    );
  }

  const services = requireStringArray(raw.services, "services");

  if (services.length === 0) {
    throw new ProfileError("services must list at least one service");
  }

  const smsTo = requireStringArray(notify.sms_to, "notify.sms_to")
    .map((value, index) => requirePhone(value, `notify.sms_to[${index}]`));

  // SMS requires A2P consent, which is never a condition of signup — so a
  // client may be email-only. They must be reachable SOMEWHERE, though.
  const emailCount = Array.isArray(notify.email_to) ? notify.email_to.length : 0;

  if (smsTo.length === 0 && emailCount === 0) {
    throw new ProfileError(
      "notify must list at least one SMS number or email address",
    );
  }

  return {
    slug: requireString(raw.slug, "slug"),
    business_name: requireString(raw.business_name, "business_name"),
    business_type: requireString(raw.business_type, "business_type"),
    spoken_name: typeof raw.spoken_name === "string" && raw.spoken_name.trim()
      ? raw.spoken_name.trim()
      : undefined,
    timezone: requireString(raw.timezone, "timezone"),
    coverage_mode: coverageMode,
    phone: {
      main: requirePhone(phone.main, "phone.main"),
      ringlatch: requirePhone(phone.ringlatch, "phone.ringlatch"),
      owner_cell: requirePhone(phone.owner_cell, "phone.owner_cell"),
    },
    hours: parseHours(raw.hours),
    services,
    service_area: requireStringArray(raw.service_area, "service_area"),
    pricing_notes: Array.isArray(raw.pricing_notes)
      ? requireStringArray(raw.pricing_notes, "pricing_notes")
      : [],
    faqs: Array.isArray(raw.faqs)
      ? (raw.faqs as unknown[]).map((entry, index) => {
        const faq = (entry ?? {}) as Record<string, unknown>;

        return {
          question: requireString(faq.question, `faqs[${index}].question`),
          answer: requireString(faq.answer, `faqs[${index}].answer`),
        };
      })
      : [],
    urgency: {
      enabled: urgency.enabled !== false,
      packs: parsePacks(urgency.packs),
      keywords: Array.isArray(urgency.keywords)
        ? requireStringArray(urgency.keywords, "urgency.keywords")
        : [],
      live_transfer: urgency.live_transfer !== false,
      transfer_after_hours: urgency.transfer_after_hours !== false,
    },
    notify: {
      sms_to: smsTo,
      email_to: Array.isArray(notify.email_to)
        ? requireStringArray(notify.email_to, "notify.email_to")
        : [],
    },
    businesses: Array.isArray(raw.businesses)
      ? (raw.businesses as unknown[]).map((entry, index) => {
        const extra = (entry ?? {}) as Record<string, unknown>;

        return {
          name: requireString(extra.name, `businesses[${index}].name`),
          business_type: requireString(
            extra.business_type,
            `businesses[${index}].business_type`,
          ),
        };
      })
      : undefined,
  };
}

/** The name the agent speaks. */
export function spokenName(profile: ClientProfile): string {
  return profile.spoken_name ?? profile.business_name;
}
