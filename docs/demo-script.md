# Guion del video demo — PagoAsegurao

Duración máxima: **3 minutos** (YouTube no listado, Google Drive o Loom con acceso abierto).

## 1. 0:00–0:25 — Problema
- Escena real (feria itinerante, mercado o bus en Perú): un cliente intenta pagar en Soles con billetera digital y la app falla por falta de señal.
- Mensaje clave: *"Sin señal, se pierde la venta o se regresa al efectivo. Con PagoAsegurao: tu pago, asegurao, con o sin señal — asegurado hasta el monto apartado."*

## 2. 0:25–0:55 — Idea y arquitectura
- Mostrar el diagrama del README:
  1. **Online:** cliente aparta **Soles de prueba (`S/` · `tPEN`, sin valor económico en Stellar Testnet)** en una bóveda del contrato Soroban (`open_vault`) con vencimiento y tope por compra.
  2. **Offline (Modo Avión):** comercio muestra `QR-A` -> cliente escanea, firma con Ed25519 y muestra `QR-B` -> comercio verifica la firma localmente sin internet.
  3. **Online:** al volver la señal, el relayer patrocina las comisiones (`redeem`) y Soroban paga al comercio en segundos.

## 3. 0:55–2:20 — Demo en vivo (dos celulares en https://pagoasegurao.vercel.app, Modo Avión)
- **Preparación online (15s):**
  - Teléfono 1 (Cliente): ya tiene `S/ 200.00` (`tPEN` de prueba) y abre bóveda con `S/ 100.00` (tope `S/ 30.00`, vigencia `2 minutos` si quieren mostrar también `close_vault` al final).
  - Teléfono 2 (Comercio): cuenta activa con trustline `tPEN` (saldo `S/ 0.00`).
- **Activar Modo Avión en ambos teléfonos (mostrar el badge naranja "Sin conexión"):**
  - Comercio toca `S/ 5.00` (o `S/ 10.00`) y genera **QR-A**.
  - Cliente presiona **"Pagar con Vale (Sin Señal)"**, escanea **QR-A**, confirma comercio y monto, y muestra **QR-B** (su saldo local baja a `S/ 95.00`).
  - Comercio escanea **QR-B**, verifica firma Ed25519 localmente y muestra **"Pago recibido (firma Ed25519 válida)"**.
- **Desactivar Modo Avión en el teléfono del comercio (mostrar badge verde "En línea"):**
  - La cola se sincroniza automáticamente con `/api/redeem` (el relayer paga las comisiones).
  - El vale cambia a **"Liquidado en Stellar"**, el saldo del comercio sube a `S/ 5.00` y se abre **"Ver tx"** en `stellar.expert`.
  - *(Opcional si usaron vigencia de 2 min)*: Cliente cierra bóveda vencida (`close_vault`) y recupera sus `S/ 95.00`.

## 4. 2:20–2:50 — Por qué Stellar
- **Soroban:** contrato liviano (8.9 KB WASM) con verificación nativa `ed25519_verify` y prevención de doble canje por nonce.
- **Activos locales / SAC:** usa `tPEN` (`S/`) en Testnet (activo de prueba sin valor económico), arquitectura agnóstica al activo lista para stablecoins reales.
- **Fee sponsorship y finalidad:** el comercio no necesita gestionar XLM para cobrar; liquidación en ~5 segundos.

## 5. 2:50–3:00 — Límites y siguientes pasos
- Transparencia: claves en navegador solo para demo/testnet; riesgo residual offline mitigado con tope por vale (`max_per_voucher`).
- Siguientes pasos: Passkeys/WebAuthn o hardware seguro y piloto en ferias reales.
