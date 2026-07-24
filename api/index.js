import { createHandler } from '../src/app.js';
import { loadConfig } from '../src/config.js';

// Module scope is reused by warm serverless instances, preserving bounded cache
// and limiter state between invocations handled by the same instance.
export default createHandler(loadConfig());
