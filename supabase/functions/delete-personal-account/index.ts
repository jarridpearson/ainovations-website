/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

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

// Same ES256 client-secret generation as sync-apple-authorization.
// Duplicated rather than shared: this repo's Edge Functions are each
// self-contained (no _shared/ directory exists anywhere in this project),
// and this is a deliberately small, security-relevant block that is easier
// to review duplicated-and-identical in two places than introduced as this
// project's first cross-function import.

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

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

type AppleCredentialRow = {
  apple_refresh_token: string;
};

// Apple revocation status for this deletion request. This is a STATUS, not
// a gate -- account deletion below proceeds identically regardless of which
// value this resolves to. Nothing about deletion is blocked by Apple's
// availability.
//
//   'revoked'                  - a stored credential existed and Apple
//                                 confirmed the authorization is now
//                                 inactive (either a real 200 from
//                                 /auth/revoke, or Apple reporting the
//                                 token was already invalid -- both are the
//                                 same desired end state: no active
//                                 authorization remains).
//   'not_applicable'           - this Supabase user has no Apple identity
//                                 at all (email/password account). No
//                                 manual-revocation guidance is shown.
//   'manual_action_recommended' - this account IS Apple-linked, but
//                                 Everward could not programmatically
//                                 confirm revocation, either because no
//                                 credential was ever stored (the sync step
//                                 never completed for this account) or
//                                 because Apple's endpoint failed/was
//                                 unreachable just now. Deletion proceeds
//                                 regardless; the client shows Apple's
//                                 documented manual-revocation path.
type AppleRevocationStatus =
  | 'revoked'
  | 'not_applicable'
  | 'manual_action_recommended';

async function resolveAppleRevocationStatus(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  user: { id: string; identities?: Array<{ provider: string }> | null }
): Promise<AppleRevocationStatus> {
  const isAppleLinked =
    user.identities?.some((identity) => identity.provider === 'apple') ??
    false;

  if (!isAppleLinked) {
    return 'not_applicable';
  }

  const { data: credential, error: loadError } = (await adminClient
    .from('user_apple_credentials')
    .select('apple_refresh_token')
    .eq('user_id', user.id)
    .maybeSingle()) as {
    data: AppleCredentialRow | null;
    error: { message: string } | null;
  };

  if (loadError) {
    // A genuine Everward-side database problem, not an Apple-availability
    // problem -- surfaced as a thrown error so the caller can decide how
    // to handle it, rather than silently treated as "nothing to revoke".
    throw new Error(
      `Could not check for a stored Apple credential: ${loadError.message}`
    );
  }

  if (!credential) {
    // Apple-linked account, but no stored credential -- e.g. the sync step
    // never completed for this login, or this account predates that
    // feature. Deletion must not be blocked by this; recommend manual
    // revocation instead, since Everward has no token to revoke with.
    return 'manual_action_recommended';
  }

  let clientSecret: string;

  try {
    clientSecret = await generateAppleClientSecret();
  } catch (error) {
    console.error(
      'Apple client secret generation failed during deletion:',
      error instanceof Error ? error.message : String(error)
    );
    return 'manual_action_recommended';
  }

  let revokeResponse: Response;

  try {
    revokeResponse = await fetch('https://appleid.apple.com/auth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('APPLE_CLIENT_ID')!,
        client_secret: clientSecret,
        token: credential.apple_refresh_token,
        token_type_hint: 'refresh_token',
      }),
    });
  } catch (error) {
    // Network failure reaching Apple (outage, DNS, timeout, etc). This must
    // never block Everward account deletion -- fall through to manual
    // guidance rather than throwing.
    console.error(
      'Apple revoke endpoint unreachable during deletion:',
      error instanceof Error ? error.message : String(error)
    );
    return 'manual_action_recommended';
  }

  if (revokeResponse.ok) {
    return 'revoked';
  }

  const revokeBody = await revokeResponse.json().catch(() => null);

  // Apple reports the token was already invalid/revoked -- for example the
  // user separately revoked Everward's access from their Apple ID
  // settings. That is already the desired end state.
  if (
    revokeBody?.error === 'invalid_token' ||
    revokeBody?.error === 'invalid_grant'
  ) {
    return 'revoked';
  }

  // Any other Apple-side response (rate limiting, an unexpected permanent
  // error, a misconfigured client_secret, etc). Per the corrected design,
  // this is NOT a reason to block deletion -- log it for operational
  // visibility (without logging the token itself) and fall through to
  // manual guidance.
  console.error(
    'Apple token revocation returned an unexpected response during deletion:',
    revokeResponse.status,
    revokeBody?.error ?? 'unknown_error'
  );

  return 'manual_action_recommended';
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

  // Identity is resolved exclusively from the verified JWT. There is
  // intentionally no field anywhere in this function for a client-supplied
  // target user id.
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

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

  // Step 1: resolve Apple revocation status. This is informational only --
  // see resolveAppleRevocationStatus's doc comment. Everward account
  // deletion is never blocked by Apple's availability, by the absence of a
  // stored credential, or by any Apple-side error other than a genuine
  // Everward-side database failure while checking (which surfaces as a
  // real 500, since that indicates a problem with Everward's own
  // infrastructure, not with Apple).
  let appleRevocationStatus: AppleRevocationStatus;

  try {
    appleRevocationStatus = await resolveAppleRevocationStatus(
      adminClient,
      user
    );
  } catch (error) {
    return jsonResponse(
      {
        error:
          'Your account could not be checked for deletion. Please try again.',
        detail: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }

  // Step 2: delete all Everward personal data (transactional RPC), which
  // also removes the stored Apple credential row if one existed. This
  // happens regardless of appleRevocationStatus. The credential is only
  // ever destroyed here, AFTER the revocation attempt above has already
  // concluded (successfully, already-invalid, or "recommend manual
  // action") -- never before that decision is made, and Everward does not
  // implement a deferred/background retry that would need the credential
  // preserved any longer than this.
  const { error: dataDeleteError } = await adminClient.rpc(
    'delete_personal_account_data',
    { p_user_id: user.id }
  );

  if (dataDeleteError) {
    // Nothing else has been touched. Retry-safe: a retry re-resolves Apple
    // revocation status (harmless to repeat -- an already-revoked token
    // reports invalid_token/invalid_grant, still resolving to 'revoked';
    // if it was already deleted from a still-somehow-partial prior
    // attempt, resolves to 'manual_action_recommended', which is also
    // fine) and re-attempts this RPC, which is naturally idempotent (every
    // DELETE in it is a no-op on already-deleted rows).
    return jsonResponse(
      {
        error:
          'Account data could not be deleted. Your account has not been removed. Please try again.',
        detail: dataDeleteError.message,
      },
      500
    );
  }

  // Step 3: delete the Supabase Auth user LAST, only after data cleanup has
  // succeeded. Hard delete (auth.admin.deleteUser), never a ban -- this
  // removes auth.users and its linked auth.identities row(s), including
  // the Apple provider mapping, which is what allows a future Continue
  // with Apple sign-in for the same Apple identity to create a genuinely
  // fresh Everward account. No denylist or "previously deleted" flag is
  // stored anywhere in this design.
  const { error: authDeleteError } =
    await adminClient.auth.admin.deleteUser(user.id);

  if (authDeleteError) {
    // Data and any Apple credential are already gone, but the auth account
    // itself could not be removed. Surfaced distinctly so the client never
    // claims full success when the user could theoretically still
    // authenticate into an account with no data. Retry-safe: a retry's
    // getUser() check still succeeds (auth user still exists), Apple
    // resolution finds no stored credential (already deleted, resolves to
    // 'manual_action_recommended' harmlessly), the RPC re-runs as a no-op,
    // and auth.admin.deleteUser is attempted again.
    return jsonResponse(
      {
        error:
          'Your personal data was removed, but the account itself could not be fully deleted. Please contact support.',
        detail: authDeleteError.message,
      },
      500
    );
  }

  return jsonResponse({ deleted: true, appleRevocation: appleRevocationStatus });
});
