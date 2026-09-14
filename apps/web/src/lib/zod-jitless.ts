import { z } from 'zod';

// zod 4 probes `Function('')` when the first object schema is constructed;
// the CSP has no `unsafe-eval`. This side-effect module is main.tsx's first
// import, and the entry graph constructs no schema (api/client.ts reads the
// error envelope structurally), so every schema lives in lazily loaded route
// chunks, which evaluate after this config. The e2e CSP spec guards it.
z.config({ jitless: true });
