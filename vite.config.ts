import { defineConfig } from 'vite';
import { previewBridge } from './design/preview-bridge.mjs';

export default defineConfig({
  base: './',
  plugins: [previewBridge()],
  server: { host: '127.0.0.1' },
});
