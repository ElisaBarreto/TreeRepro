import { randomInt } from 'node:crypto';
import { isValidIsbn } from '@treerepro/contracts';

/**
 * A random, valid ISBN-13 with the 978 prefix, so tests sharing one database
 * never collide on the unique `isbn`.
 * @rfc RFC-61 R10
 */
export function randomIsbn(): string {
  const stem = `978${randomInt(0, 1_000_000_000).toString().padStart(9, '0')}`;
  for (let digit = 0; digit < 10; digit += 1) {
    const isbn = isValidIsbn(`${stem}${digit}`);
    if (isbn) return isbn;
  }
  throw new Error('randomIsbn: no check digit fits');
}
