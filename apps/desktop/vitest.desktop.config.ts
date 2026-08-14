import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin } from '../../vitest.shared.ts'

// Electron smoke lane: runs the real desktop shell against a mock server via
// playwright's _electron driver. Not part of the default vitest.config.ts
// suite (which needs no Electron binary); run with `pnpm run test:desktop`.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../../tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    include: ['tests/**/*.e2e.ts'],
    pool: 'forks',
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
})
