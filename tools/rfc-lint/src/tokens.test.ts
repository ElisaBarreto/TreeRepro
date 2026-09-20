import { describe, expect, it } from 'vitest';
import { tokenize } from './tokens.ts';

const kinds = (src: string) => tokenize(src).map((t) => `${t.kind}:${'value' in t ? t.value : ''}`);

describe('RFC-32 R8 tokenize', () => {
  it('splits identifiers, strings, numbers and punctuation', () => {
    expect(kinds("has(me, 'a.b', 12)")).toEqual([
      'ident:has',
      'punct:(',
      'ident:me',
      'punct:,',
      'string:a.b',
      'punct:,',
      'number:12',
      'punct:)',
    ]);
  });

  it('drops comments and keeps line numbers', () => {
    const src = "a // 'x'\n/* 'y'\n */ b\n'z'";
    expect(tokenize(src).map((t) => [t.kind, 'value' in t ? t.value : '', t.line])).toEqual([
      ['ident', 'a', 1],
      ['ident', 'b', 3],
      ['string', 'z', 4],
    ]);
  });

  it('keeps a string opaque: nothing inside it is a token', () => {
    expect(kinds(`"has('a.b')" + 'x // y' + "it\\"s"`)).toEqual([
      "string:has('a.b')",
      'punct:+',
      'string:x // y',
      'punct:+',
      'string:it\\"s',
    ]);
  });

  it('keeps a template literal opaque, expressions and nested templates included', () => {
    // Built from pieces so the placeholder is source text, not one of this file's own.
    const src = ['`a $', '{b + `c $', "{d}`} ' e` z"].join('');
    expect(kinds(src)).toEqual(['template:', 'ident:z']);
  });

  it('ends an unterminated string at the end of its line', () => {
    expect(kinds("<p>don't</p>\nok('a.b')")).toEqual([
      'punct:<',
      'ident:p',
      'punct:>',
      'ident:don',
      'string:t</p>',
      'ident:ok',
      'punct:(',
      'string:a.b',
      'punct:)',
    ]);
  });

  it('reads a regular-expression literal as one token, quotes and slashes included', () => {
    expect(kinds("const r = /['\\/]+/g; x('a.b')")).toEqual([
      'ident:const',
      'ident:r',
      'punct:=',
      'regex:',
      'punct:;',
      'ident:x',
      'punct:(',
      'string:a.b',
      'punct:)',
    ]);
    expect(kinds('a / b / c')).toEqual(['ident:a', 'punct:/', 'ident:b', 'punct:/', 'ident:c']);
    expect(kinds('f(1) / 2')).toEqual([
      'ident:f',
      'punct:(',
      'number:1',
      'punct:)',
      'punct:/',
      'number:2',
    ]);
    expect(kinds('return /x/.test(s)')).toEqual([
      'ident:return',
      'regex:',
      'punct:.',
      'ident:test',
      'punct:(',
      'ident:s',
      'punct:)',
    ]);
  });
});
