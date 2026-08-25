import { assertEquals } from "jsr:@std/assert@1";
import {
  SIGNATURE_MAX_AGE_MS,
  signPayload,
  verifySignature,
} from "./verify.ts";

const SECRET = "key_test_1234567890abcdef";
const BODY = JSON.stringify({
  event: "call_analyzed",
  call: { call_id: "call_abc", to_number: "+13159076170" },
});

async function header(
  body: string,
  timestamp: number,
  secret: string,
): Promise<string> {
  return `v=${timestamp},d=${await signPayload(body, timestamp, secret)}`;
}

Deno.test("accepts a correctly signed payload", async () => {
  const now = Date.now();
  assertEquals(
    await verifySignature(BODY, await header(BODY, now, SECRET), SECRET),
    true,
  );
});

Deno.test("accepts a signature a few minutes old, within the replay window", async () => {
  const ts = Date.now() - (SIGNATURE_MAX_AGE_MS - 60_000);
  assertEquals(
    await verifySignature(BODY, await header(BODY, ts, SECRET), SECRET),
    true,
  );
});

Deno.test("rejects a missing header", async () => {
  assertEquals(await verifySignature(BODY, null, SECRET), false);
});

Deno.test("rejects a header without the v=,d= shape", async () => {
  const now = Date.now();
  const bare = await signPayload(BODY, now, SECRET);
  assertEquals(await verifySignature(BODY, bare, SECRET), false);
});

Deno.test("rejects a stale timestamp (replay)", async () => {
  const ts = Date.now() - (SIGNATURE_MAX_AGE_MS + 60_000);
  assertEquals(
    await verifySignature(BODY, await header(BODY, ts, SECRET), SECRET),
    false,
  );
});

Deno.test("rejects a signature minted with the wrong key", async () => {
  const now = Date.now();
  assertEquals(
    await verifySignature(BODY, await header(BODY, now, "key_wrong"), SECRET),
    false,
  );
});

Deno.test("rejects a tampered body", async () => {
  const now = Date.now();
  const sig = await header(BODY, now, SECRET);
  const tampered = BODY.replace("+13159076170", "+19998887777");
  assertEquals(await verifySignature(tampered, sig, SECRET), false);
});

Deno.test("rejects a tampered timestamp with an otherwise valid digest", async () => {
  const now = Date.now();
  const digest = await signPayload(BODY, now, SECRET);
  const forged = `v=${now + 1000},d=${digest}`;
  assertEquals(await verifySignature(BODY, forged, SECRET), false);
});
