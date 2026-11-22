# PagoAsegurao

Pagos sin internet sobre Stellar testnet. Un cliente firma un vale offline, el comercio lo recibe por QR y lo liquida después cuando recupera conexión; un contrato Soroban paga desde una bóveda de fondos apartados.

English: Offline payments on Stellar testnet. A customer signs a voucher offline, the merchant receives it via QR and settles later once back online; a Soroban contract pays from a vault of reserved funds.

**Eslogan:** "Tu pago, asegurao, con o sin señal".

---

## Problema que resuelve

En ferias, buses y zonas rurales la señal falla justo cuando hay que cobrar, y los pagos digitales dejan de funcionar.

## Solución y flujo

El cliente aparta fondos en una bóveda del contrato **antes** de quedarse sin señal. Sin internet, firma vales que el comercio verifica localmente y liquida después. El contrato garantiza que cada vale se pague una sola vez, solo al comercio indicado y solo desde fondos ya apartados.

1. **Online (preparación):** cliente crea cuenta testnet, recibe USDC de prueba y abre una bóveda (`open_vault`).
2. **Offline (sin internet):** comercio muestra QR-A (cobro); cliente escanea, confirma y firma el vale; muestra QR-B. El comercio escanea QR-B, verifica la firma localmente y guarda el vale en una cola.
3. **Online (liquidación):** el comercio envía los vales al relayer; el relayer llama a `redeem` en el contrato y el comercio recibe los USDC desde la bóveda del cliente. Al vencer la bóveda, `close_vault` devuelve el saldo no gastado.

## Arquitectura

- **Contrato Soroban** (`contracts/pagoasegurao`): bóvedas, vales, canje y cierre. Activo de prueba USDC envuelto con SAC.
- **App PWA** (`app/`): Vite + React + TypeScript + PWA, dos modos (cliente y comercio), IndexedDB (`idb`), QR, offline-first.
- **Relayer** (`api/`): funciones serverless (Vercel) que patrocinan la comisión y exponen `/redeem`, `/faucet`, `/vault/:signer`.

## Cómo ejecutarlo (desde cero)

1. Instalar herramientas: Rust, `stellar` CLI, Node.js, pnpm.
2. Copiar `.env.example` a `.env` y rellenar solo variables públicas (nunca secretos).
3. Contrato: `cargo test`, `cargo fmt && cargo clippy`, `stellar contract build`.
4. Testnet: `pnpm tsx scripts/setup-testnet.ts` (crea emisor, activo, despliega, fondea cuentas y escribe `deployments/testnet.json`).
5. App: `pnpm install` y `pnpm dev`.
6. Relayer: desplegar `api/` en Vercel con `RELAYER_SECRET` en variables de entorno.

## ID del contrato y direcciones en testnet

Ver `deployments/testnet.json` (IDs públicos, sin secretos) y `docs/progress.md` con enlaces a stellar.expert tras el despliegue.

## Integrantes

Equipo PagoAsegurao — Buildathon Stellar Codember Perú 2026.

## Uso de IA y código previo

Ver `docs/ai-usage.md`. Estructura y esqueleto generados con asistencia de IA; revisados y adaptados a `SPEC.md`.

## Limitaciones conocidas

- Solo testnet. Nunca mainnet.
- La clave de firma vive en el navegador (IndexedDB): aceptable solo para demo/testnet.
- Estando offline, un cliente deshonesto podría firmar más vales que su saldo; el contrato paga por orden de llegada y los excedentes fallan. Mitigación: tope por vale y saldo local en la app.
- HTTPS requerido para la cámara (desplegar en host con HTTPS).

## Enlaces

- App desplegada: (pendiente)
- Video demo: (pendiente, máximo 3 minutos)

## Licencia

MIT. Ver `LICENSE`.