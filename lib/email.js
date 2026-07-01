import nodemailer from 'nodemailer';

let transport = null;

export function config(env = process.env) {
  const port = Number(env.SMTP_PORT) || 587;
  return {
    configured: !!(
      env.SMTP_HOST
      && env.SMTP_USER
      && env.SMTP_PASS
      && env.EMAIL_FROM
      && env.PUBLIC_BASE_URL
    ),
    host: env.SMTP_HOST || '',
    port,
    secure: env.SMTP_SECURE === 'true' || port === 465,
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.EMAIL_FROM || '',
    publicBaseUrl: String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  };
}

function getTransport() {
  const current = config();
  if (!current.configured) throw new Error('email delivery not configured');
  if (!transport) {
    transport = nodemailer.createTransport({
      host: current.host,
      port: current.port,
      secure: current.secure,
      auth: { user: current.user, pass: current.pass },
    });
  }
  return transport;
}

export function verificationUrl(token, env = process.env) {
  const current = config(env);
  if (!current.publicBaseUrl) throw new Error('PUBLIC_BASE_URL required');
  return `${current.publicBaseUrl}/?verify=${encodeURIComponent(token)}`;
}

export function verificationMessage({ email, token }, env = process.env) {
  const current = config(env);
  const url = verificationUrl(token, env);
  return {
    from: current.from,
    to: email,
    subject: 'Verify your Claudio account',
    text: `Open this link to verify your Claudio account:\n\n${url}\n\nThis link expires in 24 hours.`,
    html: `<p>Open this link to verify your Claudio account:</p><p><a href="${url}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  };
}

export async function sendVerificationEmail({ email, token }) {
  return getTransport().sendMail(verificationMessage({ email, token }));
}

export async function verifyConnection() {
  if (!config().configured) return { ok: false, error: 'email delivery not configured' };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function resetTransport() {
  transport = null;
}

