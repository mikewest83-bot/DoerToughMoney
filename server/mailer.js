// Transactional email for DoerToughMoney.
//
// Resend's HTTP API over plain fetch — no new dependency to add to the deploy.
// Nothing in here throws into a request path: a send failure is logged and
// reported in the return value, so a caller can still answer with the neutral
// response its own security model requires.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

// Reply-To, and the fallback From identity. Must be a domain verified in
// Resend for sending, or every send 403s.
const supportEmail = () => process.env.SUPPORT_EMAIL || "support@doertough.com";
const mailFrom = () => process.env.MAIL_FROM || `DoerToughMoney <${supportEmail()}>`;

// True when a mail provider is wired up. Routes surface this rather than
// pretending a send happened.
export const mailConfigured = () => !!process.env.RESEND_API_KEY;

export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) {
    console.warn("[mailer] RESEND_API_KEY is not set — nothing sent.");
    return { sent: false, reason: "not_configured" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: mailFrom(),
        to: [to],
        reply_to: supportEmail(),
        subject,
        text,
        ...(html ? { html } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Deliberately not logging the body — it can echo the recipient address.
      console.error(`[mailer] Resend rejected the send (${response.status}).`);
      return { sent: false, reason: `http_${response.status}` };
    }

    return { sent: true };
  } catch (error) {
    console.error("[mailer] send failed:", error.message);
    return { sent: false, reason: "exception" };
  }
}

// The reset link points at the one origin the app is served from — the same
// value webauthn and CORS key off, so it can never drift to a second host.
export const resetUrl = (token) =>
  `${(process.env.WEB_ORIGIN || "").replace(/\/+$/, "")}/reset?token=${encodeURIComponent(token)}`;

export function sendPasswordResetEmail({ to, name, token, ttlMinutes }) {
  const url = resetUrl(token);
  const greeting = name ? `Hi ${name},` : "Hi,";

  const text = [
    greeting,
    "",
    "Someone asked to reset the password on your DoerToughMoney account.",
    "",
    `Open this link to choose a new one: ${url}`,
    "",
    `The link works once and expires in ${ttlMinutes} minutes.`,
    "",
    "If this wasn't you, ignore this email — your password stays as it is.",
    "",
    "— DoerToughMoney",
  ].join("\n");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#16151A">
      <p>${greeting}</p>
      <p>Someone asked to reset the password on your DoerToughMoney account.</p>
      <p><a href="${url}" style="display:inline-block;background:#12A150;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600">Choose a new password</a></p>
      <p style="color:#5c5c66">The link works once and expires in ${ttlMinutes} minutes.</p>
      <p style="color:#5c5c66">If this wasn't you, ignore this email — your password stays as it is.</p>
      <p style="color:#5c5c66">— DoerToughMoney</p>
    </div>`;

  return sendMail({ to, subject: "Reset your DoerToughMoney password", text, html });
}
