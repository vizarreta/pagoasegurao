import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';

function loadRootEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

/**
 * Connects /api/* during local Vite dev directly to the real Vercel handlers in ../api/
 * so local development runs real Stellar Testnet transactions (zero mocked hashes).
 */
function realDevApiPlugin(): Plugin {
  return {
    name: 'real-dev-api-middleware',
    configureServer(server) {
      loadRootEnv();

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const urlObj = new URL(req.url, 'http://localhost');
        const pathname = urlObj.pathname;

        let handlerPath: string | null = null;
        const query: Record<string, string> = {};
        urlObj.searchParams.forEach((v, k) => {
          query[k] = v;
        });

        if (pathname === '/api/faucet') {
          handlerPath = path.resolve(__dirname, '..', 'api', 'faucet.ts');
        } else if (pathname === '/api/redeem') {
          handlerPath = path.resolve(__dirname, '..', 'api', 'redeem.ts');
        } else if (pathname === '/api/vault' || pathname.startsWith('/api/vault/')) {
          handlerPath = path.resolve(__dirname, '..', 'api', 'vault.ts');
          if (pathname.startsWith('/api/vault/')) {
            query.signer = decodeURIComponent(pathname.slice('/api/vault/'.length));
          }
        }

        if (!handlerPath) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ ok: false, error: 'Endpoint no encontrado' }));
        }

        let rawBody = '';
        req.on('data', (chunk) => {
          rawBody += chunk;
        });

        req.on('end', async () => {
          try {
            const parsedBody = rawBody ? JSON.parse(rawBody) : {};
            const mod = await server.ssrLoadModule(handlerPath!);
            const handler = mod.default;

            const fakeReq: any = {
              method: req.method,
              url: req.url,
              headers: req.headers,
              query,
              body: parsedBody,
            };

            const fakeRes: any = {
              setHeader: (k: string, v: string) => res.setHeader(k, v),
              status: (code: number) => {
                res.statusCode = code;
                return fakeRes;
              },
              json: (payload: unknown) => {
                if (!res.getHeader('Content-Type')) {
                  res.setHeader('Content-Type', 'application/json');
                }
                res.end(JSON.stringify(payload));
                return fakeRes;
              },
              end: (data?: any) => {
                res.end(data);
                return fakeRes;
              },
            };

            await handler(fakeReq, fakeRes);
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: err?.message || 'Error en API local' }));
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
    realDevApiPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png', 'deployments/testnet.json'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'PagoAsegurao',
        short_name: 'PagoAsegurao',
        description: 'Pagos sin internet sobre Stellar testnet con bóvedas Soroban',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
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
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          stellar: ['@stellar/stellar-sdk'],
          qr: ['html5-qrcode', 'qrcode.react'],
          vendor: ['react', 'react-dom', 'idb', 'lucide-react', 'buffer'],
        },
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: ['..'],
    },
  },
});
