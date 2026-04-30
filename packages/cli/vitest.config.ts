import { defineConfig } from 'vitest/config'

// CI cold-start of `ts.LanguageService` (boots a TypeScript program, parses
// type defs, etc.) takes ~6s on GitHub Actions runners. Local dev caches it
// across runs and lands well under 5s, but CI starts fresh every job. Bump
// the test timeout so the first cold test in this package doesn't fail
// spuriously on CI.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
})
