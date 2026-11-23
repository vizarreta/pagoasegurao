# PagoAsegurao

> **Offline payments on Stellar testnet.** A customer locks funds in a Soroban smart contract vault beforehand. Offline, the merchant displays a charge QR (QR-A), the customer signs a digital voucher and displays QR-B. The merchant verifies the signature locally without signal, queues the payment, and settles it on Stellar testnet once connection returns.

**Eslogan:** *"Tu pago, asegurao, con o sin señal"*.  
**Buildathon:** Stellar Codember Perú 2026.

---

## 1. Problema que resuelve

En ferias itinerantes, transporte público y zonas rurales de Perú y Latinoamérica, la señal celular es inestable o nula. Cuando un cliente intenta pagar digitalmente (billeteras móviles o transferencias tradicionales), la transacción falla por falta de internet, forzando el regreso al efectivo o perdiendo ventas.

## 2. Propuesta y solución

**PagoAsegurao** permite transaccionar de forma segura sin conexión a internet:
- **Antes de salir a la feria:** El cliente aparta fondos en una bóveda del contrato Soroban (`open_vault`), definiendo una vigencia y un tope por compra.
- **Sin internet (modo avión en dos celulares):**
  1. El comercio ingresa el monto a cobrar y genera el **QR-A** (cobro).
  2. El cliente escanea el QR-A, revisa los datos y autoriza el pago. Su dispositivo firma criptográficamente (Ed25519) un vale digital y genera el **QR-B** (vale firmado).
  3. El comercio escanea el QR-B y **verifica la firma criptográfica localmente sin señal**. Al ser válida, la app muestra *"Pago recibido (pendiente de liquidar)"* y guarda el vale en una cola local protegida en IndexedDB.
- **Al recuperar conexión:** La app del comercio sincroniza la cola con el relayer, que ejecuta la función `redeem` en Soroban pagando las comisiones de red (*fee sponsorship*). Los USDC se transfieren de la bóveda del cliente a la cuenta del comercio.

```
       FASE ONLINE (Con señal)
       Cliente -> open_vault(monto, vigencia, tope_por_vale)
                          │
                          ▼
       FASE OFFLINE (Modo Avión / Sin Señal)
       Comercio ────── QR-A (Cobro) ───────> Cliente
       Comercio <── QR-B (Vale firmado) ── Cliente
       [Comercio verifica firma Ed25519 offline]
                          │
                          ▼
       FASE ONLINE (Liquidación al volver señal)
       Comercio ──> Relayer ──> Contrato Soroban (`redeem`)
       Contrato ──> Transfiere USDC a Comercio
```

## 3. Arquitectura del sistema

1. **Contrato Inteligente Soroban (`contracts/pagoasegurao`)**:
   - `open_vault`: Bloquea tokens USDC del cliente y define tope por vale y tiempo de expiración.
   - `top_up`: Incrementa el saldo de la bóveda.
   - `redeem`: Valida la firma del vale, verifica vigencia y topes, previene doble canje con nonces y transfiere los fondos al comercio.
   - `close_vault`: Permite al cliente retirar el remanente una vez expirada la bóveda.
   - Serialización canónica de 161 bytes compatible byte a byte con `@stellar/stellar-sdk`.

2. **Aplicación Móvil PWA (`app/`)**:
   - Construida con React 18, TypeScript, Vite y `vite-plugin-pwa` (Workbox precaching para operar 100% offline).
   - Base de datos local IndexedDB (`idb`) para almacenar claves, estado de bóveda y cola de cobros.
   - Escaneo de QR por cámara optimizado para iOS Safari y Android Chrome (`html5-qrcode`) con fallback de texto.

3. **Relayer Serverless (`api/`)**:
   - Funciones TypeScript pensadas para Vercel (`/api/redeem`, `/api/faucet`, `/api/vault`).
   - Implementa patrocinio de comisiones (*fee sponsorship*) para que el comercio no requiera saldo XLM al liquidar sus cobros.

## 4. Instrucciones de ejecución

### Prerrequisitos
- Node.js v18+ y `pnpm`
- Rust 1.80+ con target `wasm32-unknown-unknown`

### Pasos rápidos

```bash
# 1. Instalar dependencias del proyecto
pnpm install

# 2. Compilar y verificar el contrato Soroban
cargo test
cargo fmt --check
cargo clippy -- -D warnings
cargo build --target wasm32-unknown-unknown --release

# 3. Validar el vector de prueba canónico compartido
pnpm tsx scripts/verify-vector.ts

# 4. Iniciar la aplicación web en modo desarrollo
pnpm dev

# 5. Compilar la PWA para producción
pnpm build
```

## 5. Pruebas automáticas (`cargo test`)

El contrato cuenta con 11 pruebas unitarias completas que cubren todos los escenarios de seguridad:
1. `test_happy_path_open_and_redeem`: Flujo feliz de apertura y cobro.
2. `test_double_redeem_fails`: Detección y rechazo de doble canje del mismo vale.
3. `test_invalid_signature_fails`: Rechazo ante alteración del mensaje o firma inválida.
4. `test_voucher_signed_by_other_key_fails`: Rechazo si el vale fue firmado con otra clave.
5. `test_expired_voucher_fails`: Rechazo de vales con tiempo de expiración vencido.
6. `test_wrong_merchant_fails`: Rechazo si se intenta cobrar a nombre de otro comercio.
7. `test_amount_above_max_per_voucher_fails`: Cumplimiento del tope máximo por vale.
8. `test_insufficient_funds_fails_without_state_change`: Fallo atómico ante saldo insuficiente.
9. `test_close_vault_lifecycle`: Imposibilidad de retiro anticipado y recuperación post-expiración.
10. `test_voucher_from_another_contract_fails`: Protección contra ataques de repetición en otros contratos.
11. `test_shared_test_vector_matches_typescript`: Validación idéntica del vector compartido con TypeScript.

## 6. Transparencia sobre IA y atribuciones

De acuerdo con las bases de la Buildathon Stellar Codember Perú 2026, el uso de herramientas de asistencia de Inteligencia Artificial se encuentra documentado detalladamente en [`docs/ai-usage.md`](docs/ai-usage.md).

## 7. Limitaciones conocidas y modelo de confianza

- **Solo Testnet:** Este proyecto está diseñado exclusivamente para Stellar Testnet.
- **Riesgo offline:** En modo desconectado, el comercio confía en la firma y el saldo reportado por la bóveda del cliente. Para mitigar riesgos de sobregiro offline, el contrato impone un tope estricto por vale (`max_per_voucher`) y la app del cliente descuenta el saldo localmente.
- **Almacenamiento de claves:** En este prototipo las claves residen en IndexedDB en el navegador para efectos de la demo. En producción se integrará WebAuthn / Passkeys o hardware seguro.

## 8. Licencia

Distribuido bajo licencia MIT. Consulte `LICENSE` para más detalles.
