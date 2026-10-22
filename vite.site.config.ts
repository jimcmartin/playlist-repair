import { defineConfig } from 'vite';
import { landingPage } from './site/plugin.ts';

// The landing page for https://playlistrepair.com/. Static HTML and CSS, built into its
// own folder so it never mixes with the app's dist/. appType 'mpa' makes the preview
// server answer a missing file with 404, not with index.html, so the link test can trust it.
export default defineConfig({
  root: 'site',
  appType: 'mpa',
  plugins: [landingPage()],
  build: { outDir: '../dist-site', emptyOutDir: true, assetsInlineLimit: 0 },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
