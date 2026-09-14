import { z } from 'zod';

// zod 4 probes `Function('')` when the first object schema is constructed;
// the CSP has no `unsafe-eval` (RFC-02 R5, RFC-13 R5). Setting `jitless: true`
// before any schema is constructed prevents that probe from ever firing.
// Configuring it here means the setting travels with the schemas themselves
// across both API and web (issue #63).
z.config({ jitless: true });
