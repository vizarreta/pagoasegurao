# Arquitectura — PagoAsegurao

## Componentes

### 1. Contrato Soroban (`contracts/pagoasegurao`)
- Compilado con `soroban-sdk 29.0.1` al target `wasm32v1-none` (`26,933 bytes` en `cargo build --release`).
- Activo de prueba `tPEN` (Soles de prueba `S/`, sin valor económico) emitido en Stellar Testnet y envuelto con su Stellar Asset Contract (SAC); su dirección se guarda en almacenamiento de instancia al llamar `initialize(token)`.
- Almacenamiento persistente con extensión dinámica de TTL (`expires_at + ~1 día`):
  - `Vault(signer)`: `owner`, `balance`, `expires_at`, `max_per_voucher`.
  - `Used(signer, nonce)`: marca vales liquidados para evitar doble canje.
- Funciones exportadas: `initialize`, `get_token`, `open_vault`, `top_up`, `redeem`, `close_vault`, `get_vault`, `is_redeemed`.
- Seguridad: `vault.owner == owner` en `top_up` y `close_vault`, rechazo de vencimientos pasados, efectos antes de transferencias (CEI) y eventos tipados `#[contractevent]`.
- Mensaje canónico para firma Ed25519 (161 bytes exactos en Rust y TypeScript):
  `"PAGOASEGURAO1" || contract_address_xdr || signer(32B) || merchant_address_xdr || amount(i128 BE) || nonce(u64 BE) || expiry(u64 BE)`.

### 2. App PWA (`app/`)
- Vite 5 + React 18 + TypeScript estricto + `vite-plugin-pwa` (Workbox precaching de 20 recursos) + `@stellar/stellar-sdk 17.4.0`.
- Dos modos: **Cliente** y **Comercio**. Interfaz en español y en **Soles (`S/` · `tPEN`)**, pensada para teléfono.
- `src/polyfills.ts`: polyfill de `Buffer` para Safari iOS y Chrome Android.
- `src/lib/`:
  - `stellar.ts`: configuración pública del contrato, serialización canónica, firma/verificación Ed25519, aritmética decimal exacta con `BigInt` stroops (`formatSoles`), y llamadas reales a Testnet (`changeTrust`, `open_vault`, `top_up`, `close_vault`, consultas Horizon y relayer).
  - `voucher.ts` y `qr.ts`: codificación compacta base64url de `QR-A` (`SSC1.`, 69 chars) y `QR-B` (`SSV1.`, 208 chars) y verificación local sin conexión.
  - `storage.ts`: IndexedDB v4 (`idb`) con almacenes separados (`keys`, `vault`, `client_vouchers`, `merchant_vouchers`, `vault_cache`).
  - `src/screens/`: `cliente.tsx` (reconciliación on-chain `is_redeemed` + liberación de retenciones vencidas y estado de vales) y `comercio.tsx` (cola IndexedDB y persistencia de cobro activo).
- `src/components/QRScanner.tsx`: escaneo por cámara con `html5-qrcode` + entrada manual/portapapeles.

### 3. Relayer Serverless (`api/`)
- Funciones serverless TypeScript ESM nativo para Vercel (`vercel.json`):
  - `api/_errors.ts`: tabla única `CONTRACT_ERROR_MAP` (`#1`–`#11`) compartida entre relayer y PWA.
  - `POST /api/redeem`: idempotencia (`is_redeemed`), verificación de trustline `tPEN` del comercio, simulación Soroban con reintentos ante fallos transitorios RPC, traducción de errores `#1`–`#11` a español, patrocinio de comisiones con `RELAYER_SECRET` y respuesta `200`/`202 PENDING` dentro del límite de Vercel Hobby.
  - `POST /api/faucet`: fondeo XLM vía Friendbot, verificación de trustline y emisión de `S/ 200.00` (`200 tPEN` de prueba) desde `ISSUER_SECRET` con rate limit.
  - `GET /api/vault/:signer`: simulación de lectura `get_vault` en Soroban y saldos reales en Horizon.
- Claves secretas (`RELAYER_SECRET`, `ISSUER_SECRET`) únicamente en variables de entorno; nunca en el repositorio.

## Flujo de datos

1. Cliente activa cuenta en Testnet (Friendbot + trustline `tPEN` + faucet `S/ 200.00`) y abre bóveda (`open_vault`).
2. Comercio activa cuenta en Testnet (Friendbot + trustline `tPEN`, una sola vez).
3. Sin conexión (Modo Avión): comercio muestra `QR-A` (`SSC1.`); cliente escanea, confirma, firma con Ed25519 y muestra `QR-B` (`SSV1.`); comercio escanea `QR-B`, verifica firma localmente y encola en IndexedDB.
4. Al recuperar señal: comercio sincroniza automáticamente con `/api/redeem`; el relayer patrocina las comisiones y Soroban transfiere `tPEN` (`S/`) desde la bóveda al comercio.
5. Al vencer la bóveda: cliente ejecuta `close_vault` y recupera el saldo no gastado.

## Red y Despliegue (Stellar Testnet)

- RPC: `https://soroban-testnet.stellar.org` (Protocol 30)
- Horizon: `https://horizon-testnet.stellar.org`
- Explorador: `https://stellar.expert/explorer/testnet`
- Contrato `PagoAsegurao`: `CDM5ZV7D2WSFK2D452KOB26FSURACWVCM4E7ZSWWBAC6LQ7DU6YHQR4J`
- Token `tPEN` (SAC): `CDSWIWMX6CCOAGJSLEYFKTNN2BPWI3OKF3CFGZQBOSTAJ2FIGJHFDLWK`
- App HTTPS: https://pagoasegurao.vercel.app
- Solo testnet. Nunca mainnet.
