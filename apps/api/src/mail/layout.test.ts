import { describe, expect, it } from 'vitest';
import { emailLayout, escapeHtml } from './layout.ts';

const APP_ORIGIN = 'https://treerepro.example';

describe('RFC-10 R16 e-mail layout', () => {
  it('escapes every character that can open markup or leave an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('frames the body with the emblem from the app origin, alt text included', () => {
    const html = emailLayout({
      appOrigin: APP_ORIGIN,
      title: 'Hi',
      preheader: 'Pre',
      body: '<p>Body</p>',
      footer: 'Why you got this',
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(`src="${APP_ORIGIN}/email-emblem.png"`);
    expect(html).toContain('alt="TreeRepro"');
    expect(html).toContain('<p>Body</p>');
    expect(html).toContain('Why you got this');
    expect(html).toContain('Pre');
  });

  it('loads nothing remote but the emblem', () => {
    const html = emailLayout({
      appOrigin: APP_ORIGIN,
      title: 'Hi',
      preheader: 'Pre',
      body: '',
      footer: '',
    });
    expect(html).not.toMatch(/<script|<link|@import|url\(/i);
    const sources = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(sources).toEqual([`${APP_ORIGIN}/email-emblem.png`]);
  });

  it('escapes the frame text it is given', () => {
    const html = emailLayout({
      appOrigin: APP_ORIGIN,
      title: '<b>t</b>',
      preheader: '<i>p</i>',
      body: '',
      footer: '<u>f</u>',
    });
    expect(html).not.toMatch(/<b>|<i>|<u>/);
  });
});
