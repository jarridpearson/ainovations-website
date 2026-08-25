#!/usr/bin/env -S deno run --allow-read
/**
 * Emits the Retell agent configuration for the ONE Ringlatch agent.
 *
 * Everything client-specific arrives as a dynamic variable from the inbound
 * webhook, which is what lets a single agent serve every client. The prompt
 * itself is {{agent_prompt}} — the webhook decides whether that is the full,
 * brief or closed version based on the client's usage.
 *
 *   deno run --allow-read ringlatch/setup-retell.ts > retell-agent.json
 */

const agent = {
  agent_name: "Ringlatch",
  language: "en-US",

  // Fast and cheap keeps the per-minute cost near the low end of the range the
  // whole margin model is built on.
  response_engine: {
    type: "retell-llm",
    llm_websocket_url: null,
  },
  llm: {
    model: "gpt-4o-mini",
    general_prompt: "{{agent_prompt}}",
    begin_message: "{{greeting}}",
    general_tools: [
      {
        type: "transfer_call",
        name: "transfer_to_owner",
        description:
          "Transfer an urgent caller to the business owner. Only use when transfer_allowed is true.",
        transfer_destination: {
          type: "predefined",
          number: "{{owner_cell}}",
        },
        transfer_option: { type: "cold_transfer" },
      },
      {
        type: "end_call",
        name: "end_call",
        description: "End the call once the details are captured.",
      },
    ],
  },

  voice_id: "11labs-Adrian",
  voice_speed: 1,
  interruption_sensitivity: 0.9,

  // Rural callers on bad cell signal pause a lot. Cutting them off mid-sentence
  // is the fastest way to lose the lead.
  responsiveness: 0.8,
  end_call_after_silence_ms: 15000,

  // Hard ceiling, set per call by the inbound webhook. This is the backstop
  // that stops one looping call from eating a client's month.
  max_call_duration_ms: 300000,

  enable_backchannel: true,
  backchannel_words: ["mm-hm", "yeah", "okay"],

  // Post-call extraction. These field names must match extractLead() in
  // supabase/functions/ringlatch-call-webhook/index.ts.
  post_call_analysis_data: [
    { type: "string", name: "caller_name", description: "The caller's name." },
    {
      type: "string",
      name: "callback_number",
      description: "Callback number in E.164, e.g. +13155551234.",
    },
    {
      type: "string",
      name: "town",
      description: "Town or area the caller is in.",
    },
    {
      type: "string",
      name: "service_address",
      description: "Street address if the caller gave one.",
    },
    {
      type: "string",
      name: "job_description",
      description: "What the caller needs, in their own words.",
    },
    {
      type: "string",
      name: "urgency_note",
      description: "How soon they need it, if they said.",
    },
  ],

  // Post-call analysis lands here (idempotent; retries safe).
  webhook_url:
    "https://ptipedxvsekwoehfalux.supabase.co/functions/v1/ringlatch-call-webhook",
};

console.log(JSON.stringify(agent, null, 2));

console.error(`
WIRING CHECKLIST (real URLs, ready to paste):
  1. Retell inbound webhook (fires when a call arrives, returns the per-client
     agent config as dynamic variables):
     https://ptipedxvsekwoehfalux.supabase.co/functions/v1/ringlatch-inbound
  2. Agent-level webhook (post-call analysis -> owner SMS/email):
     https://ptipedxvsekwoehfalux.supabase.co/functions/v1/ringlatch-call-webhook
  3. Connect number +13159076170: Retell dashboard -> Phone Numbers ->
     "Connect to your number" -> Twilio. Retell then points the number's Twilio
     Voice webhook at Retell's endpoint - that is the piece that makes calls
     reach the agent at all.
  4. Copy the Retell API key into Supabase:
     npx supabase secrets set RETELL_WEBHOOK_SECRET=<retell api key>
`);
