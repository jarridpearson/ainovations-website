/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

// Exchanges a native Sign in with Apple authorizationCode for an Apple
// refresh token, and stores it server-side, associated only with the
// authenticated Everward user who is signing in right now. This refresh
// token is the credential later used by delete-personal-account to revoke
// the OLD Apple authorization as part of account deletion, per Apple's
// current account-deletion guidance -- it is never returned to the client
// and never readable by anon/authenticated roles (see
// 20260807000002_create_user_apple_credentials.sql).
//
// Called from LoginScreen immediately after a successful
// supabase.auth.signInWithIdToken() Apple sign-in, passing the
// authorizationCode the native module also returned alongside the
// identityToken. This function does not perform the Everward sign-in
// itself -- that continues to happen exactly as it does today, via
// signInWithIdToken. This function only captures the separate credential
// material needed for future revocation.
//
// authorizationCode is NULLABLE on Apple's own
// ASAuthorizationAppleIDCredential API -- it is not guaranteed present on
// every successful native sign-in. LoginScreen only calls this function
// when credential.authorizationCode is actually present; when it is
// absent, LoginScreen completes the Everward login normally and simply
// does not call this function at all (see the invariant note on the
// missing-code validation below). This function therefore never needs to
// special-case "code is null" -- it is designed to be called only when a
// real code exists, and strictly rejects any call that violates that
// invariant, as defense in depth against a future caller mistake rather
// than as an expected runtime path.
//
// Required secrets (Supabase Edge Function secrets, never in the mobile
// app bundle):
//   APPLE_TEAM_ID      - Apple Developer Team ID
//   APPLE_KEY_ID       - Key ID of the Sign in with Apple private key
//   APPLE_PRIVATE_KEY  - the .p8 private key contents (PKCS8 PEM)
//   APPLE_CLIENT_ID    - com.ainovations.everward (bundle ID; this is the
//                        native-app Sign in with Apple flow, so the
//                        client_id used against Apple's token endpoint is
//                        the app's bundle identifier, not a web Services ID)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  const responseBody =
    status >= 400
      ? {
          ...(typeof body === 'object' && body !== null
            ? body
            : { error: String(body) }),
          status,
        }
      : body;

  return new Response(JSON.stringify(responseBody), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Apple requires an ES256-signed JWT as the client_secret for both the
// token-exchange and revoke endpoints. Signed here using Deno's Web Crypto
// (SubtleCrypto) -- no extra dependency needed for ECDSA P-256/SHA-256.
async function generateAppleClientSecret(): Promise<string> {
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const privateKeyPem = Deno.env.get('APPLE_PRIVATE_KEY');
  const clientId = Deno.env.get('APPLE_CLIENT_ID');

  if (!teamId || !keyId || !privateKeyPem || !clientId) {
    throw new Error(
      'Apple Sign in server credentials are not fully configured.'
    );
  }

  const header = { alg: 'ES256', kid: keyId };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: teamId,
    iat: nowSeconds,
    // Short-lived on purpose: this JWT is generated fresh for each call and
    // used immediately, not stored or reused. Apple allows up to 6 months;
    // there is no reason to mint one that long-lived here.
    exp: nowSeconds + 300,
    aud: 'https://appleid.apple.com',
    sub: clientId,
  };

  const encodedHeader = base64UrlEncodeString(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signature));

  return `${signingInput}.${encodedSignature}`;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length < 2) {
    throw new Error('Malformed JWT.');
  }
  const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  return JSON.parse(decoded);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(
      { error: 'Supabase environment is not configured.' },
      500
    );
  }

  const authorizationHeader = request.headers.get('Authorization') ?? '';

  if (!authorizationHeader) {
    return jsonResponse({ error: 'Missing authorization header.' }, 401);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: 'Unauthorized.' }, 401);
  }

  let requestBody: { authorizationCode?: string };

  try {
    requestBody = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const authorizationCode = requestBody.authorizationCode;

  // Rejecting a missing code here does NOT erase or affect any existing
  // stored credential -- this function returns before ever reaching the
  // upsert below, so an already-stored, valid refresh token for this user
  // (from an earlier login that did have a code) is left completely
  // untouched. LoginScreen is designed to never call this function without
  // a real code in the first place; this check exists purely as defense
  // in depth against a future caller mistake, not as an expected path.
  if (!authorizationCode || typeof authorizationCode !== 'string') {
    return jsonResponse({ error: 'Missing authorizationCode.' }, 400);
  }

  const clientId = Deno.env.get('APPLE_CLIENT_ID');

  let clientSecret: string;

  try {
    clientSecret = await generateAppleClientSecret();
  } catch (error) {
    console.error(
      'Apple client secret generation failed:',
      error instanceof Error ? error.message : String(error)
    );
    return jsonResponse(
      { error: 'Apple sign-in server configuration error.' },
      500
    );
  }

  const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    }),
  });

  const tokenBody = await tokenResponse.json().catch(() => null);

  if (!tokenResponse.ok || !tokenBody?.refresh_token) {
    // Apple authorization codes are single-use and short-lived (~5 minutes).
    // If this exact code was already exchanged by an earlier call that
    // timed out client-side before the response arrived, Apple correctly
    // rejects the second exchange attempt with invalid_grant. In that
    // specific case, if we already have a stored, usable credential for
    // this user, the desired end state (a valid stored refresh token)
    // already exists -- treat this as success rather than a hard failure.
    if (tokenBody?.error === 'invalid_grant') {
      const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
      const { data: existing } = await adminClient
        .from('user_apple_credentials')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        return jsonResponse({ synced: true, alreadySynced: true });
      }
    }

    console.error(
      'Apple token exchange failed:',
      tokenResponse.status,
      tokenBody?.error ?? 'unknown_error'
      // Deliberately not logging tokenBody in full -- it may contain
      // token material on some error shapes.
    );

    return jsonResponse(
      { error: 'Apple sign-in could not be completed.' },
      502
    );
  }

  let appleSub: string;

  try {
    const idTokenPayload = decodeJwtPayload(tokenBody.id_token as string);
    appleSub = String(idTokenPayload.sub);
  } catch {
    return jsonResponse(
      { error: 'Apple sign-in returned an unexpected response.' },
      502
    );
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

  // Each successful code exchange issues a NEW Apple refresh token. Apple
  // does not require the previous one to be explicitly invalidated before
  // issuing a new one, and this upsert (onConflict: user_id) replaces
  // whatever was previously stored with the latest. This is sufficient
  // for revoke-on-delete's purpose: it always revokes whichever token
  // Everward currently holds, which ends the authorization relationship
  // Everward itself is aware of. Whether Apple internally also invalidates
  // an earlier, now-untracked refresh token from a prior login as part of
  // revoking a later one is not documented at that level of detail and is
  // not asserted either way here -- it does not change the correctness of
  // this design, since Everward's revoke call targets the grant it
  // actually established and is tracking.
  const { error: upsertError } = await adminClient
    .from('user_apple_credentials')
    .upsert(
      {
        user_id: user.id,
        apple_sub: appleSub,
        apple_refresh_token: tokenBody.refresh_token,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (upsertError) {
    console.error('Storing Apple credential failed:', upsertError.message);
    return jsonResponse(
      { error: 'Apple sign-in could not be completed.' },
      500
    );
  }

  // The refresh token is never included in this response.
  return jsonResponse({ synced: true });
});
