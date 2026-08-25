/**
 * Verification for the platform's call-event signatures.
 *
 * The signature header is `v={unix_ms},d={hex digest}` where the digest is
 * HMAC-SHA256 over the raw body with the timestamp appended. Timestamps older
 * than five minutes are rejected to block replays, and the digest comparison
 * runs in constant time so a failed verification leaks nothing.
 */

export const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

export async function signPayload(
  rawBody: string,
  timestamp: number,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody + String(timestamp)),
  );

  return Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature) {
    return false;
  }

  const parts = signature.trim().match(/^v=(\d+),d=(.+)$/);

  if (!parts) {
    return false;
  }

  const [, timestamp, digest] = parts;

  if (Math.abs(Date.now() - Number(timestamp)) > SIGNATURE_MAX_AGE_MS) {
    return false;
  }

  const expected = await signPayload(rawBody, Number(timestamp), secret);
  const provided = digest.trim().toLowerCase();

  if (provided.length !== expected.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }

  return mismatch === 0;
}
