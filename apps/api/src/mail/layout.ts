/**
 * The HTML frame every e-mail shares: a dark canopy page, the emblem and the
 * wordmark, a white card, and a footer saying why the mail arrived.
 *
 * Mail clients are not browsers: layout is nested tables, every style is
 * inline, and there is no web font (the Sora/Manrope stacks fall back to the
 * system face). Gradients and rounded corners are progressive — Outlook for
 * Windows drops them and keeps the solid colour underneath.
 */

/** The identity's tokens (docs/specs/2026-09-12-visual-identity.md), resolved to hex for mail clients. @rfc RFC-10 R16 */
export const MAIL_COLORS = {
  page: '#071f1c',
  canopy900: '#061a18',
  canopy800: '#0d4c41',
  canopy700: '#0f5c4f',
  canopy600: '#1f8f7a',
  mist50: '#eef4f1',
  mist100: '#cfd8d3',
  mist300: '#a9b8b2',
  mist400: '#8fa39c',
  pollen600: '#c98a2e',
  pollen500: '#e8a33d',
  pollen400: '#f2c14e',
  pollen300: '#ffd777',
  bark700: '#8a5426',
  ink: '#1b1406',
  text: '#2b3a35',
  muted: '#55665f',
  rule: '#dfe7e3',
  amberTint: '#fdf3e1',
  amberText: '#5a3a12',
} as const;

/** @rfc RFC-10 R16 */
export const DISPLAY_FONT = "Sora, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Where the SPA serves the e-mail images and fonts (`apps/web/public/email`). @rfc RFC-10 R16 */
export function mailAsset(appOrigin: string, file: string): string {
  return `${appOrigin}/email/${file}`;
}

/** An inline icon, `file` a PNG of `apps/web/public/email` drawn at twice `size`. @rfc RFC-10 R16 */
export function mailIcon(appOrigin: string, file: string, size: number): string {
  return `<img src="${escapeHtml(mailAsset(appOrigin, file))}" width="${size}" height="${size}" alt="" style="display:inline-block;border:0;width:${size}px;height:${size}px;vertical-align:middle;">`;
}
/** @rfc RFC-10 R16 */
export const BODY_FONT = "Manrope, 'Segoe UI', Helvetica, Arial, sans-serif";

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Safe in element text and in quoted attribute values alike. @rfc RFC-10 R16 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

/** The amber pill with its arrow and pollen glow; `href` and `label` are escaped here. @rfc RFC-10 R16 */
export function mailButton(appOrigin: string, href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:999px;background-color:${MAIL_COLORS.pollen500};background-image:linear-gradient(90deg,${MAIL_COLORS.pollen500},${MAIL_COLORS.pollen400});box-shadow:0 10px 30px rgba(232,163,61,0.45);"><a href="${escapeHtml(href)}" style="display:inline-block;padding:16px 30px;font-family:${BODY_FONT};font-size:16px;font-weight:700;line-height:20px;color:${MAIL_COLORS.ink};text-decoration:none;border-radius:999px;">${escapeHtml(label)}&nbsp;&nbsp;${mailIcon(appOrigin, 'arrow.png', 18)}</a></td></tr></table>`;
}

/** A body paragraph; `text` is escaped here. @rfc RFC-10 R16 */
export function mailParagraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${BODY_FONT};font-size:16px;line-height:26px;color:${MAIL_COLORS.text};">${escapeHtml(text)}</p>`;
}

/** The "button not working?" block under a call to action. @rfc RFC-10 R16 */
export function mailFallbackLink(href: string, after?: string): string {
  const note = `font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${MAIL_COLORS.muted};`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${MAIL_COLORS.rule};padding-top:20px;"><p style="margin:0 0 6px;${note}">Button not working? Paste this link into your browser:</p><p style="margin:0;${note}word-break:break-all;"><a href="${escapeHtml(href)}" style="color:${MAIL_COLORS.canopy700};">${escapeHtml(href)}</a></p>${after === undefined ? '' : `<p style="margin:6px 0 0;${note}">${escapeHtml(after)}</p>`}</td></tr></table>`;
}

/**
 * A tinted note box: `tone` picks canopy mist, amber or neutral grey; `icon`,
 * from `mailIcon`, sits left of the text.
 * @rfc RFC-10 R16
 */
export function mailNote(html: string, tone: 'mist' | 'amber' | 'grey', icon: string): string {
  const [bg, fg] =
    tone === 'amber'
      ? [MAIL_COLORS.amberTint, MAIL_COLORS.amberText]
      : tone === 'grey'
        ? ['#f6f9f7', MAIL_COLORS.muted]
        : [MAIL_COLORS.mist50, MAIL_COLORS.canopy800];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="padding:14px 16px;border-radius:12px;background-color:${bg};"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" width="28" style="padding-top:1px;">${icon}</td><td valign="top" style="font-family:${BODY_FONT};font-size:14px;line-height:21px;color:${fg};">${html}</td></tr></table></td></tr></table>`;
}

/**
 * The whole document. `body` is trusted markup built from the helpers above;
 * `title`, `preheader` and `footer` are plain text and escaped here.
 * `hero`, when given, replaces the small wordmark header with its own markup
 * on top of the card (the invitation's welcome).
 * @rfc RFC-10 R16
 */
export function emailLayout(input: {
  appOrigin: string;
  title: string;
  preheader: string;
  body: string;
  footer: string;
  /** Top stripe of the card, when there is no hero. */
  accent?: string;
  /** Right-hand text of the wordmark row. */
  headerNote?: string;
  hero?: string;
  /** Markup between the wordmark row and the card (the digest's resend line). */
  beforeCard?: string;
}): string {
  const emblem = mailAsset(input.appOrigin, 'emblem.png');
  const font = (family: string, file: string) =>
    `@font-face { font-family: '${family}'; font-style: normal; font-weight: 100 900; font-display: swap; src: url('${escapeHtml(mailAsset(input.appOrigin, file))}') format('woff2'); }`;
  const wordmark = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0 8px 24px;" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding-right:12px;"><img src="${escapeHtml(emblem)}" width="40" height="40" alt="TreeRepro" style="display:block;border:0;width:40px;height:40px;"></td><td valign="middle" style="font-family:${DISPLAY_FONT};font-size:20px;font-weight:600;color:${MAIL_COLORS.mist50};">TreeRepro</td></tr></table></td>${input.headerNote === undefined ? '' : `<td align="right" valign="middle" style="padding:0 8px 24px;font-family:${BODY_FONT};font-size:13px;color:${MAIL_COLORS.mist400};">${escapeHtml(input.headerNote)}</td>`}</tr></table>`;
  const top =
    input.hero ??
    `<tr><td style="height:6px;line-height:6px;font-size:0;background-color:${input.accent ?? MAIL_COLORS.pollen500};">&nbsp;</td></tr>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.title)}</title>
<style>
${font('Sora', 'sora.woff2')}
${font('Manrope', 'manrope.woff2')}
@media (max-width: 620px) {
  .tr-card-pad { padding: 28px 22px !important; }
  .tr-hero-pad { padding: 36px 22px !important; }
  .tr-stack { display: block !important; width: 100% !important; box-sizing: border-box; }
  .tr-step { height: auto !important; }
  .tr-tile { display: inline-block !important; width: 50% !important; box-sizing: border-box; }
  .tr-grid { margin-left: 0 !important; margin-right: 0 !important; width: 100% !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${MAIL_COLORS.page};">
<div style="display:none;mso-hide:all;visibility:hidden;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${MAIL_COLORS.page};">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${MAIL_COLORS.page};">
<tr><td align="center" style="padding:40px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td>${input.hero === undefined ? wordmark : ''}${input.beforeCard ?? ''}</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:18px;overflow:hidden;">
${top}
<tr><td class="tr-card-pad" style="padding:36px 40px 40px;">${input.body}</td></tr>
</table>
</td></tr>
<tr><td style="padding:24px 8px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" width="44" style="padding-right:14px;"><img src="${escapeHtml(emblem)}" width="30" height="30" alt="" style="display:block;border:0;width:30px;height:30px;opacity:0.85;"></td><td valign="middle" style="font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${MAIL_COLORS.mist400};">${escapeHtml(input.footer)}</td></tr></table></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
