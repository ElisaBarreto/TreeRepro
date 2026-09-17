import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** The version the outbound `User-Agent` carries. @rfc RFC-80 R2 */
export const APP_VERSION: string = require('../package.json').version;
