import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Spotify only accepts http redirect URIs on the loopback address, and the
// registered value is http://127.0.0.1:5173/ exactly. strictPort makes a busy
// port fail loudly instead of moving to one the redirect would not match.
const loopback = { host: '127.0.0.1', port: 5173, strictPort: true };

export default defineConfig({
  plugins: [react()],
  server: loopback,
  preview: loopback,
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
