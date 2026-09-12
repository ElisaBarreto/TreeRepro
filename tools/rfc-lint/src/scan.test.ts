import { describe, expect, it } from 'vitest';
import { findExports, parseRfcTags } from './scan.ts';

describe('RFC-00 R4 findExports', () => {
  it('finds named exports with their JSDoc', () => {
    const src = [
      '/** @rfc RFC-10 R1 */',
      'export function alpha() {}',
      '',
      '/**',
      ' * Multi-line.',
      ' * @rfc RFC-11 R2-R3',
      ' */',
      'export const beta = 1;',
      'export class Gamma {}',
      'export default function () {}',
      'export async function* delta() {}',
    ].join('\n');
    const sites = findExports(src);
    expect(sites.map((s) => [s.name, s.line, s.doc !== null])).toEqual([
      ['alpha', 2, true],
      ['beta', 8, true],
      ['Gamma', 9, false],
      ['default', 10, false],
      ['delta', 11, false],
    ]);
  });

  it('ignores type-only exports and re-exports', () => {
    const src = [
      'export type A = string;',
      'export interface B {}',
      'export { x } from "./x.ts";',
      'export * from "./y.ts";',
      'export declare const z: number;',
    ].join('\n');
    expect(findExports(src)).toEqual([]);
  });

  it('reports export lines it cannot parse instead of skipping them', () => {
    const src = [
      '/** @rfc RFC-10 R1 */',
      'export abstract class Base {}',
      'export const { a, b } = pair;',
      'export enum Color { Red }',
    ].join('\n');
    expect(findExports(src).map((s) => [s.name, s.line, s.doc !== null])).toEqual([
      ['<unparsed export>', 2, true],
      ['<unparsed export>', 3, false],
      ['<unparsed export>', 4, false],
    ]);
  });

  it('does not accept a plain block comment as JSDoc', () => {
    const src = ['/* @rfc RFC-10 R1 */', 'export const a = 1;'].join('\n');
    expect(findExports(src)[0]?.doc).toBeNull();
  });

  it('requires the JSDoc to end on the line directly above', () => {
    const src = ['/** @rfc RFC-10 R1 */', '', 'export const a = 1;'].join('\n');
    expect(findExports(src)[0]?.doc).toBeNull();
  });
});

describe('RFC-00 R4 parseRfcTags', () => {
  it('parses a single rfc without rules', () => {
    expect(parseRfcTags('/** @rfc RFC-10 */')).toEqual([{ rfc: 10, rules: [], trailing: '' }]);
  });

  it('parses rule lists and ranges', () => {
    expect(parseRfcTags('/** @rfc RFC-22 R3-R5, R7 */')).toEqual([
      { rfc: 22, rules: [3, 4, 5, 7], trailing: '' },
    ]);
  });

  it('parses several tags', () => {
    const doc = ['/**', ' * @rfc RFC-10 R1', ' * @rfc RFC-11 R2', ' */'].join('\n');
    expect(parseRfcTags(doc).map((t) => t.rfc)).toEqual([10, 11]);
  });

  it('reports trailing garbage after the rules', () => {
    expect(parseRfcTags('/** @rfc RFC-10 R1, RFC-11 R2 */')[0]?.trailing).toBe(', RFC-11 R2');
  });
});
