import { launchReadiness } from '../lib/runtime-config.js';
import { verifyConnection } from '../lib/email.js';

const result = launchReadiness();
if (result.checks.emailDeliveryConfigured) {
  const email = await verifyConnection();
  result.checks.emailDeliveryConnected = email.ok;
  if (!email.ok) result.blockers.push('emailDeliveryConnected');
}
result.ready = result.blockers.length === 0;
console.log(JSON.stringify(result, null, 2));
if (!result.ready) {
  console.error(`Launch blocked: ${result.blockers.join(', ')}`);
  process.exitCode = 1;
}
