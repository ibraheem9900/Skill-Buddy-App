/**
 * Harness-only ambient declarations.
 *
 * The dependency-free test runner compiles lib/ helpers with `types: []`, but
 * `services/api.ts` (pulled in by lib/servicePrice → hooks/useClientProfile)
 * reads `process.env` at module load. Declaring the tiny surface it uses keeps
 * the harness Node-typings-free; this adds no runtime behaviour and is never
 * part of the app bundle.
 */
declare const process: { env: Record<string, string | undefined> };
