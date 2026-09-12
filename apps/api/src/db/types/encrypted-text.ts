import { customType } from 'drizzle-orm/pg-core';
import { getPii } from '../../security/pii.ts';

/**
 * A `text` column holding an RFC-40 ciphertext. The qualified column name is
 * the AEAD additional data, so a value copied into another column or table
 * fails to decrypt. Never use the column in a WHERE clause (RFC-40 R11).
 * @rfc RFC-40 R2, R8, R11
 */
export function encryptedText(table: string, column: string) {
  const aad = `${table}.${column}`;
  return customType<{ data: string; driverData: string }>({
    dataType() {
      return 'text';
    },
    toDriver(value) {
      return getPii().encrypt(value, aad);
    },
    fromDriver(value) {
      return getPii().decrypt(value, aad);
    },
  })(column);
}
