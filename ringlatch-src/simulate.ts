#!/usr/bin/env -S deno run --allow-read
/**
 * Ringlatch call simulator.
 *
 * Runs whole calls through the real pipeline — the same triage, prompt and
 * notification code the edge function uses — with no Retell, Twilio, Supabase
 * or API keys involved. Nothing here is a mock of the logic; only the network
 * is absent.
 *
 *   deno run --allow-read ringlatch/simulate.ts
 *   deno run --allow-read ringlatch/simulate.ts emergency
 *   deno run --allow-read ringlatch/simulate.ts --prompt
 */

import {
  type ClientProfile,
  parseProfile,
  spokenName,
} from "../supabase/functions/_shared/ringlatch/profile.ts";
import {
  buildGreeting,
  buildSystemPrompt,
} from "../supabase/functions/_shared/ringlatch/prompt.ts";
import {
  BRIEF_CALL_SECONDS_CAP,
  decideCallMode,
  PLANS,
  unitEconomics,
  worstCaseMargin,
} from "../supabase/functions/_shared/ringlatch/limits.ts";
import {
  type CarrierKey,
  CARRIERS,
  forwardingScript,
  VERIFICATION_STEPS,
} from "../supabase/functions/_shared/ringlatch/forwarding.ts";
import {
  classifyUrgency,
  isOpenAt,
  screenForSpam,
} from "../supabase/functions/_shared/ringlatch/triage.ts";
import {
  buildCallerTextBack,
  buildOwnerEmail,
  buildOwnerSms,
  type CallOutcome,
  type CallRecord,
  type CapturedLead,
  smsSegments,
} from "../supabase/functions/_shared/ringlatch/notify.ts";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

type Turn = { who: "caller" | "agent"; text: string };

interface Scenario {
  key: string;
  title: string;
  profile?: ClientProfile;
  from: string;
  at: Date;
  hung_up: boolean;
  turns: Turn[];
  lead: CapturedLead;
}

async function loadProfile(file: string): Promise<ClientProfile> {
  return parseProfile(
    JSON.parse(
      await Deno.readTextFile(new URL(`./profiles/${file}`, import.meta.url)),
    ),
  );
}

const profile = await loadProfile("miller-plumbing.example.json");
const dental = await loadProfile("lakeside-dental.example.json");

const greeting = buildGreeting(profile);
const dentalGreeting = buildGreeting(dental);

const SCENARIOS: Scenario[] = [
  {
    key: "emergency",
    title: "No heat, 9:40pm on a Tuesday",
    from: "+13155551234",
    at: new Date("2026-02-11T02:40:00Z"),
    hung_up: false,
    turns: [
      { who: "agent", text: greeting },
      {
        who: "caller",
        text:
          "Yeah, hi — we got no heat at all, furnace quit sometime this afternoon. It's supposed to go down to four tonight.",
      },
      {
        who: "agent",
        text:
          "That sounds like it can't wait — let me get you to someone now. While I'm trying, can I get your name?",
      },
      { who: "caller", text: "Dave Hollenbeck, over in Sandy Creek." },
      {
        who: "agent",
        text: "Thanks Dave. Best number to reach you if we get cut off?",
      },
      {
        who: "caller",
        text: "Three one five, five five five, one two three four.",
      },
      {
        who: "agent",
        text:
          "315-555-1234, got it. I couldn't reach him this second, but I've flagged this as urgent and it's on his phone right now.",
      },
    ],
    lead: {
      caller_name: "Dave Hollenbeck",
      callback_number: "+13155551234",
      town: "Sandy Creek",
      address: null,
      job_description: "Furnace quit this afternoon, no heat, low of 4 tonight",
      urgency_note: "No heat overnight in single digits",
    },
  },
  {
    key: "routine",
    title: "Quote request, mid-morning",
    from: "+13155557781",
    at: new Date("2026-08-18T14:20:00Z"),
    hung_up: false,
    turns: [
      { who: "agent", text: greeting },
      {
        who: "caller",
        text:
          "Hi, I'm looking to get a price on replacing the kitchen faucet and maybe the shutoffs under the sink.",
      },
      {
        who: "agent",
        text:
          "Happy to get that to him. Pricing depends on the job, so he'll go over it when he calls back. Can I get your name?",
      },
      { who: "caller", text: "Sure, it's Karen Mowry, I'm in Parish." },
      { who: "caller", text: "Number's 315-555-7781." },
      {
        who: "agent",
        text:
          "315-555-7781. Got it — I'll get this to Miller Plumbing right now and they'll call you back.",
      },
    ],
    lead: {
      caller_name: "Karen Mowry",
      callback_number: "+13155557781",
      town: "Parish",
      address: null,
      job_description:
        "Kitchen faucet replacement plus shutoff valves under sink",
      urgency_note: "No rush",
    },
  },
  {
    key: "hangup",
    title: "Caller gives up after four seconds",
    from: "+13155559876",
    at: new Date("2026-08-18T18:05:00Z"),
    hung_up: true,
    turns: [
      { who: "agent", text: greeting },
      { who: "caller", text: "...uh." },
    ],
    lead: {
      caller_name: null,
      callback_number: null,
      town: null,
      address: null,
      job_description: null,
      urgency_note: null,
    },
  },
  {
    key: "dental",
    title: "Dental office, chipped tooth mid-morning",
    profile: dental,
    from: "+13155553390",
    at: new Date("2026-08-18T14:50:00Z"),
    hung_up: false,
    turns: [
      { who: "agent", text: dentalGreeting },
      {
        who: "caller",
        text:
          "Hi — my son chipped a tooth at practice last night and he's in a lot of pain this morning.",
      },
      {
        who: "agent",
        text:
          "That sounds like it can't wait — I'm flagging this as urgent right now. Can I get your name?",
      },
      { who: "caller", text: "Angela Fowler. We're patients there already." },
      { who: "agent", text: "Thanks Angela. Best number to reach you?" },
      { who: "caller", text: "315-555-3390." },
      {
        who: "agent",
        text:
          "315-555-3390, got it. I'll get this to the front desk right now and they'll call you back.",
      },
    ],
    lead: {
      caller_name: "Angela Fowler",
      callback_number: "+13155553390",
      town: null,
      address: null,
      job_description: "Son chipped a tooth at practice, in a lot of pain",
      urgency_note: "Existing patient, wants to be seen today",
    },
  },
  {
    key: "spam",
    title: "Robocall at 2:14pm",
    from: "+18885550100",
    at: new Date("2026-08-18T18:14:00Z"),
    hung_up: false,
    turns: [
      { who: "agent", text: greeting },
      {
        who: "caller",
        text:
          "This is a final notice regarding your vehicle's extended warranty. Press one to speak with a specialist.",
      },
    ],
    lead: {
      caller_name: null,
      callback_number: null,
      town: null,
      address: null,
      job_description: null,
      urgency_note: null,
    },
  },
];

/** Wraps text to a fixed column width, the way a phone bubble would. */
export function wrapText(text: string, columns: number): string[] {
  const rows: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= columns) {
      current = `${current} ${word}`;
    } else {
      rows.push(current);
      current = word;
    }
  }

  if (current !== "") {
    rows.push(current);
  }

  return rows;
}

const FRAME_WIDTH = 52;
/** Two spaces of padding on each side of the text. */
const FRAME_COLUMNS = FRAME_WIDTH - 4;

function frameRow(text: string): string {
  return `${DIM}    │${RESET}  ${text.padEnd(FRAME_COLUMNS)}  ${DIM}│${RESET}`;
}

function phoneFrame(lines: string[], header: string): string {
  const out: string[] = [];

  out.push(`${DIM}    ┌${"─".repeat(FRAME_WIDTH)}┐${RESET}`);
  out.push(
    `${DIM}    │${RESET}  ${BOLD}${
      header.padEnd(FRAME_COLUMNS)
    }${RESET}  ${DIM}│${RESET}`,
  );
  out.push(`${DIM}    ├${"─".repeat(FRAME_WIDTH)}┤${RESET}`);

  for (const line of lines) {
    for (const row of wrapText(line, FRAME_COLUMNS)) {
      out.push(frameRow(row));
    }
  }

  out.push(`${DIM}    └${"─".repeat(FRAME_WIDTH)}┘${RESET}`);

  return out.join("\n");
}

function runScenario(scenario: Scenario) {
  const active = scenario.profile ?? profile;
  const callerText = scenario.turns
    .filter((turn) => turn.who === "caller")
    .map((turn) => turn.text);

  const durationSeconds = scenario.hung_up
    ? 4
    : Math.max(20, scenario.turns.length * 11);

  const spam = screenForSpam(callerText.slice(0, 2));
  const urgency = classifyUrgency(active, callerText.join(" "), scenario.at);
  const open = isOpenAt(active, scenario.at);

  const outcome: CallOutcome = spam.is_spam
    ? "spam_screened"
    : scenario.hung_up && !scenario.lead.callback_number
    ? "caller_hung_up"
    : "lead_captured";

  const record: CallRecord = {
    client_slug: active.slug,
    call_id: `sim_${scenario.key}`,
    from_number: scenario.from,
    started_at: scenario.at,
    duration_seconds: durationSeconds,
    outcome,
    lead: scenario.lead,
    urgency,
    transcript_url: null,
  };

  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: active.timezone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(scenario.at);

  console.log(
    `\n${BOLD}${CYAN}━━ ${scenario.title}${RESET}  ${DIM}${
      spokenName(active)
    } · ${localTime} · ${open ? "open" : "closed"}${RESET}\n`,
  );

  for (const turn of scenario.turns) {
    const label = turn.who === "agent"
      ? `${CYAN}Ringlatch${RESET}`
      : `${BOLD}Caller${RESET}   `;
    console.log(`  ${label}  ${turn.text}`);
  }

  console.log(`\n  ${DIM}── pipeline ──${RESET}`);
  console.log(
    `  spam screen   ${
      spam.is_spam
        ? `${RED}BLOCKED${RESET} ${DIM}(${spam.reason})${RESET}`
        : `${GREEN}pass${RESET}`
    }`,
  );

  if (spam.is_spam) {
    console.log(
      `  billing       ${GREEN}0s billable${RESET} ${DIM}(${durationSeconds}s not charged to the client)${RESET}`,
    );
    console.log(
      `  owner         ${DIM}not notified — this never reaches them${RESET}`,
    );
    return;
  }

  console.log(
    `  urgency       ${
      urgency.level === "priority"
        ? `${RED}URGENT${RESET} ${DIM}(${urgency.matched.join(", ")})${RESET}`
        : `${DIM}routine${RESET}`
    }`,
  );
  console.log(
    `  transfer      ${
      urgency.should_transfer
        ? `${YELLOW}ringing owner's cell${RESET}`
        : `${DIM}not attempted${RESET}`
    } ${DIM}— ${urgency.reason}${RESET}`,
  );
  console.log(`  outcome       ${outcome.replace(/_/g, " ")}`);
  console.log(`  billable      ${durationSeconds}s`);

  const sms = buildOwnerSms(active, record);

  console.log(
    `\n${phoneFrame([sms], `Owner's phone — ${active.phone.owner_cell}`)}`,
  );
  console.log(
    `    ${DIM}${sms.length} chars · ${
      smsSegments(sms)
    } SMS segment(s)${RESET}`,
  );

  if (outcome === "caller_hung_up") {
    console.log(
      `\n${
        phoneFrame(
          [buildCallerTextBack(active)],
          `Caller's phone — ${scenario.from}`,
        )
      }`,
    );
    console.log(
      `    ${YELLOW}Campaign B only${RESET} ${DIM}— text-backs stay gated off until that campaign is approved.${RESET}`,
    );
  }

  const email = buildOwnerEmail(active, record);
  console.log(`\n  ${DIM}Email — subject:${RESET} ${email.subject}`);
}

function main() {
  const args = Deno.args;

  if (args.includes("--prompt")) {
    console.log(
      `${BOLD}Rendered agent prompt for ${spokenName(profile)}${RESET}\n`,
    );
    console.log(buildSystemPrompt(profile));
    return;
  }

  if (args.includes("--caps")) {
    const plan = PLANS.standard;
    const included = plan.included_minutes;

    console.log(
      `${BOLD}Caps${RESET} ${DIM}— ${plan.label}, $${
        (plan.price_cents / 100).toFixed(0)
      }/mo, ${included} minutes${RESET}\n`,
    );

    const points = [
      ["quiet month", Math.round(included * 0.3)],
      ["getting busy", Math.round(included * 0.8)],
      ["at the cap", included],
      ["over — brief mode", Math.round(included * 1.2)],
      ["hard ceiling", Math.round(included * 1.5)],
      ["runaway (10x)", included * 10],
    ] as const;

    for (const [label, used] of points) {
      const d = decideCallMode(plan, used);
      const e = unitEconomics(plan, used);
      const color = d.mode === "closed"
        ? RED
        : d.mode === "brief"
        ? YELLOW
        : GREEN;

      console.log(
        `  ${label.padEnd(20)} ${String(used).padStart(5)} min  ` +
          `${color}${d.mode.padEnd(7)}${RESET} ` +
          `${DIM}cap ${String(d.seconds_cap).padStart(3)}s${RESET}  ` +
          `profit ${
            `$${(e.gross_profit_cents / 100).toFixed(2)}`.padStart(8)
          }  ${DIM}margin ${(e.margin * 100).toFixed(1)}%${RESET}` +
          (d.warn_owner ? `  ${YELLOW}(owner warned)${RESET}` : ""),
      );
    }

    console.log(
      `\n  ${BOLD}Worst reachable margin: ${
        (worstCaseMargin(plan) * 100).toFixed(1)
      }%${RESET}`,
    );
    console.log(
      `  ${DIM}A runaway client costs exactly what a capped one does. Brief mode still`,
    );
    console.log(
      `  catches the lead in ${BRIEF_CALL_SECONDS_CAP}s. Degrade, do not die.${RESET}\n`,
    );
    return;
  }

  const validateAt = args.indexOf("--validate");

  if (validateAt !== -1) {
    const path = args[validateAt + 1];

    if (!path) {
      console.error("Usage: --validate <path-to-profile.json>");
      Deno.exit(1);
    }

    let raw: unknown;

    try {
      raw = JSON.parse(Deno.readTextFileSync(path));
    } catch (error) {
      console.error(`${RED}Could not read ${path}${RESET}`);
      console.error(`  ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }

    // The intake form emits { profile, setup }; a stored profile is bare.
    const wrapper = raw as Record<string, unknown>;
    const candidate = wrapper.profile ?? raw;
    const setup = wrapper.setup as Record<string, unknown> | undefined;

    try {
      const parsed = parseProfile(candidate);

      console.log(
        `${GREEN}Valid.${RESET} ${BOLD}${spokenName(parsed)}${RESET}`,
      );
      console.log(
        `  ${DIM}${parsed.business_type} · ${
          parsed.service_area.join(", ")
        }${RESET}`,
      );
      console.log(
        `  ${DIM}urgency: ${
          parsed.urgency.enabled
            ? `${parsed.urgency.packs.join(", ") || "general only"}${
              parsed.urgency.live_transfer ? " · rings owner" : " · alert only"
            }`
            : "off"
        }${RESET}`,
      );

      if (setup?.line_type) {
        const key = setup.line_type as CarrierKey;
        console.log(`\n${BOLD}Forwarding for this client${RESET}`);

        for (const line of forwardingScript(key, parsed.phone.ringlatch)) {
          console.log(`  ${line}`);
        }
      } else {
        console.log(
          `\n${YELLOW}No line_type recorded${RESET} ${DIM}— you will not know which forwarding codes to use.${RESET}`,
        );
      }

      if (parsed.phone.ringlatch === "+15550000000") {
        console.log(
          `\n${YELLOW}Placeholder Ringlatch number${RESET} ${DIM}— assign the real one before going live.${RESET}`,
        );
      }
    } catch (error) {
      console.error(`${RED}Invalid profile.${RESET}`);
      console.error(`  ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }

    return;
  }

  if (args.includes("--forwarding")) {
    console.log(
      `${BOLD}Call forwarding setup${RESET} ${DIM}— read aloud to the owner; forwards to ${profile.phone.ringlatch}${RESET}\n`,
    );

    for (const key of Object.keys(CARRIERS) as CarrierKey[]) {
      for (const line of forwardingScript(key, profile.phone.ringlatch)) {
        console.log(`  ${line}`);
      }
      console.log("");
    }

    console.log(`${BOLD}Then verify, every time${RESET}`);
    VERIFICATION_STEPS.forEach((step, index) => {
      console.log(`  ${index + 1}. ${step}`);
    });
    console.log("");
    return;
  }

  const selected = args.find((arg) => !arg.startsWith("--"));
  const scenarios = selected
    ? SCENARIOS.filter((scenario) => scenario.key === selected)
    : SCENARIOS;

  if (scenarios.length === 0) {
    console.error(
      `Unknown scenario "${selected}". Try: ${
        SCENARIOS.map((scenario) => scenario.key).join(", ")
      }`,
    );
    Deno.exit(1);
  }

  console.log(
    `${BOLD}Ringlatch${RESET} ${DIM}— one engine, ${
      new Set(scenarios.map((scenario) => (scenario.profile ?? profile).slug))
        .size
    } business type(s), no per-client code${RESET}`,
  );

  for (const scenario of scenarios) {
    runScenario(scenario);
  }

  console.log("");
}

// Importable without side effects, so the test suite can reuse wrapText.
if (import.meta.main) {
  main();
}
