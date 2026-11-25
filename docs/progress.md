# Progreso — PagoAsegurao

## Resumen del Estado de Fases

### Fase 0 — Preparación: COMPLETADA
- Repositorio público configurado con `CLAUDE.md`, `SPEC.md`, `LICENSE` (MIT), `.gitignore`, `.env.example`, `README.md`.
- Entorno verificado: Rust `1.100.0` (target `wasm32v1-none`), Stellar CLI `30.0.1`, Node `v24.16.0`, `pnpm 9.15.9`.

### Fase 1 — Contrato Soroban y Pruebas: COMPLETADA
- Contrato Soroban en `contracts/pagoasegurao/src/lib.rs` actualizado a `soroban-sdk 29.0.1`:
  - Bóvedas (`open_vault`, `top_up`, `close_vault`, `get_vault`, `get_token`), vales (`redeem`, `is_redeemed`), autorización de dueño (`Error::Unauthorized = 9`), validación de expiración (`Error::InvalidExpiry = 10`), validación `max_per_voucher <= amount`, `Error::AlreadyInitialized = 11`, TTL dinámico y eventos `#[contractevent]`.
- **Validación:** `cargo test --offline` (**21/21 pasando**, vector compartido leído directamente desde `test-vectors/voucher.json`), `cargo clippy --offline -- -D warnings` (**0 warnings**), `cargo fmt --check` limpio, `pnpm test:app` (**8/8 pasando**), `pnpm verify:vector` OK, `pnpm build` OK.

> **Nota sobre re-despliegue de contrato:** Los ajustes locales en `lib.rs` (`max_per_voucher <= amount` y `AlreadyInitialized = 11`) ya compilan y pasan todas las pruebas. El contrato ya desplegado en `CAWJ3NQHILVST2RHVNSIOSQFRJXXZY7KSBEZZXWGMBOHZ7OVQKQ6GQPT` continúa funcionando en Testnet/Vercel (la UI ya valida `max_per_voucher <= amount`); si se desea reflejar estos dos checks en un nuevo contrato on-chain, ejecutar `pnpm setup:testnet` con las variables de Vercel actualizadas.

### Fase 2 — Testnet (`tPEN` Soles de prueba) y Vector Compartido: COMPLETADA
- `@stellar/stellar-sdk 17.4.0` (Protocol 30) y vector compartido Rust/TS verificado (`161` bytes canónicos).
- Despliegue real en **Soles de prueba (`S/` · `tPEN`, sin valor económico)**:
  - Emisor `tPEN`: `GDX4ZNACYNYJFY2QK6P7BKSF5UTDUYFY6J5VLRHMEN2H76KSN6N3AWYL`
  - Relayer (fee sponsor): `GDTAPYWCT4VCDKAQ7NUI6E5NQ6DYXDX5AV7OUF7ACQ6JO575ZMRPKBQV`
  - SAC `tPEN`: `CDUBDTM5Z3Y3OKKQ5BIKEP4XHW2WTHS6AUB4N2LMN6TOZQDAL2WPX5HF` ([ver en stellar.expert](https://stellar.expert/explorer/testnet/contract/CDUBDTM5Z3Y3OKKQ5BIKEP4XHW2WTHS6AUB4N2LMN6TOZQDAL2WPX5HF))
  - Contrato `PagoAsegurao`: `CAWJ3NQHILVST2RHVNSIOSQFRJXXZY7KSBEZZXWGMBOHZ7OVQKQ6GQPT` ([ver en stellar.expert](https://stellar.expert/explorer/testnet/contract/CAWJ3NQHILVST2RHVNSIOSQFRJXXZY7KSBEZZXWGMBOHZ7OVQKQ6GQPT))
  - Tx `open_vault` (`S/ 100.00`): [ver tx](https://stellar.expert/explorer/testnet/tx/ee1d9083c752161fcc13dbd15cb995cb47eabf15eac7784f3c6dff680cf467d4)
  - Tx `redeem` patrocinado (`S/ 15.00`): [ver tx](https://stellar.expert/explorer/testnet/tx/2e8378d144d770566ec719f6dadb534130b169028beb50d521e07710007542cd)

### Fase 3 y 4 — PWA en Soles (`S/`) y Relayer Real: COMPLETADA
- Relayer serverless ESM nativo (`api/`) y PWA offline-first (`app/`) operando 100% en Soles de prueba (`S/` · `tPEN`), con montos rápidos (`S/ 2`, `S/ 5`, `S/ 10`, `S/ 20`), faucet `S/ 200.00`, IndexedDB v3 con migración automática y precaching de 16 recursos.
- Despliegue público HTTPS en Vercel: https://pagoasegurao.vercel.app

### Fase 5 — Casos de Error y Prueba E2E en Soles (`tPEN`): COMPLETADA
- Suite `scripts/test-e2e-api.ts` (`pnpm test:e2e`): **12/12 escenarios reales pasando en Stellar Testnet** (incluyendo `open_vault`, `redeem` patrocinado, doble canje, tope excedido, vale vencido, firma alterada, `top_up` y `close_vault` con devolución de Soles).

### Fase 6 — Entrega Final: CASI LISTA
- [x] Código, contrato en Soles (`tPEN`), PWA HTTPS en Vercel, pruebas y documentación completos y subidos a GitHub.
- [ ] Completar usuario de GitHub de Gustavo Alexander Flores Vera en `README.md`.
- [ ] Grabar video demo (máx. 3 min) siguiendo `docs/demo-script.md` y pegar enlace en `README.md`.
- [ ] Registrar el repo en Stellar Build Hub (hasta miércoles 25 nov, 11:59 p. m.) y entregar en APEX (hasta viernes 4 dic, 11:59 p. m.).
