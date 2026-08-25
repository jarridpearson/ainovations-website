import { assert, assertEquals } from "jsr:@std/assert@^1";
import {
  billableSeconds,
  BRIEF_CALL_SECONDS_CAP,
  CLOSE_AT_MULTIPLE,
  decideCallMode,
  MINUTE_PACK,
  packEconomics,
  PER_CALL_SECONDS_CAP,
  PLANS,
  purchasedDrawSeconds,
  unitEconomics,
  worstCaseMargin,
} from "./limits.ts";

/**
 * The floor the business is built on. If a change to pricing, costs or caps
 * drops the worst reachable margin below this, that change is wrong.
 */
const MARGIN_FLOOR = 0.6;

Deno.test("no plan can be driven below the margin floor", () => {
  for (const plan of Object.values(PLANS)) {
    const margin = worstCaseMargin(plan);

    assert(
      margin >= MARGIN_FLOOR,
      `${plan.label} worst-case margin is ${(margin * 100).toFixed(1)}%`,
    );
  }
});

Deno.test("a runaway client costs no more than a capped one", () => {
  // This is the whole point of the cap. 10x usage must cost exactly the same
  // as the ceiling, or a single client can eat a month of profit.
  for (const plan of Object.values(PLANS)) {
    const ceiling = unitEconomics(
      plan,
      plan.included_minutes * CLOSE_AT_MULTIPLE,
    );
    const runaway = unitEconomics(plan, plan.included_minutes * 50);

    assertEquals(runaway.cost_cents, ceiling.cost_cents);
    assertEquals(runaway.gross_profit_cents, ceiling.gross_profit_cents);
    assert(
      runaway.gross_profit_cents > 0,
      "a runaway client must stay profitable",
    );
  }
});

Deno.test("usage escalates full -> brief -> closed", () => {
  const plan = PLANS.standard;
  const included = plan.included_minutes;

  assertEquals(decideCallMode(plan, 0).mode, "full");
  assertEquals(decideCallMode(plan, included - 1).mode, "full");
  assertEquals(decideCallMode(plan, included).mode, "brief");
  assertEquals(
    decideCallMode(plan, included * CLOSE_AT_MULTIPLE).mode,
    "closed",
  );
});

// ---------------------------------------------------------------------------
// Minute packs. Purchased minutes roll over, are consumed only after plan
// minutes, and keep FULL answering running past the plan allowance. The
// degrade ladder applies only once both are gone.
// ---------------------------------------------------------------------------

Deno.test("the minute pack clears the margin floor", () => {
  const economics = packEconomics();

  assert(
    economics.margin >= MARGIN_FLOOR,
    `pack margin is ${(economics.margin * 100).toFixed(1)}%`,
  );
});

Deno.test("pack pricing never undercuts the upgrade path", () => {
  // A pack minute must cost at least what a Busy plan minute costs, or a
  // Standard client stacking packs beats upgrading and cannibalises revenue.
  const packPerMinute = MINUTE_PACK.price_cents / MINUTE_PACK.minutes;
  const busyPerMinute = PLANS.busy.price_cents / PLANS.busy.included_minutes;

  assert(
    packPerMinute >= busyPerMinute,
    `pack ${packPerMinute}c/min undercuts Busy ${busyPerMinute}c/min`,
  );
});

Deno.test("purchased minutes keep full answering after the plan runs out", () => {
  const plan = PLANS.standard;
  const included = plan.included_minutes;

  assertEquals(decideCallMode(plan, included, 100).mode, "full");
  assertEquals(decideCallMode(plan, included * 2, 5).mode, "full");
});

Deno.test("with no purchased balance the ladder still degrades then closes", () => {
  const plan = PLANS.standard;
  const included = plan.included_minutes;

  assertEquals(decideCallMode(plan, included, 0).mode, "brief");
  assertEquals(
    decideCallMode(plan, included * CLOSE_AT_MULTIPLE, 0).mode,
    "closed",
  );
});

Deno.test("buying a pack past the hard ceiling reopens full service", () => {
  const plan = PLANS.standard;
  const pastCeiling = plan.included_minutes * CLOSE_AT_MULTIPLE + 50;

  assertEquals(decideCallMode(plan, pastCeiling, 0).mode, "closed");
  assertEquals(
    decideCallMode(plan, pastCeiling, MINUTE_PACK.minutes).mode,
    "full",
  );
});

Deno.test("auto-provisioned default profiles always parse", async () => {
  const { buildDefaultProfile } = await import("./provision.ts");
  const { parseProfile } = await import("./profile.ts");

  for (
    const [type, consent] of [
      ["plumbing contractor", true],
      ["dental office", false],
      ["hair salon", true],
      ["something nobody predicted", false],
    ] as [string, boolean][]
  ) {
    const profile = parseProfile(buildDefaultProfile({
      id: "test",
      business_name: "Test & Sons, LLC",
      business_type: type,
      contact_name: "Pat Test",
      owner_cell: "+13155550100",
      email: "pat@example.com",
      forwarding_number: "+13155550101",
      plan_key: "standard",
      sms_consent: consent,
      stripe_customer_id: null,
      stripe_subscription_id: null,
    }, "+13155550102"));

    // A no-consent client is email-only; a consenting one gets texts.
    assertEquals(profile.notify.sms_to.length, consent ? 1 : 0);
    assertEquals(profile.notify.email_to, ["pat@example.com"]);
    assertEquals(profile.phone.ringlatch, "+13155550102");
  }
});

Deno.test("a multi-business line asks callers which business they need", async () => {
  const { parseProfile } = await import("./profile.ts");
  const { buildGreeting, buildSystemPrompt } = await import("./prompt.ts");

  const raw = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../ringlatch-src/profiles/miller-plumbing.example.json",
        import.meta.url,
      ),
    ),
  );

  raw.businesses = [{ name: "Miller Property Care", business_type: "lawn care" }];
  const profile = parseProfile(raw);

  const greeting = buildGreeting(profile);
  assert(greeting.includes("which business"), greeting);
  assert(greeting.includes("Miller Property Care"), greeting);

  const prompt = buildSystemPrompt(profile);
  assert(prompt.includes("One line, several businesses"), "missing section");
  assert(prompt.includes("Miller Property Care (lawn care)"), "missing extra");
});

Deno.test("plan minutes are consumed before purchased minutes", () => {
  const included = 150;
  const includedSeconds = included * 60;

  // A call entirely inside the plan draws nothing from the balance.
  assertEquals(purchasedDrawSeconds(120, includedSeconds - 300, included), 0);

  // A call that straddles the boundary draws only the overflow.
  assertEquals(purchasedDrawSeconds(120, includedSeconds + 40, included), 40);

  // A call entirely past the plan draws its full billable time.
  assertEquals(purchasedDrawSeconds(120, includedSeconds + 700, included), 120);

  // The draw can never exceed the call itself.
  assertEquals(purchasedDrawSeconds(60, includedSeconds + 9999, included), 60);
});

Deno.test("the owner is warned before anything degrades", () => {
  const plan = PLANS.standard;

  // Warning must land while still in full mode, not at the moment of change.
  const warning = decideCallMode(plan, Math.ceil(plan.included_minutes * 0.8));

  assertEquals(warning.mode, "full");
  assertEquals(warning.warn_owner, true);
  assertEquals(decideCallMode(plan, 10).warn_owner, false);
});

Deno.test("brief mode still catches the lead, just cheaply", () => {
  const plan = PLANS.standard;
  const brief = decideCallMode(plan, plan.included_minutes);

  assertEquals(brief.mode, "brief");
  assertEquals(brief.seconds_cap, BRIEF_CALL_SECONDS_CAP);
  // Degrade, do not die: a capped call is still an answered call.
  assert(brief.seconds_cap > 0);
  assert(brief.seconds_cap < PER_CALL_SECONDS_CAP);
});

Deno.test("one stuck call cannot eat a month", () => {
  // A looping voice agent is a known failure mode. An 8-hour call bills the
  // per-call ceiling, not 8 hours.
  assertEquals(billableSeconds(8 * 60 * 60, false), PER_CALL_SECONDS_CAP);
  assertEquals(
    billableSeconds(8 * 60 * 60, false, "brief"),
    BRIEF_CALL_SECONDS_CAP,
  );
});

Deno.test("spam and closed calls never bill", () => {
  assertEquals(billableSeconds(120, true), 0);
  assertEquals(billableSeconds(120, false, "closed"), 0);
});

Deno.test("a normal call bills its real length", () => {
  assertEquals(billableSeconds(74, false), 74);
});

Deno.test("margin improves as usage falls", () => {
  const plan = PLANS.standard;

  const light = unitEconomics(plan, 30).margin;
  const heavy = unitEconomics(plan, plan.included_minutes).margin;

  assert(light > heavy);
  assert(light > 0.85, `light usage margin was ${(light * 100).toFixed(1)}%`);
});

// ---------------------------------------------------------------------------
// Cap notifications and the degraded prompts.
// ---------------------------------------------------------------------------

Deno.test("cap warnings are single-segment and GSM-7 clean", async () => {
  const {
    buildCapReachedSms,
    buildCapWarningSms,
    isGsm7,
    OPT_OUT,
    smsSegments,
  } = await import("./notify.ts");

  for (const body of [buildCapWarningSms(120, 150), buildCapReachedSms(150)]) {
    assert(isGsm7(body), `not GSM-7: ${body}`);
    assert(smsSegments(body) <= 2, `${smsSegments(body)} segments: ${body}`);
    // The filed A2P sample for this message ends in the opt-out and carries no
    // UPGRADE keyword. The upgrade path lives in the owner email and the portal
    // instead, so the SMS stays one segment and matches the campaign filing.
    assert(body.includes(OPT_OUT), `missing opt-out: ${body}`);
    assert(/minutes/i.test(body), "the owner needs to know why they got this");
  }
});

Deno.test("brief mode refuses to answer questions that cost minutes", async () => {
  const { parseProfile } = await import("./profile.ts");
  const { buildBriefPrompt, buildSystemPrompt } = await import("./prompt.ts");

  const profile = parseProfile(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../../ringlatch-src/profiles/miller-plumbing.example.json",
          import.meta.url,
        ),
      ),
    ),
  );

  const brief = buildBriefPrompt(profile);
  const full = buildSystemPrompt(profile);

  // Brief mode must not carry the FAQ or pricing payload — that is the cost.
  assert(
    !brief.includes("well pump service"),
    "brief mode leaked the service list",
  );
  assert(!brief.includes("$95"), "brief mode leaked pricing guidance");
  assert(
    brief.length < full.length / 2,
    "brief prompt is not meaningfully shorter",
  );

  // But it still does the one job that matters.
  assert(/callback number/i.test(brief), "brief mode must still take a number");
  assert(/911/.test(brief), "brief mode must still route danger to 911");
});

Deno.test("closed mode says one thing and stops", async () => {
  const { parseProfile } = await import("./profile.ts");
  const { buildClosedPrompt } = await import("./prompt.ts");

  const profile = parseProfile(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../../ringlatch-src/profiles/miller-plumbing.example.json",
          import.meta.url,
        ),
      ),
    ),
  );

  const closed = buildClosedPrompt(profile);

  assert(/end the call/i.test(closed));
  assert(
    /text/i.test(closed),
    "the caller must still be told a text is coming",
  );
  assert(!/callback number/i.test(closed), "closed mode should not interview");
});

// ---------------------------------------------------------------------------
// A2P filing parity. The campaign was registered with sample messages that all
// end in the opt-out. If live traffic stops matching the filing, the campaign
// is misrepresented — so this is enforced, not documented.
// ---------------------------------------------------------------------------

Deno.test("every owner-facing message carries the STOP opt-out", async () => {
  const { parseProfile } = await import("./profile.ts");
  const {
    buildAutoRefillFailedSms,
    buildAutoRefillSms,
    buildBalanceEmptySms,
    buildBusinessAddedSms,
    buildCallerTextBack,
    buildCapReachedSms,
    buildCapWarningSms,
    buildOwnerSms,
    buildPackPurchasedSms,
    buildPurchasedStartedSms,
    isGsm7,
    OPT_OUT,
    smsSegments,
  } = await import("./notify.ts");
  const { classifyUrgency } = await import("./triage.ts");

  const profile = parseProfile(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../../ringlatch-src/profiles/miller-plumbing.example.json",
          import.meta.url,
        ),
      ),
    ),
  );

  const at = new Date("2026-08-18T14:30:00Z");
  const urgency = classifyUrgency(profile, "no heat", at);

  const lead = {
    caller_name: "Dave Hollenbeck",
    callback_number: "+13155551234",
    town: "Sandy Creek",
    address: null,
    job_description: "Furnace quit this afternoon, no heat",
    urgency_note: "tonight",
  };

  const captured = buildOwnerSms(profile, {
    client_slug: profile.slug,
    call_id: "a2p-1",
    from_number: "+13155551234",
    started_at: at,
    duration_seconds: 74,
    outcome: "lead_captured",
    lead,
    urgency,
    transcript_url: null,
  });

  const hungUp = buildOwnerSms(profile, {
    client_slug: profile.slug,
    call_id: "a2p-2",
    from_number: "+13155559876",
    started_at: at,
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
    urgency: classifyUrgency(profile, "", at),
    transcript_url: null,
  });

  // A rambling job description must be trimmed with ASCII only: one U+2026
  // ellipsis would flip the whole alert to UCS-2 and triple its cost.
  const longJob = buildOwnerSms(profile, {
    client_slug: profile.slug,
    call_id: "a2p-3",
    from_number: "+13155551234",
    started_at: at,
    duration_seconds: 96,
    outcome: "lead_captured",
    lead: {
      ...lead,
      job_description:
        "Furnace stopped overnight and the pilot will not relight, " +
        "smells faintly of gas near the utility room, two small kids in the " +
        "house so they want someone out as soon as humanly possible today",
    },
    urgency,
    transcript_url: null,
  });

  const messages = [
    captured,
    hungUp,
    longJob,
    buildCapWarningSms(120, 150),
    buildCapReachedSms(150),
    buildCallerTextBack(profile),
    buildPurchasedStartedSms(85),
    buildBalanceEmptySms(),
    buildAutoRefillSms(100, 7900),
    buildAutoRefillFailedSms(),
    buildPackPurchasedSms(100, 130),
    buildBusinessAddedSms("Everward Counseling"),
  ];

  for (const body of messages) {
    assert(body.includes(OPT_OUT), `missing opt-out: ${body}`);
    assert(isGsm7(body), `not GSM-7, would bill as UCS-2: ${body}`);
    assert(
      smsSegments(body) <= 2,
      `${smsSegments(body)} segments (${body.length} chars): ${body}`,
    );
  }

  // The urgent alert is the one people actually read; keep it to one segment.
  assertEquals(smsSegments(captured), 1);
});

Deno.test("no vendor name or vendor URL can reach a customer", async () => {
  const { parseProfile } = await import("./profile.ts");
  const {
    buildAutoRefillFailedSms,
    buildAutoRefillSms,
    buildBalanceEmptySms,
    buildBusinessAddedSms,
    buildCallerTextBack,
    buildCapReachedSms,
    buildCapWarningSms,
    buildOwnerEmail,
    buildOwnerSms,
    buildPackPurchasedSms,
    buildPurchasedStartedSms,
  } = await import("./notify.ts");
  const { buildBriefPrompt, buildClosedPrompt, buildSystemPrompt } =
    await import("./prompt.ts");
  const { classifyUrgency } = await import("./triage.ts");

  const profile = parseProfile(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../../ringlatch-src/profiles/miller-plumbing.example.json",
          import.meta.url,
        ),
      ),
    ),
  );

  const at = new Date("2026-08-18T14:30:00Z");
  const record = {
    client_slug: profile.slug,
    call_id: "vendor-leak-check",
    from_number: "+13155551234",
    started_at: at,
    duration_seconds: 74,
    outcome: "lead_captured" as const,
    lead: {
      caller_name: "Dave",
      callback_number: "+13155551234",
      town: "Sandy Creek",
      address: null,
      job_description: "no heat",
      urgency_note: null,
    },
    urgency: classifyUrgency(profile, "no heat", at),
    // Deliberately a vendor-hosted URL: it must be swallowed, never forwarded.
    transcript_url: "https://dashboard.retellai.com/public-log/abc123",
  };

  const email = buildOwnerEmail(profile, record);
  const surfaces = [
    email.subject,
    email.text,
    buildOwnerSms(profile, record),
    buildCapWarningSms(120, 150),
    buildCapReachedSms(150),
    buildCallerTextBack(profile),
    buildPurchasedStartedSms(85),
    buildBalanceEmptySms(),
    buildAutoRefillSms(100, 7900),
    buildAutoRefillFailedSms(),
    buildPackPurchasedSms(100, 130),
    buildBusinessAddedSms("Everward Counseling"),
    buildSystemPrompt(profile),
    buildBriefPrompt(profile),
    buildClosedPrompt(profile),
  ];

  for (const text of surfaces) {
    for (
      const vendor of [
        "retell",
        "twilio",
        "supabase",
        "elevenlabs",
        "11labs",
        "netlify",
      ]
    ) {
      assert(
        !text.toLowerCase().includes(vendor),
        `vendor "${vendor}" leaked into customer-facing text: ${
          text.slice(0, 120)
        }`,
      );
    }
  }
});
