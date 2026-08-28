import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['test-integration/**/*.test.ts'],
    testTimeout: 600000,
    // beforeAll pulls a Minecraft server image and waits for world generation;
    // afterAll runs `docker stop`, which itself takes tens of seconds.
    hookTimeout: 600000,
  },
})
