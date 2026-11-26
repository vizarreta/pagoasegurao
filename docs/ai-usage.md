# Uso de IA — PagoAsegurao

Este documento cumple la regla 9 de `CLAUDE.md` y el requisito de transparencia de las bases de la Buildathon Stellar Codember Perú 2026.

## Herramientas utilizadas

- Asistentes de código basados en IA (Claude y Gemini / Antigravity) empleados durante el desarrollo en el periodo oficial de la buildathon (noviembre–diciembre 2026).

## Partes desarrolladas con asistencia de IA

- **Contrato Soroban (`contracts/pagoasegurao/src/lib.rs`)**:
  - Estructuras `Vault`, `Voucher`, `DataKey`, `Error` (`#1`–`#11`) y eventos `#[contractevent]`.
  - Serialización canónica de 161 bytes compatible con `@stellar/stellar-sdk`, verificación nativa Ed25519, control de autorización de propietario (`vault.owner == owner`), cálculo dinámico de TTL y transferencias vía SAC.
- **Pruebas unitarias (`contracts/pagoasegurao/src/test.rs`)**:
  - 21 pruebas unitarias cubriendo flujo feliz, doble canje, firmas inválidas, otra clave, vales vencidos, comercio equivocado, tope por vale, fondos insuficientes, ciclo de vida y autorización de `close_vault`/`top_up`, expiración inválida, vector compartido, `max_per_voucher > amount`, amounts inválidos, `top_up` post-expiración, `top_up` en bóveda inexistente, `redeem` con monto 0 y doble inicialización.
- **Scripts de verificación, despliegue y E2E (`scripts/`)**:
  - `scripts/verify-vector.ts`, `scripts/setup-testnet.ts` y `scripts/test-e2e-api.ts` (12 escenarios reales ejecutados contra Stellar Testnet Protocol 30).
- **Relayer serverless (`api/` y `vercel.json`)**:
  - Implementación real contra Stellar Testnet de `/api/redeem`, `/api/faucet` y `/api/vault/:signer` con patrocinio de comisiones, idempotencia y traducción de errores a español.
- **PWA Frontend (`app/src/`)**:
  - Pantallas Cliente y Comercio conectadas a Stellar Testnet, polyfill de `Buffer`, aritmética exacta en `BigInt` stroops, IndexedDB v3 separado por rol, reconciliación `is_redeemed`, auto-sincronización y control acumulado offline en comercio, `QRScanner`, generación de QR compactos, íconos PWA y 9 pruebas unitarias TypeScript (`app/src/lib/__tests__/pagoasegurao.test.ts`).

## Partes elaboradas, auditadas y validadas por el equipo

- **Especificación funcional y modelo de confianza (`SPEC.md` y `CLAUDE.md`)**:
  - Definición del problema local (pagos sin señal en ferias, transporte y zonas rurales de Perú), requisitos de seguridad y límites conocidos.
- **Auditoría y validación en vivo**:
  - Detección y corrección de fallos críticos encontrados durante la revisión (autorización faltante en `close_vault`/`top_up`, compatibilidad XDR con Protocol 30 al actualizar a `@stellar/stellar-sdk 17.4.0`, reemplazo de respuestas simuladas por transacciones reales en Testnet y separación de colas en IndexedDB).
  - Verificación de cero secretos en el repositorio y validación directa de contratos y transacciones en `stellar.expert`.
