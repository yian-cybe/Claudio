import { createSign, createVerify } from 'node:crypto';

const METHOD = 'alipay.trade.precreate';

function pem(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

function formatAlipayTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

export function configured(env = process.env) {
  return [
    'ALIPAY_APP_ID',
    'ALIPAY_PRIVATE_KEY',
    'ALIPAY_PUBLIC_KEY',
    'ALIPAY_NOTIFY_URL',
  ].every((key) => !!env[key]);
}

export function canonicalize(params) {
  return Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && key !== 'sign_type' && value !== '' && value != null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

export function signParams(params, privateKey) {
  const signer = createSign('RSA-SHA256');
  signer.update(canonicalize(params), 'utf8');
  signer.end();
  return signer.sign(pem(privateKey), 'base64');
}

export function verifyNotification(params, publicKey) {
  if (!params?.sign || !publicKey) return false;
  const verifier = createVerify('RSA-SHA256');
  verifier.update(canonicalize(params), 'utf8');
  verifier.end();
  return verifier.verify(pem(publicKey), String(params.sign), 'base64');
}

export async function createPrecreatePayment(order, {
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  if (!configured(env)) throw new Error('Alipay is not configured');
  const params = {
    app_id: env.ALIPAY_APP_ID,
    method: METHOD,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: formatAlipayTime(now),
    version: '1.0',
    notify_url: env.ALIPAY_NOTIFY_URL,
    biz_content: JSON.stringify({
      out_trade_no: order.outTradeNo,
      total_amount: (order.amountFen / 100).toFixed(2),
      subject: 'Claudio Pro 30 天',
      timeout_express: '30m',
    }),
  };
  params.sign = signParams(params, env.ALIPAY_PRIVATE_KEY);
  const response = await fetchImpl(
    env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params),
    }
  );
  const result = await response.json().catch(() => ({}));
  const payload = result.alipay_trade_precreate_response;
  if (!response.ok || payload?.code !== '10000' || !payload.qr_code) {
    throw new Error(payload?.sub_msg || payload?.msg || `Alipay request failed (${response.status})`);
  }
  return { qrContent: payload.qr_code };
}
