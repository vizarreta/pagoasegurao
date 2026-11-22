# Progreso — PagoAsegurao

## Estado actual (Fase 0 — Preparación)

- Repo creado con `CLAUDE.md`, `SPEC.md`, `LICENSE` (MIT), `.gitignore`, `.env.example`, `README.md`.
- Estructura de carpetas creada según `SPEC.md` sección 8:
  - `contracts/pagoasegurao/` (Cargo.toml, src/lib.rs, src/test.rs, test-vectors/voucher.json)
  - `app/` (Vite + React + TS + PWA, src/lib y src/screens)
  - `api/` (relayer serverless)
  - `scripts/` (setup-testnet.ts, verify-vector.ts)
  - `deployments/testnet.json`
  - `docs/` (progress.md, ai-usage.md, architecture.md, demo-script.md)
- Herramientas por verificar: `rustc`, `stellar`, `node`, `pnpm`.

## Próximo paso

- Fase 1 — Contrato y pruebas: verificar que `cargo test`, `cargo fmt` y `cargo clippy` pasan; ajustar el contrato a la versión exacta de `soroban-sdk`.

## IDs públicos (sin secretos)

- `deployments/testnet.json`: pendiente de rellenar tras `scripts/setup-testnet.ts`.
