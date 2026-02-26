import { resolve } from 'path';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [nodePolyfills()],
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'create-account': resolve(__dirname, 'create-account.html'),
        'send-tx': resolve(__dirname, 'send-tx.html'),
      },
    },
  },
});
