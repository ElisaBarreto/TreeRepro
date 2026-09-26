/**
 * Routes reached with an API key only, never a session, as
 * `"<METHOD> <path>"`; each carries `requireApiKey` and nothing else.
 * @rfc RFC-32 R5
 * @rfc RFC-82 R10
 */
export const API_KEY_ROUTES: readonly string[] = ['POST /api/batch'];
