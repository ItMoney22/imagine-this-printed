// Copied verbatim from Darrell V2 src/lib/phone-agent-token.ts, the shared voice
// bridge's reference contract (client-phone-system skill). Change it there first.
import { createHmac, timingSafeEqual } from "crypto";

// No `server-only` import on purpose, matching src/lib/merch/webhook.ts: this is
// pure crypto with no Supabase or Next coupling, and it guards money and a live
// phone line, so it must be unit-testable. It reads PHONE_AGENT_SECRET lazily
// and is never imported from a client component.

/**
 * Call-scoped tokens for the shared voice bridge.
 *
 * The bridge is multi-tenant: one Fly app answers the phone for every client
 * MetaSphere hosts. It must therefore hold NO client secrets — a bridge that
 * knew every site's key would turn one compromised host into every client's
 * problem.
 *
 * Instead, each site mints a token when it builds the TwiML for a specific
 * call, and the bridge simply presents that token back when it asks the site
 * for the persona, runs a tool, or reports minutes. The bridge cannot forge
 * one, cannot reuse one on a different call, and cannot use one tomorrow.
 *
 * Format: base64url(payload).base64url(hmac-sha256(payload, PHONE_AGENT_SECRET))
 */

const TOKEN_TTL_SECONDS = 45 * 60; // the 20-minute call ceiling plus slack

interface CallTokenPayload {
  /** The Twilio call this token is good for, and only this one. */
  sid: string;
  /** Unix seconds. */
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function secret(): string {
  const value = process.env.PHONE_AGENT_SECRET;
  // Fail closed. An unset secret must never mean "everything verifies".
  if (!value) throw new Error("PHONE_AGENT_SECRET is not configured");
  return value;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

/** Mint a token good only for this call, for the next 45 minutes. */
export function mintCallToken(callSid: string): string {
  const payload: CallTokenPayload = {
    sid: callSid,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export type CallTokenResult =
  | { ok: true; callSid: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_call" | "unconfigured" };

/**
 * Verify a token and, when `expectedCallSid` is given, that it belongs to that
 * call. Binding to the call is what stops a leaked token being replayed against
 * someone else's conversation.
 */
export function verifyCallToken(
  token: string | null | undefined,
  expectedCallSid?: string | null,
): CallTokenResult {
  if (!token || typeof token !== "string") return { ok: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, signature] = parts;

  let expected: string;
  try {
    expected = sign(payloadB64);
  } catch {
    return { ok: false, reason: "unconfigured" };
  }

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: CallTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.sid !== "string" || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (payload.exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  if (expectedCallSid && payload.sid !== expectedCallSid) {
    return { ok: false, reason: "wrong_call" };
  }

  return { ok: true, callSid: payload.sid };
}

/**
 * Authorize a request from the bridge.
 *
 * Accepts EITHER a call token (multi-tenant, preferred) or the legacy static
 * shared secret. The static path is kept so a bridge and a site can be deployed
 * in either order without a window where the phone is broken; it can be removed
 * once every client is on tokens.
 */
export function authorizeAgentRequest(
  headers: { get(name: string): string | null },
  callSid?: string | null,
): { ok: true; via: "token" | "static" } | { ok: false; reason: string } {
  const token = headers.get("x-phone-call-token");
  if (token) {
    const result = verifyCallToken(token, callSid);
    return result.ok ? { ok: true, via: "token" } : { ok: false, reason: result.reason };
  }

  const presented = headers.get("x-phone-agent-secret");
  if (!presented) return { ok: false, reason: "missing_credentials" };
  let expected: string;
  try {
    expected = secret();
  } catch {
    return { ok: false, reason: "unconfigured" };
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_secret" };
  }
  return { ok: true, via: "static" };
}
