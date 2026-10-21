import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Spotify only accepts http redirect URIs on the loopback address, and the
// registered value is http://127.0.0.1:5173/ exactly. strictPort makes a busy
// port fail loudly instead of moving to one the redirect would not match.
const loopback = { host: '127.0.0.1', port: 5173, strictPort: true };

// The policy from the plan's "Security and privacy" section. Navigating to
// accounts.spotify.com for login is not governed by connect-src.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  'connect-src https://accounts.spotify.com https://api.spotify.com',
  "img-src 'self' https://*.scdn.co https://*.spotifycdn.com",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// GitHub Pages cannot send headers, so the policy is a meta tag. It is added to
// the production build only, because the dev server's HMR needs inline scripts
// and a WebSocket.
const contentSecurityPolicy: Plugin = {
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml() {
    return [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ];
  },
};

export default defineConfig({
  plugins: [react(), contentSecurityPolicy],
  server: loopback,
  preview: loopback,
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
