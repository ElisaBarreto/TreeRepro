import { z } from 'zod';

// zod 4 probes `Function('')` for its JIT fast path the first time an object
// schema is defined; the production CSP has no `unsafe-eval`, so the probe
// raises a `securitypolicyviolation` even though zod catches it internally.
// `jitless` skips the probe (RFC-13 R5). Side-effect-only so it can be
// main.tsx's first bare import: it protects every lazily loaded route
// chunk, which evaluates after this config (client.ts's dynamic import
// keeps the one schema the entry chunk needs out of the entry graph); the
// e2e CSP spec is the guard against a future eager import undoing that.
z.config({ jitless: true });
