// Server-side only: CANCEL_SIGNING_SECRET is a Worker secret. Never send it to
// the browser. The pickup endpoint signs each order's reference, email, store
// and placement time; the cancellation endpoint only trusts those details
// (in particular placedAt, which decides the 24-hour window) when the
// signature matches, so they can't be edited or invented in the browser.
const encoder = new TextEncoder();

export const cancelSigningEnabled = (env) => Boolean(env.CANCEL_SIGNING_SECRET);

const signingKey = (env, usage) => crypto.subtle.importKey(
  'raw',
  encoder.encode(env.CANCEL_SIGNING_SECRET),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  [usage]
);

/* Fields are validated before signing and can't contain newlines. */
const signedDetails = ({ reference, email, pickupStore, placedAt }) =>
  encoder.encode([reference, String(email).toLowerCase(), pickupStore, placedAt].join('\n'));

const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (value) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

export async function signCancellation(env, details) {
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env, 'sign'), signedDetails(details));
  return toBase64Url(signature);
}

/* crypto.subtle.verify compares in constant time. */
export async function verifyCancellation(env, details, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return crypto.subtle.verify('HMAC', await signingKey(env, 'verify'), fromBase64Url(token), signedDetails(details));
}
