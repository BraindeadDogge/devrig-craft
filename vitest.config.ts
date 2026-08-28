import { defineConfig } from 'vitest/config'
// Unit tests only. `vitest run test` filters by path SUBSTRING, so an include
// covering test-integration/** made `npm test` execute the Docker smoke on any
// machine that has Docker (like the CI unit job). Integration has its own
// config: vitest.integration.config.ts.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
