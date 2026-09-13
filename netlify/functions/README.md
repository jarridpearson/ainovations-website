# AInovations chatbot — backend

Serverless brain for the site-wide chat widget (`/chatbot.js`).

- `chat.mjs` — the function. Talks to the Claude API with `kb.mjs` as its system
  prompt, and captures warm leads via a tool call into Supabase (+ optional email).
  Endpoint: `/.netlify/functions/chat` (also aliased to `/api/chat`).
- `kb.mjs` — the knowledge base. Every fact/price was extracted verbatim from the
  live ainovations.net pages and price-verified. To update: change the live page,
  then update this file. The bot answers ONLY from here; anything else → it defers
  to support@ainovations.net.

## Required Netlify environment variables

Set these in Netlify → Site settings → Environment variables (they are secrets and
never appear in the page):

| Variable | Required | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | Anthropic API key. Without it the bot returns "server not configured". |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** (to save leads) | Service-role key for the `ainovations` Supabase project (`ptipedxvsekwoehfalux`). Supabase → Project settings → API → `service_role`. Server-only; bypasses RLS to write `chatbot_leads`. |
| `RESEND_API_KEY` | Optional | Enables the instant email alert to jp@ when a lead is captured. Without it, leads are still stored in Supabase. |

## Optional tuning variables (sensible defaults baked in)

| Variable | Default | Notes |
|---|---|---|
| `CHAT_MODEL` | `claude-sonnet-5` | Set to `claude-haiku-4-5-20251001` for ~5× lower cost per chat. |
| `CHAT_MAX_TOKENS` | `600` | Max tokens per reply (cost cap). |
| `MAX_USER_TURNS` | `24` | Conversation length cap per session (abuse/cost guard). |
| `SUPABASE_URL` | `https://ptipedxvsekwoehfalux.supabase.co` | The `ainovations` project. |
| `LEAD_EMAIL_TO` | `jp@ainovations.net` | Where lead alerts go. |
| `LEAD_EMAIL_FROM` | `AInovations Assistant <leads@ainovations.net>` | Requires a Resend-verified domain. |
| `IP_SALT` | (static) | Salt for hashing IPs (audit only; raw IP never stored). |

## Lead store

Leads land in `public.chatbot_leads` in the `ainovations` Supabase project — private
(RLS on, no policies; service-role only). Columns: first_name, email, business_title,
business_name, interest, summary, transcript, source_url, status ('new' → your CRM pipeline).
