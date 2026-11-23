# Uso de IA — PagoAsegurao

Este documento cumple la regla 9 de CLAUDE.md y la exigencia de las bases de la Buildathon de declarar transparentemente el uso de IA en el README.

## Partes generadas con asistencia de IA

- **Contrato Soroban (`contracts/pagoasegurao/src/lib.rs`)**:
  - Implementación completa de `Vault`, `Voucher`, `Error`, almacenamiento persistente e instanciado.
  - Construcción de mensaje canónico de 161 bytes idéntico a `@stellar/stellar-sdk` (`ScVal` XDR).
  - Verificación de firma Ed25519 nativa con Soroban Host Crypto.
  - Transferencias directas de tokens mediante el cliente SAC (`token::Client`).
- **Pruebas unitarias de Rust (`contracts/pagoasegurao/src/test.rs`)**:
  - 11 casos de prueba cubriendo el flujo feliz, doble gasto, vales vencidos, firmas inválidas, límite por vale, saldo insuficiente, cierre anticipado vs después de expiración, y vector de prueba compartido.
- **Vector de prueba compartido (`test-vectors/voucher.json` y `scripts/verify-vector.ts`)**:
  - Validación cruzada byte a byte entre Rust y TypeScript.
- **PWA Frontend (`app/src/`)**:
  - Arquitectura reactiva offline-first con soporte para service workers y precache.
  - Pantalla de Cliente y Pantalla de Comercio con soporte para dos QR (QR-A de cobro y QR-B de vale firmado).
  - Componente de escaneo de cámara `QRScanner` (`html5-qrcode`) y generación de QR (`qrcode.react`).
  - Base de datos IndexedDB local (`idb`) para almacenamiento de claves, saldo de bóveda y cola de vales.
- **Relayer Serverless (`api/`)**:
  - Endpoints `/api/redeem`, `/api/faucet`, `/api/vault` para patrocinio de comisiones y simulación.
- **Script de automatización Testnet (`scripts/setup-testnet.ts`)**:
  - Preparación idempotente de cuentas, trustlines, SAC y contrato en testnet.

## Partes escritas o revisadas a mano

- **Especificación técnica (`SPEC.md`) y directivas (`CLAUDE.md`)**:
  - Elaboradas como base y fuente de verdad de requisitos y modelo de confianza.
- **Revisión de seguridad y convenciones**:
  - Verificación de cero secretos en el repositorio (solo `.env.example`).
  - Convenciones: código y comentarios en inglés; interfaz y documentación en español.
  - Restricción estricta a Stellar Testnet.
