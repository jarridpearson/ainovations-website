// AInovations marketing chatbot — serverless brain.
// POST { messages:[{role,content}], meta:{ session_id, source_url, referrer } }
//  -> { reply, captured }   (captured=true when a warm lead was saved this turn)
//
// Talks to the Claude API with the AInovations knowledge base as its system prompt,
// and captures warm leads via a tool call straight into Supabase (+ optional email alert).
// Secrets live only in Netlify env vars — never in the page.
import crypto from 'node:crypto';
import { KB } from './kb.mjs';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.CHAT_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = parseInt(process.env.CHAT_MAX_TOKENS || '600', 10);
const MAX_USER_TURNS = parseInt(process.env.MAX_USER_TURNS || '24', 10);
const HISTORY_LIMIT = 20; // messages kept from the tail of the conversation

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ptipedxvsekwoehfalux.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const LEAD_TO = process.env.LEAD_EMAIL_TO || 'jp@ainovations.net';
const LEAD_FROM = process.env.LEAD_EMAIL_FROM || 'AInovations Assistant <leads@ainovations.net>';
const IP_SALT = process.env.IP_SALT || 'ainov-static-salt';

const SYSTEM = `You are Aiden, AInovations' friendly, sharp AI assistant, living in a chat widget on ainovations.net. Your name is Aiden — a nod to "AI". You are not a human; if asked, say plainly that you're Aiden, AInovations' AI assistant. Your job is to help visitors understand AInovations' products and services, keep them engaged, and identify and capture warm leads for the team.

HOW YOU WORK — follow this flow:
1. On your FIRST reply, introduce yourself as Aiden, greet the visitor warmly, say in one line what you can help with, and ask for their FIRST NAME before going deep. Keep it short and human.
2. Once you know their name, use it naturally. Answer their questions using ONLY the knowledge base below. Be concise, warm, and genuinely useful — a few sentences, skimmable; use a short list only when it truly helps.
3. Be proactive to drive engagement: after answering, ask a relevant follow-up to understand their business and needs, and guide them toward the product that fits (Rent-a-Site, Rent-an-App, Chalkline, Churches, Ringlatch, Hire Us, etc.). Don't just answer and stop.
4. If the knowledge base does not cover something — an unlisted price, a contract or timeline specific, anything you're unsure of — say so honestly and point them to support@ainovations.net. NEVER invent prices, features, timelines, guarantees, or promises. State prices ONLY exactly as written in the knowledge base.
5. WARM LEAD: when a visitor shows real interest (wants a site/app/service for their business, asks how to sign up, asks whether a plan fits, or asks someone to reach out), offer to have the team reach out and ask for the BEST EMAIL and their ROLE/TITLE at the business (e.g. "Want me to have our team reach out with details? What's the best email, and your role there?"). Keep the name you already have.
6. Once the visitor has given a real email, call the capture_lead tool with what you know. After it saves, warmly confirm the team will reach out (usually within one business day) and keep helping. One ask is enough — if they'd rather not share, keep helping and leave the door open; don't nag.

GUARDRAILS:
- Only ever collect first name, email, business title, and business name. NEVER ask for or accept passwords, card/payment details, or other sensitive data.
- Stay on AInovations topics; politely redirect anything off-topic back to how you can help with AInovations.
- Never promise Google rankings, approval, delivery dates, or anything not in the knowledge base.
- HR / PAYROLL: AInovations does NOT do payroll, HR, employee benefits, employee/HR onboarding, HCM conversion, learning and development (L&D / training), or talent acquisition (recruiting/hiring). If asked whether AInovations helps with any of those, say plainly that it doesn't, and recommend a trusted HR vendor such as PuzzleHR (puzzlehr.com). (This does NOT apply to an app "setup/onboarding fee," which AInovations does handle.)
- TOWNCRIER is a client, not a product to explain: if asked, just say Towncrier is an AInovations client and point them to gettowncrier.com — don't spend turns on it.
- ROBLOX/GAMES: you can say AInovations builds Roblox games (a custom-build capability), but for anything about the actual games, point to /roblox-games and move on — don't waste the conversation on game details.
- FINE PRINT — HARD RULE: the early-termination fee, the price-change/notice clause, and renewal/notice terms are answered ONLY when the visitor explicitly asks about leaving early, cancelling, ending or getting out of the agreement, what happens at the end of the term, or whether the price can change. When asked, answer plainly and exactly as the knowledge base states — never soften, never invent. In EVERY other case — including questions about plans, prices, month-to-month, refunds, setup, what's included, or how it works — do NOT mention them at all, not as a "quick note," not as "one more thing," not as reassurance. If the knowledge base has no answer (e.g. refunds), say so and point to support@ainovations.net without adding unrelated terms.
- Keep every reply short and easy to read on a phone.

=== AINOVATIONS KNOWLEDGE BASE ===
${KB}
=== END KNOWLEDGE BASE ===`;

const LEAD_TOOL = {
  name: 'capture_lead',
  description:
    'Save a warm lead and alert the AInovations team to reach out. Call this ONLY after the visitor has given a real email address they typed themselves. Do not call it with a placeholder or guessed email, and do not call it before the visitor has expressed genuine interest.',
  input_schema: {
    type: 'object',
    properties: {
      first_name: { type: 'string', description: "The visitor's first name." },
      email: { type: 'string', description: 'The email address the visitor provided.' },
      business_title: { type: 'string', description: "The visitor's role/title, e.g. Owner, Office Manager." },
      business_name: { type: 'string', description: 'The name of their business, if given.' },
      interest: { type: 'string', description: 'Which AInovations product/service they are interested in.' },
      summary: { type: 'string', description: '1-3 sentences on what they want and any detail useful for follow-up.' },
    },
    required: ['first_name', 'email', 'interest', 'summary'],
  },
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(IP_SALT + ip).digest('hex').slice(0, 32);
}

// Keep only clean {role, content-string} user/assistant turns from the tail.
function sanitizeHistory(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content.trim()) continue;
    out.push({ role: m.role, content: content.slice(0, 4000) });
  }
  // Ensure the conversation starts with a user turn (Anthropic requirement).
  while (out.length && out[0].role !== 'user') out.shift();
  return out.slice(-HISTORY_LIMIT);
}

async function callClaude(messages, { includeTool }) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      tools: includeTool ? [LEAD_TOOL] : undefined,
      messages,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${detail.slice(0, 400)}`);
  }
  return res.json();
}

async function saveLead(input, ctx) {
  const row = {
    session_id: ctx.session_id || null,
    first_name: input.first_name || null,
    email: input.email || null,
    business_title: input.business_title || null,
    business_name: input.business_name || null,
    interest: input.interest || null,
    summary: input.summary || null,
    warm_lead: true,
    transcript: ctx.transcript || null,
    source_url: ctx.source_url || null,
    referrer: ctx.referrer || null,
    user_agent: ctx.user_agent || null,
    ip_hash: ctx.ip_hash || null,
    status: 'new',
  };

  let stored = false;
  if (SUPABASE_URL && SUPABASE_KEY) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/chatbot_leads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    stored = res.ok;
    if (!res.ok) console.error('lead store failed', res.status, await res.text().catch(() => ''));
  } else {
    console.error('lead store skipped: SUPABASE_SERVICE_ROLE_KEY not set');
  }

  // Optional instant email alert (only if a provider key is configured).
  if (RESEND_API_KEY) {
    const lines = [
      `New warm lead from the ainovations.net chatbot:`,
      ``,
      `Name:      ${row.first_name || '(not given)'}`,
      `Email:     ${row.email || '(not given)'}`,
      `Title:     ${row.business_title || '(not given)'}`,
      `Business:  ${row.business_name || '(not given)'}`,
      `Interest:  ${row.interest || '(not given)'}`,
      ``,
      `Summary:   ${row.summary || ''}`,
      ``,
      `Page:      ${row.source_url || ''}`,
      `Stored in Supabase: ${stored ? 'yes' : 'NO — check SUPABASE_SERVICE_ROLE_KEY'}`,
    ].join('\n');
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: LEAD_FROM,
          to: [LEAD_TO],
          reply_to: row.email || undefined,
          subject: `New chatbot lead: ${row.first_name || 'someone'}${row.business_name ? ' @ ' + row.business_name : ''}`,
          text: lines,
        }),
      });
    } catch (e) {
      console.error('lead email failed', e.message);
    }
  }
  return stored;
}

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);
  if (!process.env.ANTHROPIC_API_KEY) return jsonResponse({ error: 'server not configured' }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad request' }, 400);
  }

  const history = sanitizeHistory(body.messages);
  if (!history.length) return jsonResponse({ error: 'no message' }, 400);

  // Cost guard: cap conversation length.
  const userTurns = history.filter((m) => m.role === 'user').length;
  if (userTurns > MAX_USER_TURNS) {
    return jsonResponse({
      reply: `We've covered a lot! For anything more, the best next step is to email support@ainovations.net and the team will pick it up from here.`,
      captured: false,
    });
  }

  const meta = body.meta || {};
  const ip = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const ctx = {
    session_id: typeof meta.session_id === 'string' ? meta.session_id.slice(0, 80) : null,
    source_url: typeof meta.source_url === 'string' ? meta.source_url.slice(0, 500) : null,
    referrer: typeof meta.referrer === 'string' ? meta.referrer.slice(0, 500) : null,
    user_agent: (req.headers.get('user-agent') || '').slice(0, 400),
    ip_hash: hashIp(ip),
    transcript: history,
  };

  try {
    const messages = [...history];
    let data = await callClaude(messages, { includeTool: true });
    let captured = false;

    // Handle a lead-capture tool call, then get the model's natural confirmation.
    if (data.stop_reason === 'tool_use') {
      const toolUse = (data.content || []).find((c) => c.type === 'tool_use' && c.name === 'capture_lead');
      const toolResults = [];
      if (toolUse) {
        let ok = false;
        try {
          ok = await saveLead(toolUse.input || {}, ctx);
        } catch (e) {
          console.error('saveLead threw', e.message);
        }
        captured = ok;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: ok
            ? 'Lead saved and the team was alerted. Confirm to the visitor that someone will reach out (usually within one business day).'
            : 'Lead could not be saved. Apologize briefly and ask them to email support@ainovations.net so nothing is lost.',
        });
      }
      // Also answer any other tool the model might invoke, defensively.
      for (const c of data.content || []) {
        if (c.type === 'tool_use' && c.id !== (toolUse && toolUse.id)) {
          toolResults.push({ type: 'tool_result', tool_use_id: c.id, content: 'Not available.' });
        }
      }
      messages.push({ role: 'assistant', content: data.content });
      messages.push({ role: 'user', content: toolResults });
      data = await callClaude(messages, { includeTool: true });
    }

    const reply = (data.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim() || `Sorry — I hit a snag. You can reach the team directly at support@ainovations.net.`;

    return jsonResponse({ reply, captured });
  } catch (e) {
    console.error('chat error', e.message);
    return jsonResponse({
      reply: `Sorry — I'm having a moment. Please try again, or email support@ainovations.net and the team will help.`,
      captured: false,
    }, 200);
  }
};
