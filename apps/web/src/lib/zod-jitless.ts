import { z } from 'zod';

// zod 4 probes `Function('')` for its JIT fast path the first time an object
// schema is defined; the production CSP has no `unsafe-eval`, so the probe
// raises a `securitypolicyviolation` even though zod catches it internally.
// `jitless` skips the probe (RFC-13 R5).
//
// This is a side-effect-only module so it can be main.tsx's first import: ES
// modules evaluate an import's whole subgraph (here, just `zod`) before any
// later import's subgraph runs, so this config is in place before any
// schema anywhere in the app — now or added later — gets constructed.
z.config({ jitless: true });
