import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022' },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
