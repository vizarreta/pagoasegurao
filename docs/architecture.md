# Arquitectura — PagoAsegurao

## Componentes

### 1. Contrato Soroban (`contracts/pagoasegurao`)
- Activo de prueba USDC emitido por cuenta del proyecto, envuelto con SAC; su dirección se guarda al inicializar.
- `Vault(signer)`: propietario, saldo, expiración y tope por vale.
- `Used(signer, nonce)`: impide doble canje.
- Funciones: `initialize`, `open_vault`, `top_up`, `redeem`, `close_vault`, `get_vault`, `is_redeemed`.
- Mensaje canónico para la firma ed25519:
  `"PAGOASEGURAO1" || contract_address_xdr || signer || merchant_address_xdr || amount(i128 BE) || nonce(u64 BE) || expiry(u64 BE)`.

### 2. App PWA (`app/`)
- Vite + React + TypeScript + PWA (`vite-plugin-pwa`).
- Dos modos: Cliente y Comercio. UI en español.
- `src/lib/`: `stellar.ts` (claves, mensaje canónico, firma), `voucher.ts` (vales y QR), `qr.ts` (utilidades base64url), `storage.ts` (IndexedDB vía `idb`).
- `src/screens/`: `cliente.tsx`, `comercio.tsx`.
- Offline-first: service worker con precache, indicador de conexión, colas locales.

### 3. Relayer (`api/`)
- Funciones serverless (Vercel): `/redeem`, `/faucet`, `/vault/:signer`.
- Patrocina comisiones; clave secreta solo en variables de entorno (`RELAYER_SECRET`).

## Flujo de datos

1. Cliente abre bóveda (`open_vault`) y aparta fondos.
2. Comercio muestra QR-A (`SSC1.` + clave comercio + monto + request_id).
3. Cliente escanea QR-A, confirma y firma el vale → QR-B (`SSV1.` + signer + comercio + monto + nonce + expiración + firma).
4. Comercio escanea QR-B, verifica firma localmente y guarda en cola.
5. Al recuperar conexión, relayer envía `redeem` al contrato; el comercio recibe USDC desde la bóveda.
6. Al vencer, `close_vault` devuelve el saldo no gastado al cliente.

## Red

- Stellar testnet: RPC `https://soroban-testnet.stellar.org`, explorador `https://stellar.expert/explorer/testnet`.
- Solo testnet. Nunca mainnet.
