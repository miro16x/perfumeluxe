// Server-side only: RESEND_API_KEY is supplied by the Worker secret binding.
export async function sendEmail(env, { from, to, replyTo, ...content }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...content,
      from: typeof from === 'string' ? from : `${from.name} <${from.email}>`,
      to: Array.isArray(to) ? to : [to],
      reply_to: replyTo
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    const error = new Error(`Resend rejected email (HTTP ${response.status}).`);
    error.code = response.ok ? 'RESEND_INVALID_RESPONSE' : `RESEND_HTTP_${response.status}`;
    // Log only the provider error type, never request headers or the API key.
    error.providerError = result?.name;
    throw error;
  }
  return { messageId: result.id };
}
