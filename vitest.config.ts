import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',

  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@providers': path.resolve(__dirname, 'src/providers'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@workers': path.resolve(__dirname, 'src/workers'),
      '@config': path.resolve(__dirname, 'src/config'),
      '@cli': path.resolve(__dirname, 'src/cli'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@stores': path.resolve(__dirname, 'src/ui/stores'),
    },
  },
});
