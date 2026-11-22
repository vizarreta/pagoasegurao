# Guion del video demo — PagoAsegurao

Duración máxima: 3 minutos.

## 1. 0:00–0:25 — Problema
Escena real (feria, bus o zona sin señal): un cliente intenta pagar digitalmente y falla por falta de conexión. Mensaje: "Sin señal, sin pago".

## 2. 0:25–0:55 — Idea y arquitectura
Diagrama simple: bóveda de fondos apartados → vale offline firmado → liquidación al recuperar conexión. Explicar que el comercio sabe que el cobro está respaldado ("asegurado hasta el monto apartado").

## 3. 0:55–2:20 — Demo en vivo (dos celulares, modo avión)
- Cliente abre bóveda y aparta fondos.
- Ambos teléfonos a modo avión.
- Comercio muestra QR-A (cobro).
- Cliente escanea QR-A, confirma y muestra QR-B (vale firmado).
- Comercio escanea QR-B, verifica localmente y lee "Pago recibido, pendiente de liquidar".
- Se apaga el modo avión; comercio sincroniza y liquida; se muestra la transacción en stellar.expert.
- Cliente cierra bóveda vencida y recupera el saldo no gastado.

## 4. 2:20–2:50 — Por qué Stellar
Soroban (contratos y verificación de firmas), USDC, comisiones patrocinadas mediante relayer, finalidad en segundos, solo testnet.

## 5. 2:50–3:00 — Límites y siguientes pasos
Clave en el navegador (solo demo/testnet), tope por vale, riesgo residual documentado en el README.
