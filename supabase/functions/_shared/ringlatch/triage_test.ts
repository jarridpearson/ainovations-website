import { assert, assertEquals, assertThrows } from "jsr:@std/assert@^1";
import { parseProfile, ProfileError } from "./profile.ts";
import { classifyUrgency, isOpenAt, screenForSpam } from "./triage.ts";
import { buildOwnerSms, smsSegments } from "./notify.ts";
import type { CallRecord } from "./notify.ts";

const raw = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../../../ringlatch-src/profiles/miller-plumbing.example.json",
      import.meta.url,
    ),
  ),
);

const profile = parseProfile(raw);

// Tuesday 2026-08-18, 10:30 and 22:30 America/New_York.
const duringHours = new Date("2026-08-18T14:30:00Z");
const afterHours = new Date("2026-08-19T02:30:00Z");

Deno.test("example profile validates", () => {
  assertEquals(profile.slug, "miller-plumbing");
  assertEquals(profile.coverage_mode, "missed_call");
});

Deno.test("profile rejects a non-E.164 owner cell", () => {
  assertThrows(
    () =>
      parseProfile({
        ...raw,
        phone: { ...raw.phone, owner_cell: "315-555-0119" },
      }),
    ProfileError,
    "phone.owner_cell",
  );
});

Deno.test("profile rejects hours that close before they open", () => {
  assertThrows(
    () =>
      parseProfile({
        ...raw,
        hours: { ...raw.hours, monday: { open: "17:00", close: "07:00" } },
      }),
    ProfileError,
    "closes before it opens",
  );
});

Deno.test("business hours respect the client timezone", () => {
  assert(isOpenAt(profile, duringHours), "Tuesday 10:30am should be open");
  assert(!isOpenAt(profile, afterHours), "Tuesday 10:30pm should be closed");
  // Sunday is null in the profile.
  assert(!isOpenAt(profile, new Date("2026-08-23T15:00:00Z")));
});

Deno.test("spam screen catches known robocall scripts", () => {
  const verdict = screenForSpam([
    "This is a final notice regarding your vehicle's extended warranty.",
  ]);

  assert(verdict.is_spam);
  assert(verdict.confidence > 0.9);
});

Deno.test("spam screen catches a silent open", () => {
  assert(screenForSpam([]).is_spam);
  assert(screenForSpam(["   "]).is_spam);
});

Deno.test("spam screen does not flag a real customer", () => {
  const verdict = screenForSpam([
    "Hi, yeah, my water heater is leaking all over the basement floor.",
  ]);

  assertEquals(verdict.is_spam, false);
});

Deno.test("a real customer mentioning warranty is not spam", () => {
  const verdict = screenForSpam([
    "My furnace is still under warranty, can you guys look at it?",
  ]);

  assertEquals(verdict.is_spam, false);
});

Deno.test("urgent calls trigger transfer during hours", () => {
  const verdict = classifyUrgency(
    profile,
    "We've got no heat at all and the baby's here",
    duringHours,
  );

  assertEquals(verdict.level, "priority");
  assert(verdict.should_transfer);
  assert(verdict.matched.includes("no heat"));
});

Deno.test("client-specific keywords are honored", () => {
  const verdict = classifyUrgency(
    profile,
    "The well pump out back finally quit on us",
    duringHours,
  );

  assertEquals(verdict.level, "priority");
  assert(verdict.matched.includes("well pump out"));
});

Deno.test("after-hours urgent call still transfers when configured", () => {
  const verdict = classifyUrgency(
    profile,
    "burst pipe in the wall",
    afterHours,
  );

  assertEquals(verdict.level, "priority");
  assert(verdict.should_transfer);
});

Deno.test("after-hours urgent call only alerts when transfer is off", () => {
  const quiet = parseProfile({
    ...raw,
    urgency: { ...raw.urgency, transfer_after_hours: false },
  });

  const verdict = classifyUrgency(quiet, "burst pipe in the wall", afterHours);

  assertEquals(verdict.level, "priority");
  assertEquals(verdict.should_transfer, false);
});

Deno.test("routine work is not escalated", () => {
  const verdict = classifyUrgency(
    profile,
    "I'd like a quote on a new bathroom faucet whenever you get a chance",
    duringHours,
  );

  assertEquals(verdict.level, "routine");
  assertEquals(verdict.should_transfer, false);
});

Deno.test("owner SMS stays inside two segments", () => {
  const call: CallRecord = {
    client_slug: profile.slug,
    call_id: "test",
    from_number: "+13155551234",
    started_at: duringHours,
    duration_seconds: 74,
    outcome: "lead_captured",
    lead: {
      caller_name: "Dave Hollenbeck",
      callback_number: "+13155551234",
      town: "Sandy Creek",
      address: "441 County Route 15, Sandy Creek",
      job_description:
        "Water heater is leaking onto the basement floor and the pilot won't stay lit",
      urgency_note: "wants someone today",
    },
    urgency: classifyUrgency(profile, "water heater leaking", duringHours),
    transcript_url: null,
  };

  const sms = buildOwnerSms(profile, call);

  assert(sms.startsWith("Ringlatch: URGENT"), sms);
  assert(sms.includes("315-555-1234"));
  assert(smsSegments(sms) <= 2, `SMS was ${sms.length} chars: ${sms}`);
});

Deno.test("hang-up with no details still tells the owner something useful", () => {
  const call: CallRecord = {
    client_slug: profile.slug,
    call_id: "test-2",
    from_number: "+13155559876",
    started_at: duringHours,
    duration_seconds: 4,
    outcome: "caller_hung_up",
    lead: {
      caller_name: null,
      callback_number: null,
      town: null,
      address: null,
      job_description: null,
      urgency_note: null,
    },
    urgency: classifyUrgency(profile, "", duringHours),
    transcript_url: null,
  };

  const sms = buildOwnerSms(profile, call);

  assert(sms.includes("315-555-9876"));
  // Must NOT claim a text-back: that traffic is Campaign B and is not sent yet.
  assert(!sms.includes("texted them back"), sms);
  assert(sms.includes("hung up before leaving details"), sms);
  assert(smsSegments(sms) <= 2);
});

Deno.test("hang-up email is not subject-lined as a captured lead", async () => {
  const { buildOwnerEmail } = await import("./notify.ts");

  const call: CallRecord = {
    client_slug: profile.slug,
    call_id: "test-3",
    from_number: "+13155559876",
    started_at: duringHours,
    duration_seconds: 4,
    outcome: "caller_hung_up",
    lead: {
      caller_name: null,
      callback_number: null,
      town: null,
      address: null,
      job_description: null,
      urgency_note: null,
    },
    urgency: classifyUrgency(profile, "", duringHours),
    transcript_url: null,
  };

  const email = buildOwnerEmail(profile, call);

  assert(email.subject.startsWith("Missed call"), email.subject);
  assert(!email.subject.includes("New lead"));
});

Deno.test("phone-frame wrapping never exceeds the column width", async () => {
  const { wrapText } = await import("../../../../ringlatch-src/simulate.ts");

  const samples = [
    "Ringlatch: URGENT · Dave Hollenbeck 315-555-1234 · Sandy Creek · Furnace quit",
    "short",
    "averyveryverylongsinglewordthatcannotbewrappedatallbyanyreasonablealgorithm",
  ];

  for (const sample of samples) {
    const rows = wrapText(sample, 48);

    assertEquals(
      rows.join(" ").replace(/\s+/g, " "),
      sample.replace(/\s+/g, " "),
    );

    for (const row of rows.slice(0, -1)) {
      assert(row.length <= 48, `row too wide (${row.length}): ${row}`);
    }
  }
});

Deno.test("outbound SMS bodies stay GSM-7 so they bill as single segments", async () => {
  const { buildCallerTextBack, isGsm7, smsSegments } = await import(
    "./notify.ts"
  );

  const call: CallRecord = {
    client_slug: profile.slug,
    call_id: "test-4",
    from_number: "+13155551234",
    started_at: duringHours,
    duration_seconds: 74,
    outcome: "lead_captured",
    lead: {
      caller_name: "Dave Hollenbeck",
      callback_number: "+13155551234",
      town: "Sandy Creek",
      address: null,
      job_description: "Water heater leaking onto the basement floor",
      urgency_note: "today",
    },
    urgency: classifyUrgency(profile, "water heater leaking", duringHours),
    transcript_url: null,
  };

  for (
    const body of [buildOwnerSms(profile, call), buildCallerTextBack(profile)]
  ) {
    assert(isGsm7(body), `not GSM-7, will bill as UCS-2: ${body}`);
    assert(smsSegments(body) <= 2, `${smsSegments(body)} segments: ${body}`);
  }
});

Deno.test("segment math reflects the UCS-2 cliff", async () => {
  const { isGsm7, smsSegments } = await import("./notify.ts");

  assertEquals(smsSegments("a".repeat(160)), 1);
  assertEquals(smsSegments("a".repeat(161)), 2);

  // One em dash drops the ceiling from 160 to 70.
  assertEquals(isGsm7("a".repeat(159) + "—"), false);
  assertEquals(smsSegments("a".repeat(159) + "—"), 3);

  // Extended-set characters cost two septets each.
  assertEquals(smsSegments("€".repeat(80)), 1);
  assertEquals(smsSegments("€".repeat(81)), 2);
});

Deno.test("caller text-back carries opt-out language for A2P compliance", async () => {
  const { buildCallerTextBack, isGsm7, smsSegments } = await import(
    "./notify.ts"
  );

  const body = buildCallerTextBack(profile);

  assert(/reply stop/i.test(body), `missing STOP opt-out: ${body}`);
  assert(isGsm7(body));
  assert(smsSegments(body) <= 2, `${smsSegments(body)} segments: ${body}`);
});

// ---------------------------------------------------------------------------
// Vertical neutrality: the same engine has to serve non-trade businesses.
// ---------------------------------------------------------------------------

const dentalRaw = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../../../ringlatch-src/profiles/lakeside-dental.example.json",
      import.meta.url,
    ),
  ),
);

const dental = parseProfile(dentalRaw);

Deno.test("VALID_PACKS stays in sync with URGENCY_PACKS", async () => {
  const { URGENCY_PACK_KEYS } = await import("./triage.ts");

  // profile.ts duplicates this list to avoid an import cycle, so drift between
  // the two would silently reject a pack that actually exists.
  for (const pack of URGENCY_PACK_KEYS) {
    const accepted = parseProfile({
      ...raw,
      urgency: { ...raw.urgency, packs: [pack] },
    });
    assertEquals(accepted.urgency.packs, [pack]);
  }
});

Deno.test("an unknown pack fails loudly at onboarding", () => {
  assertThrows(
    () =>
      parseProfile({
        ...raw,
        urgency: { ...raw.urgency, packs: ["plumbers"] },
      }),
    ProfileError,
    "unknown pack",
  );
});

Deno.test("a dental office gets clinic triggers, not trade ones", async () => {
  const { urgencyKeywords } = await import("./triage.ts");

  const keywords = urgencyKeywords(dental);

  assert(keywords.includes("severe pain"), "missing clinic trigger");
  assert(keywords.includes("abscess"), "missing client-specific trigger");
  assert(
    !keywords.includes("burst pipe"),
    "leaked a trades trigger into a clinic",
  );
  // The general pack applies to every business.
  assert(keywords.includes("emergency"));
});

Deno.test("a dental urgency is detected and respects no-transfer config", () => {
  const verdict = classifyUrgency(
    dental,
    "My daughter knocked out a tooth at practice and it's bleeding",
    duringHours,
  );

  assertEquals(verdict.level, "priority");
  // This office chose alert-only; nobody's cell should ring.
  assertEquals(verdict.should_transfer, false);
});

Deno.test("a trades emergency does not fire for a dental office", () => {
  const verdict = classifyUrgency(dental, "there is a burst pipe", duringHours);

  assertEquals(verdict.level, "routine");
});

Deno.test("urgency routing can be switched off entirely", () => {
  const salon = parseProfile({
    ...raw,
    urgency: { enabled: false, packs: [], keywords: [] },
  });

  const verdict = classifyUrgency(salon, "this is an emergency", duringHours);

  assertEquals(verdict.level, "routine");
  assertEquals(verdict.should_transfer, false);
});

Deno.test("the rendered prompt describes the business type, not a trade", async () => {
  const { buildSystemPrompt } = await import("./prompt.ts");

  const prompt = buildSystemPrompt(dental);

  assert(prompt.includes("family dental office"), "business type missing");
  assert(prompt.includes("call 911"), "safety routing missing");
  assert(!prompt.includes("technician"), "trade-specific wording leaked in");
});

// ---------------------------------------------------------------------------
// Remote onboarding: with setup done entirely by phone, these instructions are
// the product. A wrong or half-rendered code is a failed onboarding.
// ---------------------------------------------------------------------------

Deno.test("forwarding scripts never leak an unsubstituted placeholder", async () => {
  const { CARRIERS, forwardingScript } = await import("./forwarding.ts");

  for (const key of Object.keys(CARRIERS) as (keyof typeof CARRIERS)[]) {
    for (const line of forwardingScript(key, "+13155550188")) {
      assert(
        !line.includes("{number}"),
        `unsubstituted placeholder in ${key}: ${line}`,
      );
    }
  }
});

Deno.test("every dial-code line type has an enable and a disable path", async () => {
  const { CARRIERS, forwardingScript } = await import("./forwarding.ts");

  for (const entry of Object.values(CARRIERS)) {
    if (entry.portal_only) {
      assertEquals(entry.enable.length, 0);
      continue;
    }

    assert(entry.enable.length > 0, `${entry.key} has no enable code`);
    assert(entry.disable.length > 0, `${entry.key} has no disable code`);
    assert(
      forwardingScript(entry.key, "+13155550188").join(" ").includes(
        "3155550188",
      ),
      `${entry.key} omits the number`,
    );
  }
});

Deno.test("no line type is configured with unconditional forwarding", async () => {
  const { CARRIERS } = await import("./forwarding.ts");

  // *72 forwards every call and stops the owner's own phone from ringing,
  // which breaks the entire "your number does not change" promise.
  for (const entry of Object.values(CARRIERS)) {
    for (const step of entry.enable) {
      assert(
        !step.code.startsWith("*72"),
        `${entry.key} uses unconditional *72`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Landlines. A cell sets busy and no-answer with one code; a landline needs
// two, and a landline keypad has no "+" key. Both mistakes silently lose calls.
// ---------------------------------------------------------------------------

Deno.test("landlines require BOTH a busy and a no-answer code", async () => {
  const { CARRIERS } = await import("./forwarding.ts");

  for (const key of ["landline", "cable_voip"] as const) {
    const entry = CARRIERS[key];
    const purposes = entry.enable.map((step) => step.purpose).join(" ");

    assertEquals(
      entry.enable.length,
      2,
      `${key} must set busy AND no-answer separately`,
    );
    assert(purposes.includes("busy"), `${key} missing the busy case`);
    assert(
      purposes.includes("nobody answers"),
      `${key} missing the no-answer case`,
    );
    assertEquals(entry.disable.length, 2, `${key} must be fully reversible`);
  }
});

Deno.test("landline instructions never tell someone to key a + sign", async () => {
  const { CARRIERS, forwardingScript } = await import("./forwarding.ts");

  for (const entry of Object.values(CARRIERS)) {
    if (entry.line_type === "mobile") {
      continue;
    }

    // Only the dial lines matter; the notes legitimately mention "+1" to warn
    // the owner off it.
    const dialLines = forwardingScript(entry.key, "+13155550188")
      .filter((line) => /^\s*Turn (on|off):/.test(line));

    for (const line of dialLines) {
      assert(
        !line.includes("+1"),
        `${entry.key} tells a landline caller to dial "+1": ${line}`,
      );
    }
  }
});

Deno.test("number formatting matches the keypad it will be typed on", async () => {
  const { formatForDialing } = await import("./forwarding.ts");

  assertEquals(formatForDialing("+13155550188", "e164"), "+13155550188");
  assertEquals(formatForDialing("+13155550188", "one_plus_ten"), "13155550188");
  assertEquals(formatForDialing("+13155550188", "ten_digit"), "3155550188");
  // Already-messy input still normalizes.
  assertEquals(
    formatForDialing("(315) 555-0188", "one_plus_ten"),
    "13155550188",
  );
});

Deno.test("dial links are only offered where the OS will honor them", async () => {
  const { dialLinks } = await import("./forwarding.ts");

  // Verizon's *71 has no "#", so it loads into the dialer on one tap.
  const verizon = dialLinks("verizon", "+13155550188");
  assertEquals(verizon.length, 1);
  assertEquals(verizon[0].one_tap, true);
  assertEquals(verizon[0].href, "tel:*71+13155550188");

  // AT&T's code ends in "#": an MMI code the OS blocks from web links.
  const att = dialLinks("att", "+13155550188");
  assertEquals(att[0].one_tap, false);
  assertEquals(att[0].href, null);

  // A landline gets two tappable links, both with plain digits.
  const landline = dialLinks("landline", "+13155550188");
  assertEquals(landline.length, 2);
  assert(landline.every((step) => step.one_tap), "landline codes have no #");
  assertEquals(landline[0].href, "tel:*9013155550188");
  assertEquals(landline[1].href, "tel:*9213155550188");

  // Hosted VoIP has no codes at all.
  assertEquals(dialLinks("hosted_voip", "+13155550188").length, 0);
});
