/**
 * Composes everything Ringlatch sends after a call: the owner's SMS alert, the
 * owner's email summary, and the instant text-back to a caller who hung up.
 *
 * The owner's SMS is the product. It is read one-handed, in a truck, in the
 * dark. It must survive being glanced at.
 */

import type { ClientProfile } from "./profile.ts";
import { spokenName } from "./profile.ts";
import type { UrgencyVerdict } from "./triage.ts";

/**
 * The opt-out sentence appended to every owner-facing message. Kept as one
 * constant so the filed A2P samples and the live traffic cannot drift apart.
 */
export const OPT_OUT = "Reply STOP to opt out.";

export type CallOutcome =
  | "lead_captured"
  | "caller_hung_up"
  | "spam_screened"
  | "transferred";

export interface CapturedLead {
  caller_name: string | null;
  callback_number: string | null;
  town: string | null;
  address: string | null;
  job_description: string | null;
  urgency_note: string | null;
}

export interface CallRecord {
  client_slug: string;
  call_id: string;
  from_number: string;
  started_at: Date;
  duration_seconds: number;
  outcome: CallOutcome;
  lead: CapturedLead;
  urgency: UrgencyVerdict;
  transcript_url: string | null;
}

/** Characters in the GSM-7 basic set. Anything else forces UCS-2. */
const GSM7_BASIC =
  "@\u00a3$\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7\n\u00d8\u00f8\r\u00c5\u00e5" +
  "\u0394_\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e\u00c6\u00e6\u00df\u00c9" +
  " !\"#\u00a4%&'()*+,-./0123456789:;<=>?" +
  "\u00a1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c4\u00d6\u00d1\u00dc\u00a7" +
  "\u00bfabcdefghijklmnopqrstuvwxyz\u00e4\u00f6\u00f1\u00fc\u00e0";

/** GSM-7 extended characters occupy two septets each. */
const GSM7_EXTENDED = "^{}\\[~]|\u20ac";

export function isGsm7(body: string): boolean {
  for (const character of body) {
    if (!GSM7_BASIC.includes(character) && !GSM7_EXTENDED.includes(character)) {
      return false;
    }
  }

  return true;
}

/**
 * Billable SMS segments.
 *
 * GSM-7 fits 160 characters in one segment and 153 in each concatenated part.
 * A single non-GSM-7 character (a curly quote, an em dash, an interpunct)
 * silently switches the whole message to UCS-2, which drops those limits to 70
 * and 67 — doubling the per-lead SMS cost. Keep owner alerts GSM-7 clean.
 */
export function smsSegments(body: string): number {
  if (!isGsm7(body)) {
    return body.length <= 70 ? 1 : Math.ceil(body.length / 67);
  }

  const septets = [...body].reduce(
    (total, character) => total + (GSM7_EXTENDED.includes(character) ? 2 : 1),
    0,
  );

  return septets <= 160 ? 1 : Math.ceil(septets / 153);
}

function formatPhone(e164: string | null): string {
  if (!e164) {
    return "no number";
  }

  const digits = e164.replace(/\D/g, "").slice(-10);

  if (digits.length !== 10) {
    return e164;
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}

function trimTo(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  // Three ASCII periods, never U+2026: one ellipsis character flips the whole
  // message to UCS-2 and triples its SMS cost.
  return `${text.slice(0, max - 3).trimEnd()}...`;
}

/**
 * The owner's alert text. Urgent calls lead with URGENT so it is legible from
 * a lock screen without opening anything.
 *
 * Every owner message carries the STOP opt-out. This is not optional polish:
 * the A2P campaign was filed with sample messages that end this way, and the
 * filing has to match what actually goes out. It still fits one GSM-7 segment,
 * so it costs nothing.
 */
export function buildOwnerSms(
  profile: ClientProfile,
  call: CallRecord,
): string {
  const time = formatTime(call.started_at, profile.timezone);
  const who = call.lead.caller_name ?? "Unknown caller";
  const number = formatPhone(call.lead.callback_number ?? call.from_number);
  const where = call.lead.town ?? call.lead.address;

  if (call.outcome === "caller_hung_up" && !call.lead.callback_number) {
    // No text-back claim here: caller text-backs are Campaign B, which is not
    // filed yet. The alert must never describe messaging we are not sending.
    return `Ringlatch: missed call ${time} from ${number}. ` +
      `Caller hung up before leaving details. ${OPT_OUT}`;
  }

  const lead = [
    call.urgency.level === "priority" ? "URGENT" : "New lead",
    `${who} ${number}`,
    where ? where : null,
    call.lead.job_description
      ? trimTo(call.lead.job_description, 90)
      : "no job details given",
    time,
  ]
    .filter(Boolean)
    .join(" - ");

  return `Ringlatch: ${lead}. ${OPT_OUT}`;
}

/**
 * Sent to a caller who dropped before the agent finished.
 *
 * This is an unsolicited first message to someone who never opted in, so the
 * opt-out has to ride along with it. Carriers filter A2P traffic that omits it
 * and the campaign registration is approved on the strength of this wording.
 * Do not trim the STOP line to save a segment.
 */
export function buildCallerTextBack(profile: ClientProfile): string {
  return `Sorry we missed you - this is ${
    spokenName(profile)
  }. Reply here with what you need and we'll get right back to you. Reply STOP to opt out.`;
}

/**
 * Sent once per period when a client crosses 80% of their minutes.
 *
 * The point is that nothing that happens later is a surprise. GSM-7 clean and
 * one segment, like every other alert.
 */
export function buildCapWarningSms(
  used: number,
  included: number,
): string {
  return `Ringlatch: you've used ${used} of your ${included} monthly minutes. ` +
    `When all your minutes are gone we take name and number only. ` +
    `${OPT_OUT}`;
}

/** Sent when a client is past the hard ceiling and calls stop being answered. */
export function buildCapReachedSms(included: number): string {
  return `Ringlatch: you're well past your ${included} monthly minutes, so ` +
    `answering is paused until they reset. Buy minutes at ` +
    `ainovations.net/ringlatch-minutes ${OPT_OUT}`;
}

/** Sent once when plan minutes run out and purchased minutes take over. */
export function buildPurchasedStartedSms(balanceMinutes: number): string {
  return `Ringlatch: this month's plan minutes are used, so we're answering ` +
    `on your purchased minutes - about ${balanceMinutes} left. ${OPT_OUT}`;
}

/** Sent once when plan AND purchased minutes are both gone. */
export function buildBalanceEmptySms(): string {
  return `Ringlatch: your plan and purchased minutes are used up, so we're ` +
    `taking name and number only. Buy more at ` +
    `ainovations.net/ringlatch-minutes ${OPT_OUT}`;
}

/** Sent to the owner when a business is added to their line. */
export function buildBusinessAddedSms(name: string): string {
  return `Ringlatch: ${name} was added to your line. Callers can now reach ` +
    `it at your Ringlatch number. ${OPT_OUT}`;
}

/** Receipt for a manually purchased minute pack. */
export function buildPackPurchasedSms(
  minutes: number,
  balanceMinutes: number,
): string {
  return `Ringlatch: ${minutes} minutes added. Your purchased balance is ` +
    `about ${balanceMinutes} minutes and rolls over until used. ${OPT_OUT}`;
}

/** Sent when an opted-in auto-refill purchase succeeds. */
export function buildAutoRefillSms(
  minutes: number,
  priceCents: number,
): string {
  return `Ringlatch: auto-refill added ${minutes} minutes for $${
    Math.round(priceCents / 100)
  }. Full answering stays on. ${OPT_OUT}`;
}

/** Sent when an opted-in auto-refill charge fails. */
export function buildAutoRefillFailedSms(): string {
  return `Ringlatch: your auto-refill payment didn't go through, so we're ` +
    `taking name and number only. Buy minutes at ` +
    `ainovations.net/ringlatch-minutes ${OPT_OUT}`;
}

export interface EmailSummary {
  subject: string;
  text: string;
}

export function buildOwnerEmail(
  profile: ClientProfile,
  call: CallRecord,
): EmailSummary {
  const urgent = call.urgency.level === "priority";
  const who = call.lead.caller_name ?? "Unknown caller";
  const time = formatTime(call.started_at, profile.timezone);

  const subject = urgent
    ? `URGENT lead — ${who} — ${time}`
    : call.outcome === "spam_screened"
    ? `Spam call screened — ${time}`
    : call.outcome === "caller_hung_up"
    ? `Missed call — ${formatPhone(call.from_number)} — ${time}`
    : `New lead — ${who} — ${time}`;

  const lines = [
    `${spokenName(profile)} — Ringlatch call summary`,
    "",
    `Time:      ${time}`,
    `From:      ${formatPhone(call.from_number)}`,
    `Length:    ${call.duration_seconds}s`,
    `Outcome:   ${call.outcome.replace(/_/g, " ")}`,
    "",
    "Lead",
    `  Name:     ${call.lead.caller_name ?? "—"}`,
    `  Callback: ${formatPhone(call.lead.callback_number)}`,
    `  Location: ${call.lead.address ?? call.lead.town ?? "—"}`,
    `  Job:      ${call.lead.job_description ?? "—"}`,
    `  Urgency:  ${call.lead.urgency_note ?? call.urgency.level}`,
  ];

  if (urgent) {
    lines.push(
      "",
      `Flagged urgent: ${call.urgency.matched.join(", ")}`,
      call.urgency.reason,
    );
  }

  // Background stays background: never hand a customer a vendor-hosted URL.
  // Transcripts are stored in our database and will surface through the
  // Ringlatch portal only. Anything not on our domain is dropped here.
  if (call.transcript_url?.startsWith("https://ainovations.net/")) {
    lines.push("", `Transcript: ${call.transcript_url}`);
  }

  // The cap SMS is filing-locked to the opt-out only, so the upgrade path
  // lives here where there is room for it. Minute packs are deliberately NOT
  // mentioned here: packs surface only in the run-out alerts, never as
  // standing marketing.
  lines.push(
    "",
    "Need more minutes? Reply to this email and we will move you up a plan.",
  );

  return { subject, text: lines.join("\n") };
}
