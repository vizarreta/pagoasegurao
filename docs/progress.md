# Progreso — PagoAsegurao

## Resumen del Estado de Fases

### Fase 0 — Preparación: COMPLETADA
- Repositorio configurado con `CLAUDE.md`, `SPEC.md`, `LICENSE` (MIT), `.gitignore`, `.env.example`, `README.md`.
- Entorno de desarrollo preparado: Rust 1.100.0, target `wasm32-unknown-unknown`, Node v24, pnpm 12.21.0.

### Fase 1 — Contrato Soroban y Pruebas: COMPLETADA
- Contrato Soroban implementado en `contracts/pagoasegurao/src/lib.rs` (`soroban-sdk` 22):
  - Bóvedas (`open_vault`, `top_up`, `close_vault`, `get_vault`).
  - Vales y liquidación (`redeem`, `is_redeemed`).
  - Serialización canónica idéntica a TypeScript (`"PAGOASEGURAO1"` + `contract_scval_xdr` + `signer` + `merchant_scval_xdr` + `amount_i128_be` + `nonce_u64_be` + `expiry_u64_be`).
  - Verificación criptográfica Ed25519 en host Soroban (`env.crypto().ed25519_verify`).
  - Control de TTL para persistencia en ledger.
- **Validación:**
  - `cargo test`: **11 de 11 pruebas unitarias pasando**.
  - `cargo clippy -- -D warnings`: **0 warnings**.
  - `cargo fmt --check`: **formateo verificado**.
  - `cargo build --target wasm32-unknown-unknown --release`: **WASM generado exitosamente**.

### Fase 2 — Testnet y Vector de Prueba Compartido: COMPLETADA
- `scripts/verify-vector.ts`:
  - Genera y valida el vector de prueba canónico en TypeScript.
  - `test-vectors/voucher.json` sincronizado con la prueba `test_shared_test_vector_matches_typescript` de Rust.
- `scripts/setup-testnet.ts`:
  - Script idempotente para testnet: crea emisor, emite activo USDC de prueba, crea SAC, fondea cuentas demo de cliente y comercio vía Friendbot, establece trustlines y despliega el contrato.

### Fase 3 y 4 — App PWA (Cliente y Comercio) y Relayer: COMPLETADA
- PWA moderna y offline-first (`app/`):
  - Precache y Service Worker configurados vía `vite-plugin-pwa`.
  - Escáner de QR con cámara (compatible con iOS Safari y Android Chrome vía `html5-qrcode`) y alternativa manual/pegar.
  - Modo Cliente: creación y persistencia de clave en IndexedDB, apertura y visualización de bóveda, pago offline (escaneo QR-A -> confirmación de comercio y monto -> firma de vale -> muestra de QR-B), deducción de saldo local.
  - Modo Comercio: ingreso de monto, emisión de QR-A, escaneo de QR-B con verificación criptográfica local fuera de línea (firma Ed25519, monto y receptor válidos), cola de vales pendientes y sincronización con el relayer.
  - Build de producción Vite PWA pasando al 100% (`pnpm build`).
- Relayer Serverless (`api/`):
  - `POST /api/redeem`: canje de vales con patrocinio de comisiones (fee sponsorship).
  - `POST /api/faucet`: recarga de fondos de prueba.
  - `GET /api/vault/:signer`: consulta de estado de bóveda.

## IDs Públicos y Despliegue (Testnet)

- Ver `deployments/testnet.json`.
- RPC de Testnet: `https://soroban-testnet.stellar.org`
- Explorador: `https://stellar.expert/explorer/testnet`
