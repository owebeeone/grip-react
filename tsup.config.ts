import { defineConfig } from 'tsup';
export default defineConfig((ctx) => ({
  entry: ['src/index.ts'],
  format: ['esm','cjs'],
  dts: true,
  sourcemap: ctx?.watch ? 'inline' : true, // inline in dev, external in prod
  clean: true,
  external: ['react','react-dom'],
}));