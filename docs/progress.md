# Progreso — PagoAsegurao

## Resumen del Estado de Fases

### Fase 0 — Preparación: COMPLETADA
- Repositorio público configurado con `CLAUDE.md`, `SPEC.md`, `LICENSE` (MIT), `.gitignore`, `.env.example`, `README.md`.
- Entorno verificado: Rust `1.100.0` (target `wasm32v1-none`), Stellar CLI `30.0.1`, Node `v24.16.0`, `pnpm 9.x`.

### Fase 1 — Contrato Soroban y Pruebas: COMPLETADA
- Contrato Soroban en `contracts/pagoasegurao/src/lib.rs` actualizado a `soroban-sdk 29.0.1`:
  - Bóvedas (`open_vault`, `top_up`, `close_vault`, `get_vault`, `get_token`).
  - Vales y liquidación (`redeem`, `is_redeemed`).
  - Seguridad endurecida: validación `vault.owner == owner` en `close_vault` y `top_up` (`Error::Unauthorized = 9`), rechazo de expiraciones pasadas (`Error::InvalidExpiry = 10`), extensión dinámica de TTL en storage persistente e instancia, y eventos tipados con `#[contractevent]`.
  - Serialización canónica de 161 bytes idéntica byte a byte a TypeScript.
- **Validación ejecutada:**
  - `cargo test --lib`: **15 de 15 pruebas unitarias pasando**.
  - `cargo clippy --lib --tests -- -D warnings`: **0 warnings**.
  - `cargo fmt --check`: **sin diferencias**.
  - `stellar contract build`: **8,910 bytes WASM optimizado** (`target/wasm32v1-none/release/pagoasegurao.wasm`, sha256 `a216de93f7a7d92b9a0bf8b339392d62b545dc3c8e62177d3ff95f2b42472fee`).

### Fase 2 — Testnet y Vector Compartido: COMPLETADA
- `@stellar/stellar-sdk` actualizado a `17.4.0` para compatibilidad con XDR de **Stellar Testnet Protocol 30**.
- `scripts/verify-vector.ts` verificado con coincidencia exacta contra el test de Rust (`161` bytes canónicos, firma Ed25519 de `64` bytes).
- `scripts/setup-testnet.ts` ejecutado en vivo contra Stellar Testnet:
  - Emisor `tUSDC`: `GDX4ZNACYNYJFY2QK6P7BKSF5UTDUYFY6J5VLRHMEN2H76KSN6N3AWYL`
  - Relayer (fee sponsor): `GDTAPYWCT4VCDKAQ7NUI6E5NQ6DYXDX5AV7OUF7ACQ6JO575ZMRPKBQV`
  - SAC `tUSDC`: `CA7N5AY7VBL4BHPOOLRONB5HC2XAT2ADIZOCFEK5IMDNZU2DFDQPWRMD` ([ver en stellar.expert](https://stellar.expert/explorer/testnet/contract/CA7N5AY7VBL4BHPOOLRONB5HC2XAT2ADIZOCFEK5IMDNZU2DFDQPWRMD))
  - Contrato `PagoAsegurao`: `CD2XXTNNXVP2VCYL2RID4EIQCCADQPM24ZENU6CZAHJ4DAZJAQEZML5O` ([ver en stellar.expert](https://stellar.expert/explorer/testnet/contract/CD2XXTNNXVP2VCYL2RID4EIQCCADQPM24ZENU6CZAHJ4DAZJAQEZML5O))
  - Validación `open_vault`: [tx `22d57188...`](https://stellar.expert/explorer/testnet/tx/22d571889a48d33cffdd9973a6356f0adf5ec49a0d8fdc263be82d4d7ae70ef0)
  - Validación `redeem` patrocinado: [tx `38e4aee4...`](https://stellar.expert/explorer/testnet/tx/38e4aee4a42c38943723e5a0998639db11cefe2d4f5a992f1428e33865b1bf04)

### Fase 3 y 4 — App PWA (Cliente y Comercio) y Relayer Real: COMPLETADA
- Relayer serverless en `api/` (`_config.ts`, `redeem.ts`, `faucet.ts`, `vault.ts`) + `vercel.json`:
  - Sin respuestas simuladas ni hashes falsos: todas las llamadas ejecutan transacciones y simulaciones reales en Stellar Testnet.
  - Idempotencia en `/api/redeem` (consulta `is_redeemed` + HTTP 409 claro en español) y mapeo completo de errores `#1`–`#10`.
- PWA offline-first en `app/`:
  - Polyfill de `Buffer` para navegadores móviles, parseo/formato exacto con `BigInt` stroops (sin floats), almacenamiento IndexedDB v2 con colas separadas (`client_vouchers`, `merchant_vouchers`, `vault_cache`).
  - Flujos reales on-chain en Cliente: activar cuenta + trustline + faucet `100 tUSDC`, `open_vault`, `top_up`, `close_vault` al vencer, sincronización de estado y firma offline QR-A -> QR-B.
  - Flujos reales en Comercio: activación con trustline `tUSDC`, generación QR-A con montos rápidos y botón copiar, verificación local offline QR-B con protección anti-duplicados y caché de saldo de bóveda, auto-sincronización al volver señal y enlaces a `stellar.expert`.
  - Build de producción: `tsc --noEmit` (0 errores) + `vite build` (Service Worker precacheando 16 archivos).

### Fase 5 — Casos de Error y Prueba E2E Real en Testnet: COMPLETADA
- Suite automatizada `scripts/test-e2e-api.ts` (`pnpm test:e2e`): **12 de 12 escenarios pasando en vivo en Stellar Testnet**:
  - `open_vault`: [tx `9744d0e8...`](https://stellar.expert/explorer/testnet/tx/9744d0e86e6bfa8a8936ce4ac23437ed34416ad6ab1440af581ac01c046bb124)
  - `redeem` patrocinado (0 -> 5 tUSDC): [tx `cb7d31d2...`](https://stellar.expert/explorer/testnet/tx/cb7d31d2dc40601467a90cbe1b6a6f743e90e38a974bb93bff8ec5c2ccdaa7c3)
  - `top_up` (+5 tUSDC): [tx `e17e335f...`](https://stellar.expert/explorer/testnet/tx/e17e335fbada3595c08694e94b9bdae7bb49bef859e9ab20102ebf329d0acc60)
  - `close_vault` (devolución +30 tUSDC): [tx `204ef56b...`](https://stellar.expert/explorer/testnet/tx/204ef56b48b249f6afa2ae7f2951222b1ef03eaf2c61f19e172ace05b3b80094)
  - Rechazos verificados en español: doble canje (`#1`), tope excedido (`#3`), vale vencido (`#2`), firma alterada (`#8`), cierre anticipado (`#6`).

### Fase 6 — Entrega Final: CASI LISTA (solo falta video demo y trámites de registro)
- [x] README completo, arquitectura, transparencia de IA, pruebas y contratos reales verificados en `stellar.expert`.
- [x] Despliegue público HTTPS en Vercel verificado en vivo: https://pagoasegurao.vercel.app (PWA + Service Worker + `/api/faucet`, `/api/vault/:signer` y `/api/redeem` reales).
- [ ] Completar usuario de GitHub de Gustavo Alexander Flores Vera en `README.md`.
- [ ] Grabar video demo de máximo 3 minutos (siguiendo `docs/demo-script.md`) y pegar enlace en `README.md`.
- [ ] Registrar el repositorio en Stellar Build Hub (hasta miércoles 25 nov, 11:59 p. m.) y entregar en APEX (hasta viernes 4 dic, 11:59 p. m.).
