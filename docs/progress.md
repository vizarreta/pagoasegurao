# Progreso — PagoAsegurao

## Resumen del Estado de Fases

### Fase 0 — Preparación: COMPLETADA
- Repositorio público configurado con `CLAUDE.md`, `SPEC.md`, `LICENSE` (MIT), `.gitignore`, `.env.example`, `README.md`.
- Entorno verificado: Rust `1.100.0` (target `wasm32v1-none`), Stellar CLI `30.0.1`, Node `v24.16.0`, `pnpm 9.15.9`.

### Fase 1 — Contrato Soroban y Pruebas: COMPLETADA
- Contrato Soroban en `contracts/pagoasegurao/src/lib.rs` actualizado a `soroban-sdk 29.0.1`:
  - Bóvedas (`open_vault`, `top_up`, `close_vault`, `get_vault`, `get_token`), vales (`redeem`, `is_redeemed`), autorización de dueño (`Error::Unauthorized = 9`), validación de expiración (`Error::InvalidExpiry = 10`), validación `max_per_voucher <= amount`, `Error::AlreadyInitialized = 11`, TTL dinámico y eventos `#[contractevent]`.
- **Validación:** `cargo test --offline` (**21/21 pasando**, vector compartido leído directamente desde `test-vectors/voucher.json`), `cargo clippy --offline -- -D warnings` (**0 warnings**), `cargo fmt --check` limpio, `pnpm test:app` (**9/9 pasando**), `pnpm verify:vector` OK, `pnpm build` OK.

### Fase 2 — Testnet (`tPEN` Soles de prueba) y Vector Compartido: COMPLETADA
- `@stellar/stellar-sdk 17.4.0` (Protocol 30) y vector compartido Rust/TS verificado (`161` bytes canónicos).
- Despliegue real del contrato actualizado (`26,933 bytes`, incluyendo `max_per_voucher <= amount` y `Error::AlreadyInitialized = 11`) en **Soles de prueba (`S/` · `tPEN`, sin valor económico)**:
  - Emisor `tPEN`: `GD623ITJWCKKW273MPHDQPL7AAKKLS7COUSGRXDSP7UWTIOPEMQL3GIV`
  - Relayer (fee sponsor): `GCNR7PQ3X7ELNJWAYTRD5BFZ7C77Y2YAQ3NRAO7UBPG7ESXGOHJL7UGG`
  - SAC `tPEN`: `CDSWIWMX6CCOAGJSLEYFKTNN2BPWI3OKF3CFGZQBOSTAJ2FIGJHFDLWK` ([ver en stellar.expert](https://stellar.expert/explorer/testnet/contract/CDSWIWMX6CCOAGJSLEYFKTNN2BPWI3OKF3CFGZQBOSTAJ2FIGJHFDLWK))
  - Contrato `PagoAsegurao`: `CDM5ZV7D2WSFK2D452KOB26FSURACWVCM4E7ZSWWBAC6LQ7DU6YHQR4J` ([ver en stellar.expert](https://stellar.expert/explorer/testnet/contract/CDM5ZV7D2WSFK2D452KOB26FSURACWVCM4E7ZSWWBAC6LQ7DU6YHQR4J))
  - Tx `open_vault` (`S/ 100.00`): [ver tx](https://stellar.expert/explorer/testnet/tx/1528a34b2dc1d9270c3e13092245f74df808c64c0eb26c6ab220d4438cb42741)
  - Tx `redeem` patrocinado (`S/ 15.00`): [ver tx](https://stellar.expert/explorer/testnet/tx/f1c0b8727fb33d488de89d2c629027a42f8c62c8c158ecc342ac65f5be880762)

### Fase 3 y 4 — PWA en Soles (`S/`) y Relayer Real: COMPLETADA
- Relayer serverless ESM nativo (`api/`) y PWA offline-first (`app/`) operando 100% en Soles de prueba (`S/` · `tPEN`), con montos rápidos (`S/ 2`, `S/ 5`, `S/ 10`, `S/ 20`), faucet `S/ 200.00`, IndexedDB v4 con migración automática y precaching de 20 recursos.
- Despliegue público HTTPS en Vercel: https://pagoasegurao.vercel.app

### Fase 5 — Casos de Error y Prueba E2E en Soles (`tPEN`): COMPLETADA
- Suite `scripts/test-e2e-api.ts` (`pnpm test:e2e`): **12/12 escenarios reales pasando en Stellar Testnet** (incluyendo `open_vault`, `redeem` patrocinado, doble canje, tope excedido, vale vencido, firma alterada, `top_up` y `close_vault` con devolución de Soles).

### Fase 6 — Entrega Final: CASI LISTA
- [x] Código, contrato en Soles (`tPEN`), PWA HTTPS en Vercel, pruebas y documentación completos y subidos a GitHub.
- [ ] Completar usuario de GitHub de Gustavo Alexander Flores Vera en `README.md`.
- [ ] Grabar video demo (máx. 3 min) siguiendo `docs/demo-script.md` y pegar enlace en `README.md`.
- [ ] Registrar el repo en Stellar Build Hub (hasta miércoles 25 nov, 11:59 p. m.) y entregar en APEX (hasta viernes 4 dic, 11:59 p. m.).
