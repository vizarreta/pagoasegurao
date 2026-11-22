# Uso de IA — PagoAsegurao

Este documento cumple la regla 9 de CLAUDE.md y la exigencia de las bases de declarar el uso de IA en el README.

## Partes generadas con asistencia de IA

- Estructura de carpetas del repositorio (según `SPEC.md` sección 8).
- Esqueleto del contrato Soroban (`contracts/pagoasegurao/src/lib.rs`): estructuras `Vault`, `Voucher`, funciones `initialize`, `open_vault`, `top_up`, `redeem`, `close_vault`, `get_vault`, `is_redeemed`, errores y mensaje canónico.
- Pruebas del contrato (`contracts/pagoasegurao/src/test.rs`).
- Vector de prueba compartido (`contracts/pagoasegurao/test-vectors/voucher.json`).
- Archivos raíz: `.gitignore`, `.env.example`, `LICENSE`, `README.md`, `Cargo.toml` (workspace).
- App: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/lib/*` (`stellar.ts`, `voucher.ts`, `qr.ts`, `storage.ts`), `src/screens/*` (`cliente.tsx`, `comercio.tsx`), `App.tsx`, `main.tsx`.
- API relayer: `api/redeem.ts`, `api/faucet.ts`, `api/vault.ts`.
- Scripts: `scripts/setup-testnet.ts`, `scripts/verify-vector.ts`.
- `deployments/testnet.json` (plantilla sin secretos).
- Documentación: `docs/progress.md`, `docs/architecture.md`, `docs/demo-script.md`.

## Partes escritas o revisadas a mano

- `SPEC.md` y `CLAUDE.md`: entregados por el usuario, base de toda la implementación.
- Revisión de convenciones: código y comentarios en inglés; UI en español; montos como enteros; cero secretos en el repo.

## Decisiones pendientes (ajustar tras verificar versiones reales)

- Versión exacta de `soroban-sdk` y `stellar` CLI; confirmar disponibilidad de `env.current_contract_address()`, `to_scval`/`to_xdr`, `env.crypto().ed25519_verify` y el flujo de simulación/envío con `@stellar/stellar-sdk`.
- La app y los scripts usan placeholders donde la API del SDK no ha sido verificada contra la documentación oficial.
