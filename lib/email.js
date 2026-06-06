/**
 * lib/email.js
 * All transactional emails in one place.
 * Uses Resend. Falls back to console.warn if RESEND_API_KEY is not set.
 */

const FROM_DEFAULT    = 'Say HelloLeads <onboarding@sayhelloleads.com>';
const BASE_URL        = () => process.env.NEXTAUTH_URL || 'https://www.sayhelloleads.com';

async function send({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] RESEND_API_KEY not set — skipping: "${subject}" to ${to}`);
    return;
  }
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(key);
    await resend.emails.send({ from: FROM_DEFAULT, to, subject, html });
  } catch (e) {
    console.error('[email] Send error:', e?.message || e);
  }
}

// ── SHARED LAYOUT ──────────────────────────────────────────────────────────

function layout({ preheader = '', body }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ''}
</head>
<body style="margin:0;padding:0;background:#f0f0ec;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0ec;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:540px;">

        <!-- HEADER -->
        <tr><td style="background:#3d6b4a;border-radius:12px 12px 0 0;padding:24px 32px;">
          <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-.3px;">Say HelloLeads</div>
          <div style="font-size:12px;color:rgba(255,255,255,.65);margin-top:3px;">Real estate AI · instant lead response</div>
        </td></tr>

        <!-- BODY -->
        <tr><td style="background:#fff;padding:32px;border-left:1px solid #e2e2dc;border-right:1px solid #e2e2dc;">
          ${body}
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#f7f7f4;border:1px solid #e2e2dc;border-top:none;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center;">
          <p style="font-size:12px;color:#999;margin:0;">
            Say HelloLeads · <a href="${BASE_URL()}" style="color:#999;">sayhelloleads.com</a><br>
            You're receiving this because you created an account.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── VERIFICATION EMAIL ─────────────────────────────────────────────────────

export async function sendVerificationEmail({ email, name, link }) {
  const firstName = (name || 'there').split(' ')[0];

  const html = layout({
    preheader: 'Confirm your email to activate your Say HelloLeads account.',
    body: `
      <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px;">Confirm your email</h1>
      <p style="font-size:15px;color:#555;line-height:1.65;margin:0 0 24px;">
        Hey ${firstName}, one quick step — click the button below to verify your email and activate your account.
        This link expires in <strong>24 hours</strong>.
      </p>

      <div style="text-align:center;margin:28px 0;">
        <a href="${link}" style="display:inline-block;background:#3d6b4a;color:#fff;font-size:15px;font-weight:600;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:-.1px;">
          Verify my email →
        </a>
      </div>

      <div style="background:#f7f7f4;border:1px solid #e2e2dc;border-radius:8px;padding:14px 16px;margin:24px 0 0;">
        <p style="font-size:12px;color:#888;margin:0;line-height:1.6;">
          Button not working? Copy and paste this link into your browser:<br>
          <a href="${link}" style="color:#3d6b4a;word-break:break-all;">${link}</a>
        </p>
      </div>

      <p style="font-size:13px;color:#aaa;margin:20px 0 0;">
        Didn't create an account? You can safely ignore this email.
      </p>
    `,
  });

  await send({
    to: email,
    subject: 'Verify your Say HelloLeads email',
    html,
  });
}

// ── WELCOME EMAIL (sent after verification) ────────────────────────────────

export async function sendWelcomeEmail({ email, name, agentSlug }) {
  const firstName = (name || 'there').split(' ')[0];
  const base      = BASE_URL();
  const agentUrl  = `${base}/agent/${agentSlug}`;

  const html = layout({
    preheader: `Welcome to Say HelloLeads, ${firstName}! Your account is active.`,
    body: `
      <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px;">You're all set, ${firstName}! 🎉</h1>
      <p style="font-size:15px;color:#555;line-height:1.65;margin:0 0 24px;">
        Your Say HelloLeads account is verified and ready. Here's what to do next:
      </p>

      <!-- Public URL card -->
      <div style="border:1.5px solid #c8e0ce;border-radius:10px;overflow:hidden;margin-bottom:24px;">
        <div style="background:#eef5ef;padding:12px 16px;font-size:12px;font-weight:700;color:#3d6b4a;text-transform:uppercase;letter-spacing:.06em;">
          🔗 Your public inquiry page
        </div>
        <div style="background:#fff;padding:14px 16px;font-size:14px;word-break:break-all;">
          <a href="${agentUrl}" style="color:#3d6b4a;font-weight:500;">${agentUrl}</a>
        </div>
        <div style="background:#f7f7f4;padding:10px 16px;font-size:12px;color:#888;">
          Share this on Zillow, your website, yard signs, and business cards.
        </div>
      </div>

      <!-- Steps -->
      <table style="width:100%;margin-bottom:24px;border-collapse:collapse;">
        ${[
          ['1', 'Complete your profile', 'Add your photo, agency name, and notification email.'],
          ['2', 'Share your inquiry page', `Buyers fill out the form and AI responds within 60 seconds.`],
          ['3', 'Connect Zillow / SMS', 'Forward lead notifications from Zillow or add a Twilio number.'],
        ].map(([n, title, desc]) => `
          <tr>
            <td style="vertical-align:top;width:32px;padding:8px 12px 8px 0;">
              <div style="width:28px;height:28px;background:#3d6b4a;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:700;">${n}</div>
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #f0f0ec;">
              <div style="font-size:14px;font-weight:600;color:#111;margin-bottom:2px;">${title}</div>
              <div style="font-size:13px;color:#777;">${desc}</div>
            </td>
          </tr>`).join('')}
      </table>

      <div style="text-align:center;margin:28px 0 0;">
        <a href="${base}" style="display:inline-block;background:#3d6b4a;color:#fff;font-size:15px;font-weight:600;padding:14px 36px;border-radius:8px;text-decoration:none;">
          Go to my dashboard →
        </a>
      </div>
    `,
  });

  await send({
    to: email,
    subject: `Welcome to Say HelloLeads, ${firstName}! Your account is active`,
    html,
  });
}

// ── PASSWORD RESET EMAIL ───────────────────────────────────────────────────

export async function sendPasswordResetEmail({ email, name, resetUrl }) {
  const firstName = (name || 'there').split(' ')[0];

  const html = layout({
    preheader: 'Reset your Say HelloLeads password. Link expires in 1 hour.',
    body: `
      <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px;">Reset your password</h1>
      <p style="font-size:15px;color:#555;line-height:1.65;margin:0 0 24px;">
        Hey ${firstName}, we received a request to reset your password.
        Click the button below — this link expires in <strong>1 hour</strong>.
      </p>

      <div style="text-align:center;margin:28px 0;">
        <a href="${resetUrl}" style="display:inline-block;background:#3d6b4a;color:#fff;font-size:15px;font-weight:600;padding:14px 36px;border-radius:8px;text-decoration:none;">
          Reset my password →
        </a>
      </div>

      <div style="background:#f7f7f4;border:1px solid #e2e2dc;border-radius:8px;padding:14px 16px;margin:24px 0 0;">
        <p style="font-size:12px;color:#888;margin:0;line-height:1.6;">
          Button not working? Copy and paste this link:<br>
          <a href="${resetUrl}" style="color:#3d6b4a;word-break:break-all;">${resetUrl}</a>
        </p>
      </div>

      <p style="font-size:13px;color:#aaa;margin:20px 0 0;">
        Didn't request this? Your password won't change — you can safely ignore this email.
      </p>
    `,
  });

  await send({
    to: email,
    subject: 'Reset your Say HelloLeads password',
    html,
  });
}
