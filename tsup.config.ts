import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { bin: 'src/bin.tsx' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
});
