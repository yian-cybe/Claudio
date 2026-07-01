import { assertProductionConfig, publicRuntimeInfo } from '../lib/runtime-config.js';

assertProductionConfig();
console.log('Production configuration is valid.');
console.log(JSON.stringify(publicRuntimeInfo(), null, 2));
