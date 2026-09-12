import { customType } from 'drizzle-orm/pg-core';
import { getPii } from '../../security/pii.ts';

/** @rfc RFC-40 R8 */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value) {
    return getPii().encrypt(value);
  },
  fromDriver(value) {
    return getPii().decrypt(value);
  },
});
