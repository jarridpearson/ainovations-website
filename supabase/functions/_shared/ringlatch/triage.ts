/**
 * Call triage: spam screening and urgency classification.
 *
 * Spam screening runs on the opening turns, before the billable agent engages,
 * so robocalls never eat a client's minute cap. Urgency classification runs on
 * the full transcript and decides whether the owner's cell rings tonight.
 *
 * Neither is vertical-specific. What counts as urgent is configuration, not
 * code, so the same engine serves a plumber, a dental office and a body shop.
 */

import type { ClientProfile, DayKey } from "./profile.ts";
import { DAY_KEYS } from "./profile.ts";

export type SpamVerdict = {
  is_spam: boolean;
  /** 0..1 — how confident the screen is. */
  confidence: number;
  reason: string | null;
};

export type UrgencyLevel = "priority" | "routine";

export type UrgencyVerdict = {
  level: UrgencyLevel;
  matched: string[];
  /** Whether the owner's cell should ring right now. */
  should_transfer: boolean;
  reason: string;
};

/**
 * Urgency keyword packs.
 *
 * "Urgent" means something different to a plumber, a dentist and a body shop,
 * so nothing here is hardcoded into the agent. Every profile always gets the
 * `general` pack and adds whichever packs match the business. A business with
 * no genuine emergencies (most salons, most retail) can run with `general`
 * alone, or turn urgency routing off entirely.
 *
 * Adding a vertical means adding a pack here, not touching any client's setup.
 */
export const URGENCY_PACKS: Record<string, readonly string[]> = {
  /** Applied to every client. The caller is telling you it cannot wait. */
  general: [
    "emergency",
    "urgent",
    "right away",
    "as soon as possible",
    "asap",
    "today if possible",
    "can't wait",
    "cannot wait",
    "no one else could come",
  ],

  /** Plumbing, HVAC, electrical, excavation, tree service. */
  trades: [
    "no heat",
    "no hot water",
    "no water",
    "burst pipe",
    "pipe burst",
    "frozen pipe",
    "flooding",
    "flooded",
    "water everywhere",
    "sewage",
    "backing up",
    "gas smell",
    "smell gas",
    "smell of gas",
    "carbon monoxide",
    "sparking",
    "burning smell",
    "no power",
    "power out",
    "tree on",
    "tree down",
    "live wire",
    "furnace out",
    "boiler down",
    "well pump",
  ],

  /** Clinics, dental, veterinary. Never diagnostic — see the note below. */
  clinic: [
    "in a lot of pain",
    "severe pain",
    "swelling",
    "bleeding",
    "ran out of my prescription",
    "out of my medication",
    "need to be seen today",
    "got worse",
    "reaction",
  ],

  /** Auto shops, towing, mobile mechanics. */
  auto: [
    "broke down",
    "broken down",
    "won't start",
    "will not start",
    "stranded",
    "on the side of the road",
    "needs a tow",
    "got towed",
    "flat tire",
    "overheating",
  ],

  /** Property management, landlords, cleaning, restoration. */
  property: [
    "locked out",
    "lock out",
    "no heat",
    "leak",
    "leaking",
    "flooding",
    "break in",
    "broke in",
    "tenant emergency",
  ],

  /** Appointment businesses: salons, spas, studios, professional offices. */
  appointment: [
    "running late",
    "need to cancel",
    "need to reschedule",
    "double booked",
    "waiting outside",
  ],
};

export const URGENCY_PACK_KEYS = Object.keys(URGENCY_PACKS);

/**
 * The full trigger list for a client: the general pack, whichever vertical
 * packs the profile selected, plus anything the owner added by hand.
 */
export function urgencyKeywords(profile: ClientProfile): string[] {
  const packs = ["general", ...profile.urgency.packs];

  const fromPacks = packs.flatMap((pack) => URGENCY_PACKS[pack] ?? []);

  return [...new Set([...fromPacks, ...profile.urgency.keywords])];
}

/**
 * Phrases that reliably mark a solicitation rather than a customer. Kept
 * conservative on purpose: a missed lead costs the client a job, a missed spam
 * call costs a few cents of minutes.
 */
const SPAM_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\bvehicle(?:'s)? (?:extended )?warranty\b/i,
    reason: "auto warranty robocall",
  },
  { pattern: /\bfinal notice\b/i, reason: '"final notice" robocall framing' },
  {
    pattern: /\bgoogle (?:business )?(?:listing|profile)\b/i,
    reason: "Google listing solicitation",
  },
  {
    pattern: /\b(?:seo|search engine optimization) services\b/i,
    reason: "SEO solicitation",
  },
  {
    pattern:
      /\brank (?:you |your (?:site|website|business) )?(?:higher|number one|#1)\b/i,
    reason: "SEO solicitation",
  },
  {
    pattern: /\blower your (?:credit card |interest )?rate/i,
    reason: "rate-reduction robocall",
  },
  {
    pattern: /\bmerchant (?:cash advance|services|processing)\b/i,
    reason: "merchant services solicitation",
  },
  {
    pattern: /\bbusiness (?:loan|funding|capital)\b/i,
    reason: "business funding solicitation",
  },
  {
    pattern: /\bsolar (?:panels?|program|incentive)\b/i,
    reason: "solar solicitation",
  },
  {
    pattern: /\bmedicare (?:benefits?|supplement|advantage)\b/i,
    reason: "Medicare robocall",
  },
  {
    pattern: /\byour (?:social security|ssn) (?:number )?has been\b/i,
    reason: "SSN scam script",
  },
  {
    pattern: /\bpress (?:one|1) to (?:speak|be connected|opt out)\b/i,
    reason: "IVR robocall",
  },
  {
    pattern:
      /\bthis (?:call )?is (?:regarding|about) your (?:account|debt|loan)\b/i,
    reason: "debt-collection robocall",
  },
  {
    pattern:
      /\bwe(?:'re| are) (?:calling|reaching out) (?:on behalf of|from) .{0,40}\b(?:marketing|agency|leads?)\b/i,
    reason: "lead-gen solicitation",
  },
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Screens the caller's opening turns. `openingTurns` should be only what the
 * caller said before the agent starts real work — typically the first one or
 * two utterances.
 */
export function screenForSpam(openingTurns: string[]): SpamVerdict {
  const joined = normalize(openingTurns.join(" "));

  if (joined === "") {
    return {
      is_spam: true,
      confidence: 0.6,
      reason: "silent open — no caller audio",
    };
  }

  for (const { pattern, reason } of SPAM_PATTERNS) {
    if (pattern.test(joined)) {
      return { is_spam: true, confidence: 0.95, reason };
    }
  }

  return { is_spam: false, confidence: 0, reason: null };
}

/** Local weekday for a timestamp in the client's timezone. */
export function localDay(at: Date, timezone: string): DayKey {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(at).toLowerCase();

  const day = DAY_KEYS.find((candidate) => candidate === weekday);

  if (!day) {
    throw new Error(`Could not resolve weekday for timezone ${timezone}`);
  }

  return day;
}

/** Local "HH:MM" for a timestamp in the client's timezone. */
export function localTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

export function isOpenAt(profile: ClientProfile, at: Date): boolean {
  const window = profile.hours[localDay(at, profile.timezone)];

  if (!window) {
    return false;
  }

  const now = localTime(at, profile.timezone);

  return now >= window.open && now < window.close;
}

/**
 * Classifies urgency from the full caller transcript and decides whether to
 * ring the owner's cell now.
 */
export function classifyUrgency(
  profile: ClientProfile,
  callerText: string,
  at: Date,
): UrgencyVerdict {
  if (!profile.urgency.enabled) {
    return {
      level: "routine",
      matched: [],
      should_transfer: false,
      reason: "priority routing is turned off for this client",
    };
  }

  const haystack = normalize(callerText);

  const matched = [
    ...new Set(
      urgencyKeywords(profile).filter((keyword) =>
        haystack.includes(normalize(keyword))
      ),
    ),
  ];

  if (matched.length === 0) {
    return {
      level: "routine",
      matched: [],
      should_transfer: false,
      reason: "no priority triggers detected",
    };
  }

  const open = isOpenAt(profile, at);
  const allowedNow = profile.urgency.live_transfer &&
    (open || profile.urgency.transfer_after_hours);

  return {
    level: "priority",
    matched,
    should_transfer: allowedNow,
    reason: allowedNow
      ? "priority trigger - attempting live transfer to owner"
      : open
      ? "priority trigger - live transfer disabled, sending urgent alert"
      : "priority trigger after hours - sending urgent alert only",
  };
}
