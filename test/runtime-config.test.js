import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  launchReadiness,
  publicRuntimeInfo,
  runtimeSettingsMutable,
  validateProductionConfig,
} from '../lib/runtime-config.js';

const validProduction = {
  NODE_ENV: 'production',
  LLM_PROVIDER: 'openai',
  OPENAI_API_KEY: 'server-only-key',
  OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
  OPENAI_MODEL: 'deepseek-chat',
  API_TOKEN: 'preview-token',
  ALLOW_RUNTIME_SETTINGS: 'false',
  OLLAMA_FALLBACK: 'false',
};

describe('production runtime config', () => {
  it('accepts a locked cloud preview configuration', () => {
    assert.deepEqual(validateProductionConfig(validProduction), []);
  });

  it('rejects missing secrets and unsafe switches', () => {
    const errors = validateProductionConfig({
      NODE_ENV: 'production',
      LLM_PROVIDER: 'mock',
      OPENAI_BASE_URL: 'http://example.com',
      ALLOW_RUNTIME_SETTINGS: 'true',
      OLLAMA_FALLBACK: 'true',
    });

    assert.ok(errors.length >= 5);
    assert.ok(errors.some((error) => error.includes('OPENAI_API_KEY')));
  });

  it('locks runtime settings in production by default', () => {
    assert.equal(runtimeSettingsMutable({ NODE_ENV: 'development' }), true);
    assert.equal(runtimeSettingsMutable({ NODE_ENV: 'production' }), false);
  });

  it('exposes only non-secret runtime metadata', () => {
    assert.deepEqual(publicRuntimeInfo(validProduction), {
      environment: 'production',
      runtimeSettingsMutable: false,
      authMode: 'account-session',
    });
  });

  it('reports external launch blockers without exposing secrets', () => {
    const result = launchReadiness({
      ...validProduction,
      PUBLIC_BASE_URL: 'https://claudio.example',
      EMAIL_VERIFICATION_REQUIRED: 'true',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      EMAIL_FROM: 'hello@example.com',
      MONITORING_DSN: 'configured',
    });
    assert.equal(result.ready, false);
    assert.deepEqual(result.blockers, ['checkoutConnected']);
  });

  it('accepts a complete mainland China payment channel', () => {
    const result = launchReadiness({
      ...validProduction,
      PUBLIC_BASE_URL: 'https://claudio.example',
      EMAIL_VERIFICATION_REQUIRED: 'true',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      EMAIL_FROM: 'hello@example.com',
      MONITORING_DSN: 'configured',
      ALIPAY_APP_ID: 'app',
      ALIPAY_PRIVATE_KEY: 'private',
      ALIPAY_PUBLIC_KEY: 'public',
      ALIPAY_NOTIFY_URL: 'https://claudio.example/api/payments/alipay/notify',
    });
    assert.equal(result.ready, true);
    assert.deepEqual(result.blockers, []);
  });
});
