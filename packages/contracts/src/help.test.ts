import { describe, expect, it } from 'vitest';
import {
  createHelpSectionBodySchema,
  createHelpTopicBodySchema,
  updateHelpSectionBodySchema,
  updateHelpTopicBodySchema,
} from './help.ts';

describe('RFC-73 R6 help write bodies', () => {
  it('a topic needs a title of 1–200 characters, trimmed', () => {
    expect(createHelpTopicBodySchema.safeParse({ title: '  ' }).success).toBe(false);
    expect(createHelpTopicBodySchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
    expect(createHelpTopicBodySchema.parse({ title: ' Plots ' })).toEqual({ title: 'Plots' });
  });

  it('a section may be untitled, and its HTML is capped at 100,000 characters', () => {
    expect(createHelpSectionBodySchema.parse({})).toEqual({});
    expect(createHelpSectionBodySchema.safeParse({ bodyHtml: 'x'.repeat(100_001) }).success).toBe(
      false,
    );
  });

  it('an update with no field or an unknown field is refused', () => {
    expect(updateHelpTopicBodySchema.safeParse({}).success).toBe(false);
    expect(updateHelpSectionBodySchema.safeParse({}).success).toBe(false);
    expect(updateHelpSectionBodySchema.safeParse({ anchor: 'x' }).success).toBe(false);
    expect(updateHelpSectionBodySchema.safeParse({ position: -1 }).success).toBe(false);
    expect(updateHelpSectionBodySchema.parse({ position: 2 })).toEqual({ position: 2 });
  });
});
