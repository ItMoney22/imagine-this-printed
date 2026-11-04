/**
 * Request logs land in the host's log store in plain text, so a header that carries a credential must
 * never reach them. Task f2cadac6: the print-bridge token, shopper session tokens and cookies all did.
 *
 * Name a header here when the API starts reading a credential or signature from it. The test fails if
 * backend code reads a secret-shaped header this list does not name.
 */
export const SECRET_REQUEST_HEADERS = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-internal-secret',
  'x-webhook-secret',
  'x-health-probe-token',
  'stripe-signature',
  'svix-signature',
  'x-replicate-signature'
]

export const LOG_REDACT = {
  paths: [...SECRET_REQUEST_HEADERS.map(name => `req.headers["${name}"]`), 'res.headers["set-cookie"]'],
  censor: '[redacted]'
}
