import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { bin: 'src/bin.tsx' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: false, // published CLI ships a lean bundle; no source map (was ~213 KB / 2/3 of the tarball)
  dts: false,
});
