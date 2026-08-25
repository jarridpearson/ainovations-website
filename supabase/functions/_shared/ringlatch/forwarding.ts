/**
 * Conditional call forwarding instructions, by line type.
 *
 * With setup done entirely over the phone, this step is the whole onboarding.
 * Nobody can reach over and do it for the owner, so the instructions have to be
 * exact, short enough to read aloud, and correct on the first try.
 *
 * "Conditional" forwarding is the key idea: only unanswered and busy calls move
 * to Ringlatch. The owner's own phone rings first, every time, and nothing
 * about their published number changes.
 *
 * Two things differ between mobile and landline and both will bite you:
 *
 *   1. A cell phone sets busy AND no-answer with ONE code. A landline needs
 *      TWO separate codes, dialed one after the other. Set only one and half
 *      the missed calls quietly never reach Ringlatch.
 *   2. A cell dialer accepts "+1315...". A landline keypad does not — it needs
 *      plain digits. Reading a "+1" number to someone on a landline is a
 *      guaranteed failed setup.
 *
 * !! VERIFY BEFORE USE !!
 * These codes are transcribed from public carrier and Telcordia vertical
 * service code documentation and have NOT been dialed and confirmed. They vary
 * between postpaid, prepaid, reseller and legacy plans. Confirm each against
 * the provider's current documentation before walking a client through it, and
 * correct this file when reality disagrees.
 */

export type CarrierKey =
  | "verizon"
  | "att"
  | "tmobile"
  | "us_cellular"
  | "gsm_generic"
  | "landline"
  | "cable_voip"
  | "hosted_voip";

/** How the destination number has to be keyed on this kind of line. */
export type DialFormat = "e164" | "one_plus_ten" | "ten_digit";

export interface DialStep {
  /** Code with {number} substituted at render time. */
  code: string;
  /** What this step covers, in plain language. */
  purpose: string;
}

export interface CarrierForwarding {
  key: CarrierKey;
  label: string;
  line_type: "mobile" | "landline" | "voip";
  dial_format: DialFormat;
  enable: DialStep[];
  disable: DialStep[];
  notes: string[];
  /** True when there are no dial codes and it must be done in a web portal. */
  portal_only: boolean;
}

export const CARRIERS: Record<CarrierKey, CarrierForwarding> = {
  verizon: {
    key: "verizon",
    label: "Verizon Wireless",
    line_type: "mobile",
    dial_format: "e164",
    enable: [{ code: "*71{number}", purpose: "busy and no answer, together" }],
    disable: [{ code: "*73", purpose: "turns forwarding off" }],
    notes: [
      "Wait for the confirmation tone before hanging up.",
      "Do not use *72 — that forwards every call and the owner's phone stops ringing.",
      "Verizon dominates up here, so this is the common path.",
    ],
    portal_only: false,
  },

  att: {
    key: "att",
    label: "AT&T",
    line_type: "mobile",
    dial_format: "e164",
    enable: [{
      code: "*004*{number}#",
      purpose: "busy, no answer and unreachable, together",
    }],
    disable: [{ code: "##004#", purpose: "turns forwarding off" }],
    notes: [
      "To set them individually: *61*{number}# no answer, *67*{number}# busy, *62*{number}# unreachable.",
    ],
    portal_only: false,
  },

  tmobile: {
    key: "tmobile",
    label: "T-Mobile",
    line_type: "mobile",
    dial_format: "e164",
    enable: [{
      code: "**004*{number}#",
      purpose: "busy, no answer and unreachable, together",
    }],
    disable: [{ code: "##004#", purpose: "turns forwarding off" }],
    notes: [
      "Standard GSM supplementary service codes.",
      "T-Mobile coverage is thin in parts of the North Country — confirm the owner actually has service before blaming the code.",
    ],
    portal_only: false,
  },

  us_cellular: {
    key: "us_cellular",
    label: "US Cellular",
    line_type: "mobile",
    dial_format: "e164",
    enable: [{ code: "*71{number}", purpose: "busy and no answer, together" }],
    disable: [{ code: "*73", purpose: "turns forwarding off" }],
    notes: [
      "Behaves like Verizon on most plans, but confirm — some plans use the GSM **004* form instead.",
    ],
    portal_only: false,
  },

  gsm_generic: {
    key: "gsm_generic",
    label: "Other mobile carrier / MVNO",
    line_type: "mobile",
    dial_format: "e164",
    enable: [{
      code: "**004*{number}#",
      purpose: "busy, no answer and unreachable, together",
    }],
    disable: [{ code: "##004#", purpose: "turns forwarding off" }],
    notes: [
      "Most MVNOs inherit the host network's GSM codes.",
      "If it fails, the MVNO has usually disabled conditional forwarding entirely and it has to be done from their app or by their support line.",
    ],
    portal_only: false,
  },

  landline: {
    key: "landline",
    label: "Landline (Frontier, Windstream, CenturyLink, Verizon copper)",
    line_type: "landline",
    dial_format: "one_plus_ten",
    // TWO codes. Setting only one is the most common landline failure.
    enable: [
      { code: "*90{number}", purpose: "when the line is busy" },
      { code: "*92{number}", purpose: "when nobody answers" },
    ],
    disable: [
      { code: "*91", purpose: "turns off busy forwarding" },
      { code: "*93", purpose: "turns off no-answer forwarding" },
    ],
    notes: [
      "BOTH codes are required. *90 alone misses every call that simply rings out — which is most of them.",
      "Dial plain digits, not +1. A landline keypad has no + key.",
      "Listen for the stutter dial tone or confirmation tone after each one.",
      "GOTCHA: 'Call Forward Busy Line / Don't Answer' is often a paid add-on that is NOT on basic service. If the codes are rejected, the feature has to be added to the account first — usually a few dollars a month. Check this during intake, not while the owner is standing there dialing.",
      "Ring count before forwarding is usually set by the carrier, not the owner. If it forwards too fast or too slow, that is a call to the carrier.",
      "A rotary or pulse phone cannot dial star codes at all — that one goes through the carrier.",
    ],
    portal_only: false,
  },

  cable_voip: {
    key: "cable_voip",
    label: "Cable phone (Spectrum, Comcast)",
    line_type: "voip",
    dial_format: "one_plus_ten",
    enable: [
      { code: "*90{number}", purpose: "when the line is busy" },
      { code: "*92{number}", purpose: "when nobody answers" },
    ],
    disable: [
      { code: "*91", purpose: "turns off busy forwarding" },
      { code: "*93", purpose: "turns off no-answer forwarding" },
    ],
    notes: [
      "Same two-code pattern as a landline — both are required.",
      "These also have a web portal, which is the better path if the codes misbehave: look for 'Call Forwarding Busy' and 'Call Forwarding No Answer'.",
    ],
    portal_only: false,
  },

  hosted_voip: {
    key: "hosted_voip",
    label: "Hosted VoIP (RingCentral, Vonage, 8x8, Google Voice)",
    line_type: "voip",
    dial_format: "e164",
    enable: [],
    disable: [],
    notes: [
      "No codes. Forwarding is set in the provider's web portal or app.",
      "Set BOTH 'Call Forward Busy' and 'Call Forward No Answer' to the Ringlatch number.",
      "Set the no-answer delay to about 4 rings, roughly 20 seconds.",
      "Screen share and drive it from the owner's account — this is the slowest onboarding path, so budget extra time.",
      "If the business runs a PBX or a multi-line system, forwarding lives in the phone system, not on the line. That is a different conversation and may need their installer.",
    ],
    portal_only: true,
  },
};

/** Formats the destination number the way this kind of line needs it keyed. */
export function formatForDialing(e164: string, format: DialFormat): string {
  const digits = e164.replace(/\D/g, "");
  const ten = digits.slice(-10);

  switch (format) {
    case "e164":
      return `+1${ten}`;
    case "one_plus_ten":
      return `1${ten}`;
    case "ten_digit":
      return ten;
  }
}

function substitute(text: string, number: string): string {
  return text.replaceAll("{number}", number);
}

/**
 * Renders read-aloud instructions for one line type. Written to be spoken down
 * a phone line to someone holding their handset: no jargon, one step at a time.
 */
export function forwardingScript(
  carrier: CarrierKey,
  ringlatchNumber: string,
): string[] {
  const entry = CARRIERS[carrier];

  if (!entry) {
    throw new Error(`Unknown carrier: ${carrier}`);
  }

  const dialed = formatForDialing(ringlatchNumber, entry.dial_format);

  if (entry.portal_only) {
    return [
      `${entry.label}: no codes to dial — this one is done in their account.`,
      ...entry.notes.map((note) => `  - ${substitute(note, dialed)}`),
      `  - Forward both "busy" and "no answer" to ${dialed}.`,
    ];
  }

  const lines = [entry.label];

  if (entry.enable.length > 1) {
    lines.push(`  Dial BOTH of these, one after the other:`);
  }

  for (const step of entry.enable) {
    lines.push(
      `  Turn on:  ${substitute(step.code, dialed)}   (${step.purpose})`,
    );
  }

  for (const step of entry.disable) {
    lines.push(
      `  Turn off: ${substitute(step.code, dialed)}   (${step.purpose})`,
    );
  }

  lines.push(...entry.notes.map((note) => `  - ${substitute(note, dialed)}`));

  return lines;
}

/**
 * Tappable dial links for the setup page.
 *
 * No API can do this step for the owner: no provider exposes conditional
 * forwarding on someone else's account, so the code has to be dialed from
 * their phone. The best available is one tap.
 *
 * Codes without a "#" load straight into the dialer and work as links. Codes
 * ending in "#" are MMI codes, which iOS and Android block from web links —
 * those get a copy button instead. Pretending otherwise produces a button that
 * silently does nothing, which is worse than no button.
 */
export function dialLinks(
  carrier: CarrierKey,
  ringlatchNumber: string,
): { href: string | null; one_tap: boolean; code: string; purpose: string }[] {
  const entry = CARRIERS[carrier];

  if (!entry || entry.portal_only) {
    return [];
  }

  const dialed = formatForDialing(ringlatchNumber, entry.dial_format);

  return entry.enable.map((step) => {
    const code = substitute(step.code, dialed);
    const blocked = code.includes("#");

    return {
      href: blocked ? null : `tel:${code}`,
      one_tap: !blocked,
      code,
      purpose: step.purpose,
    };
  });
}

/**
 * The confirmation step. Forwarding silently failing is the worst outcome,
 * because everyone believes it is working until a lead is lost.
 */
export const VERIFICATION_STEPS: readonly string[] = [
  "Have the owner put their own phone face down and NOT answer it.",
  "Call their published business number from your phone.",
  "Let it ring out. Ringlatch should pick up after about four rings.",
  "On a landline, test BUSY as well: have the owner take the phone off the hook, then call again. It must also reach Ringlatch. This is the half people forget to set.",
  "Then call once more and have the owner answer it themselves — confirm their phone still rings first and the call is theirs.",
  "If Ringlatch answers on the FIRST ring, unconditional forwarding got set by mistake. Turn it off and redo it with the conditional codes.",
];
