import { describe, expect, it } from 'vitest';
import { parseImportRecordsArgs } from './import-records-args.ts';

describe('RFC-64 R1, R15 import:records arguments', () => {
  it('R15 takes --replace-imported with the sheet directory', () => {
    expect(
      parseImportRecordsArgs([
        '--file',
        'a.csv',
        '--replace-imported',
        '--annotation-sheet',
        '/sheets',
        '--run-by',
        'owner@example.test',
      ]),
    ).toEqual({
      file: 'a.csv',
      runBy: 'owner@example.test',
      force: false,
      replace: false,
      discardPlatform: false,
      replaceImported: { sheetDir: '/sheets' },
    });
  });

  it('R1 keeps the existing flags', () => {
    expect(parseImportRecordsArgs(['--file', 'a.csv', '--replace', '--force'])).toEqual({
      file: 'a.csv',
      runBy: undefined,
      force: true,
      replace: true,
      discardPlatform: false,
      replaceImported: undefined,
    });
  });

  it('R12 takes --discard-platform together with --replace', () => {
    expect(parseImportRecordsArgs(['--file', 'a.csv', '--replace', '--discard-platform'])).toEqual({
      file: 'a.csv',
      runBy: undefined,
      force: false,
      replace: true,
      discardPlatform: true,
      replaceImported: undefined,
    });
  });

  it.each([
    [['--file', 'a.csv', '--discard-platform']],
    [['--file', 'a.csv', '--force', '--discard-platform']],
    [['--file', 'a.csv', '--replace-imported', '--annotation-sheet', '/s', '--discard-platform']],
  ])('R1 %j without --replace is a usage error', (args) => {
    expect(parseImportRecordsArgs(args)).toBeNull();
  });

  it.each([
    [['--replace-imported', '--annotation-sheet', '/s']],
    [['--file', 'a.csv', '--replace-imported']],
    [['--file', 'a.csv', '--annotation-sheet', '/s']],
    [['--file', 'a.csv', '--replace-imported', '--annotation-sheet', '/s', '--replace']],
    [['--file', 'a.csv', '--replace-imported', '--annotation-sheet', '/s', '--force']],
    [['--file', 'a.csv', '--bogus']],
  ])('R15 %j is a usage error', (args) => {
    expect(parseImportRecordsArgs(args)).toBeNull();
  });
});
