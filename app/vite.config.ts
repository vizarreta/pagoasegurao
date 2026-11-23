import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { VitePWA } from 'vite-plugin-pwa';

function devApiPlugin(): Plugin {
  return {
    name: 'dev-api-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          return res.end();
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', () => {
          try {
            const parsedBody = body ? JSON.parse(body) : {};

            if (req.url === '/api/faucet' && req.method === 'POST') {
              res.statusCode = 200;
              return res.end(
                JSON.stringify({
                  ok: true,
                  account: parsedBody.account,
                  message: '100 USDC transferidos en testnet para la demo',
                })
              );
            }

            if (req.url === '/api/redeem' && req.method === 'POST') {
              const hash = `0x${Array.from({ length: 64 }, () =>
                Math.floor(Math.random() * 16).toString(16)
              ).join('')}`;
              res.statusCode = 200;
              return res.end(
                JSON.stringify({
                  ok: true,
                  hash,
                  status: 'SUCCESS',
                  note: 'Liquidación confirmada con éxito por el relayer',
                })
              );
            }

            if (req.url?.startsWith('/api/vault')) {
              res.statusCode = 200;
              return res.end(
                JSON.stringify({
                  exists: true,
                  balance: '500000000',
                  maxPerVoucher: '150000000',
                })
              );
            }

            res.statusCode = 404;
            return res.end(JSON.stringify({ error: 'Endpoint no encontrado' }));
          } catch (e: any) {
            res.statusCode = 500;
            return res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(),
    devApiPlugin(),
    VitePWA({
      registerType: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
      manifest: {
        name: 'PagoAsegurao',
        short_name: 'PagoAsegurao',
        description: 'Pagos sin internet sobre Stellar testnet',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
