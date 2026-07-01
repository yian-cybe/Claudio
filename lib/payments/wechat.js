import {
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
} from 'node:crypto';

const NATIVE_PATH = '/v3/pay/transactions/native';

function pem(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

export function configured(env = process.env) {
  return [
    'WECHAT_PAY_MCH_ID',
    'WECHAT_PAY_APP_ID',
    'WECHAT_PAY_CERT_SERIAL',
    'WECHAT_PAY_PRIVATE_KEY',
    'WECHAT_PAY_API_V3_KEY',
    'WECHAT_PAY_PUBLIC_KEY',
    'WECHAT_PAY_NOTIFY_URL',
  ].every((key) => !!env[key]);
}

export function buildRequestMessage({ method, path, timestamp, nonce, body = '' }) {
  return `${String(method).toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
}

export function createAuthorization({
  method,
  path,
  body = '',
  mchId,
  serialNo,
  privateKey,
  timestamp = Math.floor(Date.now() / 1000),
  nonce = randomBytes(16).toString('hex'),
}) {
  const message = buildRequestMessage({ method, path, timestamp, nonce, body });
  const signer = createSign('RSA-SHA256');
  signer.update(message);
  signer.end();
  const signature = signer.sign(pem(privateKey), 'base64');
  return {
    timestamp: String(timestamp),
    nonce,
    signature,
    authorization: 'WECHATPAY2-SHA256-RSA2048 '
      + `mchid="${mchId}",nonce_str="${nonce}",signature="${signature}",`
      + `timestamp="${timestamp}",serial_no="${serialNo}"`,
  };
}

export function verifyCallbackSignature({
  rawBody,
  timestamp,
  nonce,
  signature,
  publicKey,
}) {
  if (!rawBody || !timestamp || !nonce || !signature || !publicKey) return false;
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${timestamp}\n${nonce}\n${Buffer.from(rawBody).toString('utf8')}\n`);
  verifier.end();
  return verifier.verify(pem(publicKey), String(signature), 'base64');
}

export function decryptResource(resource, apiV3Key) {
  if (resource?.algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error('unsupported WeChat resource algorithm');
  }
  const key = Buffer.from(String(apiV3Key || ''), 'utf8');
  if (key.length !== 32) throw new Error('WeChat API v3 key must be 32 bytes');
  const encrypted = Buffer.from(String(resource.ciphertext || ''), 'base64');
  if (encrypted.length < 17) throw new Error('invalid WeChat ciphertext');
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

export async function createNativePayment(order, {
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  if (!configured(env)) throw new Error('WeChat Pay is not configured');
  const payload = {
    appid: env.WECHAT_PAY_APP_ID,
    mchid: env.WECHAT_PAY_MCH_ID,
    description: 'Claudio Pro 30 天',
    out_trade_no: order.outTradeNo,
    notify_url: env.WECHAT_PAY_NOTIFY_URL,
    amount: {
      total: order.amountFen,
      currency: order.currency,
    },
  };
  const body = JSON.stringify(payload);
  const auth = createAuthorization({
    method: 'POST',
    path: NATIVE_PATH,
    body,
    mchId: env.WECHAT_PAY_MCH_ID,
    serialNo: env.WECHAT_PAY_CERT_SERIAL,
    privateKey: env.WECHAT_PAY_PRIVATE_KEY,
  });
  const response = await fetchImpl(`https://api.mch.weixin.qq.com${NATIVE_PATH}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: auth.authorization,
      'User-Agent': 'Claudio/0.1.0',
    },
    body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.code_url) {
    throw new Error(result.message || `WeChat Pay request failed (${response.status})`);
  }
  return { qrContent: result.code_url };
}
