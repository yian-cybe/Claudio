import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { config, verificationMessage, verificationUrl } from '../lib/email.js';

const env = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'user',
  SMTP_PASS: 'password',
  EMAIL_FROM: 'Claudio <hello@example.com>',
  PUBLIC_BASE_URL: 'https://claudio.example/',
};

describe('email delivery configuration', () => {
  it('requires all SMTP delivery settings', () => {
    assert.equal(config(env).configured, true);
    assert.equal(config({ SMTP_HOST: 'smtp.example.com' }).configured, false);
  });

  it('builds an encoded public verification URL', () => {
    assert.equal(
      verificationUrl('token value', env),
      'https://claudio.example/?verify=token%20value'
    );
  });

  it('builds verification mail without exposing SMTP credentials', () => {
    const message = verificationMessage({ email: 'user@example.com', token: 'secret-token' }, env);
    assert.equal(message.to, 'user@example.com');
    assert.match(message.text, /https:\/\/claudio\.example\/\?verify=secret-token/);
    assert.equal(JSON.stringify(message).includes(env.SMTP_PASS), false);
  });
});

