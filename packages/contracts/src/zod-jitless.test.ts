import { describe, expect, it } from 'vitest';
import * as core from 'zod/v4/core';
import './index.ts';

describe('RFC-02 R5, RFC-13 R5 zod jitless configuration', () => {
  it('configures zod as jitless when contracts is imported', () => {
    expect(core.globalConfig.jitless).toBe(true);
  });
});
