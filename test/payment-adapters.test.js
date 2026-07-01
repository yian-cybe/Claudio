import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCipheriv,
  generateKeyPairSync,
} from 'node:crypto';
import {
  canonicalize,
  createPrecreatePayment,
  signParams,
  verifyNotification,
} from '../lib/payments/alipay.js';
import {
  buildRequestMessage,
  createAuthorization,
  createNativePayment,
  decryptResource,
  verifyCallbackSignature,
} from '../lib/payments/wechat.js';

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const order = {
  outTradeNo: 'CL202606220000001234567890',
  amountFen: 2900,
  currency: 'CNY',
};

describe('WeChat Pay adapter', () => {
  it('creates and verifies API v3 RSA signatures', () => {
    const body = JSON.stringify({ test: true });
    const auth = createAuthorization({
      method: 'POST',
      path: '/v3/test',
      body,
      mchId: '1900000001',
      serialNo: 'SERIAL',
      privateKey: keys.privateKey,
      timestamp: 1234567890,
      nonce: 'fixed-nonce',
    });
    assert.match(auth.authorization, /^WECHATPAY2-SHA256-RSA2048 /);
    assert.equal(verifyCallbackSignature({
      rawBody: Buffer.from(body),
      timestamp: '1234567890',
      nonce: 'fixed-nonce',
      signature: createAuthorization({
        method: 'POST',
        path: '/v3/test',
        body,
        mchId: '1900000001',
        serialNo: 'SERIAL',
        privateKey: keys.privateKey,
        timestamp: 1234567890,
        nonce: 'fixed-nonce',
      }).signature,
      publicKey: keys.publicKey,
    }), false);
    assert.match(buildRequestMessage({
      method: 'post',
      path: '/v3/test',
      timestamp: 1,
      nonce: 'n',
      body: '{}',
    }), /^POST\n/);
  });

  it('verifies callback messages and decrypts AES-256-GCM resources', async () => {
    const rawBody = Buffer.from('{"event_type":"TRANSACTION.SUCCESS"}');
    const callbackMessage = `1710000000\ncallback-nonce\n${rawBody.toString('utf8')}\n`;
    const signature = signParams({ message: callbackMessage }, keys.privateKey);
    const directSigner = await import('node:crypto').then(({ createSign }) => createSign('RSA-SHA256'));
    directSigner.update(callbackMessage);
    directSigner.end();
    const callbackSignature = directSigner.sign(keys.privateKey, 'base64');
    assert.equal(verifyCallbackSignature({
      rawBody,
      timestamp: '1710000000',
      nonce: 'callback-nonce',
      signature: callbackSignature,
      publicKey: keys.publicKey,
    }), true);
    assert.ok(signature);

    const apiV3Key = '12345678901234567890123456789012';
    const nonce = '123456789012';
    const associatedData = 'transaction';
    const plaintext = JSON.stringify({ trade_state: 'SUCCESS', amount: { total: 2900 } });
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
    cipher.setAAD(Buffer.from(associatedData));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
    assert.deepEqual(decryptResource({
      algorithm: 'AEAD_AES_256_GCM',
      nonce,
      associated_data: associatedData,
      ciphertext,
    }, apiV3Key), JSON.parse(plaintext));
  });

  it('submits fixed server order data to Native payment', async () => {
    let captured;
    const result = await createNativePayment(order, {
      env: {
        WECHAT_PAY_MCH_ID: '1900000001',
        WECHAT_PAY_APP_ID: 'wx-app',
        WECHAT_PAY_CERT_SERIAL: 'SERIAL',
        WECHAT_PAY_PRIVATE_KEY: keys.privateKey,
        WECHAT_PAY_API_V3_KEY: '12345678901234567890123456789012',
        WECHAT_PAY_PUBLIC_KEY: keys.publicKey,
        WECHAT_PAY_NOTIFY_URL: 'https://example.com/wechat',
      },
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return { ok: true, status: 200, json: async () => ({ code_url: 'weixin://test' }) };
      },
    });
    assert.equal(result.qrContent, 'weixin://test');
    assert.equal(JSON.parse(captured.options.body).amount.total, 2900);
  });
});

describe('Alipay adapter', () => {
  it('canonicalizes, signs, and verifies RSA2 notifications', () => {
    const params = {
      app_id: 'app',
      out_trade_no: order.outTradeNo,
      trade_status: 'TRADE_SUCCESS',
      total_amount: '29.00',
      sign_type: 'RSA2',
    };
    params.sign = signParams(params, keys.privateKey);
    assert.equal(verifyNotification(params, keys.publicKey), true);
    assert.equal(verifyNotification({ ...params, total_amount: '0.01' }, keys.publicKey), false);
    assert.equal(canonicalize(params).includes('sign='), false);
  });

  it('submits a fixed 29.00 yuan precreate request', async () => {
    let submitted;
    const result = await createPrecreatePayment(order, {
      env: {
        ALIPAY_APP_ID: 'app',
        ALIPAY_PRIVATE_KEY: keys.privateKey,
        ALIPAY_PUBLIC_KEY: keys.publicKey,
        ALIPAY_NOTIFY_URL: 'https://example.com/alipay',
      },
      now: new Date('2026-06-22T00:00:00.000Z'),
      fetchImpl: async (_url, options) => {
        submitted = Object.fromEntries(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            alipay_trade_precreate_response: { code: '10000', qr_code: 'https://qr.alipay.com/test' },
          }),
        };
      },
    });
    const biz = JSON.parse(submitted.biz_content);
    assert.equal(result.qrContent, 'https://qr.alipay.com/test');
    assert.equal(biz.total_amount, '29.00');
    assert.equal(biz.out_trade_no, order.outTradeNo);
  });
});
