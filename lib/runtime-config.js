const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

export function runtimeSettingsMutable(env = process.env) {
  if (env.ALLOW_RUNTIME_SETTINGS !== undefined) {
    return TRUE_VALUES.has(String(env.ALLOW_RUNTIME_SETTINGS).toLowerCase());
  }
  return !isProduction(env);
}

export function publicRuntimeInfo(env = process.env) {
  return {
    environment: env.NODE_ENV || 'development',
    runtimeSettingsMutable: runtimeSettingsMutable(env),
    authMode: isProduction(env) ? 'account-session' : 'development-guest',
  };
}

export function validateProductionConfig(env = process.env) {
  if (!isProduction(env)) return [];

  const errors = [];
  const provider = String(env.LLM_PROVIDER || '').toLowerCase();
  const baseURL = String(env.OPENAI_BASE_URL || '');

  if (provider !== 'openai') errors.push('LLM_PROVIDER must be openai for the Day 01 cloud preview');
  if (!env.OPENAI_API_KEY) errors.push('OPENAI_API_KEY is required');
  if (!baseURL.startsWith('https://')) errors.push('OPENAI_BASE_URL must use HTTPS');
  if (!env.OPENAI_MODEL) errors.push('OPENAI_MODEL is required');
  if (runtimeSettingsMutable(env)) errors.push('ALLOW_RUNTIME_SETTINGS must be false in production');
  if (String(env.OLLAMA_FALLBACK).toLowerCase() === 'true') {
    errors.push('OLLAMA_FALLBACK must be false in cloud production');
  }

  return errors;
}

export function assertProductionConfig(env = process.env) {
  const errors = validateProductionConfig(env);
  if (errors.length) {
    throw new Error(`Production configuration is invalid:\n- ${errors.join('\n- ')}`);
  }
}

export function launchReadiness(env = process.env) {
  const emailDeliveryConfigured = !!(
    env.SMTP_HOST
    && env.SMTP_USER
    && env.SMTP_PASS
    && env.EMAIL_FROM
  );
  const wechatPayConfigured = [
    'WECHAT_PAY_MCH_ID',
    'WECHAT_PAY_APP_ID',
    'WECHAT_PAY_CERT_SERIAL',
    'WECHAT_PAY_PRIVATE_KEY',
    'WECHAT_PAY_API_V3_KEY',
    'WECHAT_PAY_PUBLIC_KEY',
    'WECHAT_PAY_NOTIFY_URL',
  ].every((key) => !!env[key]);
  const alipayConfigured = [
    'ALIPAY_APP_ID',
    'ALIPAY_PRIVATE_KEY',
    'ALIPAY_PUBLIC_KEY',
    'ALIPAY_NOTIFY_URL',
  ].every((key) => !!env[key]);
  const checks = {
    productionConfig: validateProductionConfig(env).length === 0,
    publicBaseUrl: String(env.PUBLIC_BASE_URL || '').startsWith('https://'),
    emailVerificationRequired: env.EMAIL_VERIFICATION_REQUIRED === 'true',
    emailDeliveryConfigured,
    checkoutConnected: wechatPayConfigured || alipayConfigured,
    monitoringConfigured: !!env.MONITORING_DSN,
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    blockers: Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name),
  };
}
