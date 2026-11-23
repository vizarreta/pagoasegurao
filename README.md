# PagoAsegurao

> **Offline payments on Stellar Testnet.** A customer pre-funds a Soroban smart-contract vault (`open_vault`) before losing cell signal. Offline (Airplane Mode on both phones), the merchant displays a charge QR (`QR-A`), the customer signs a 161-byte canonical Ed25519 voucher (`QR-B`), and the merchant verifies it locally with zero connectivity. Once signal returns, a fee-sponsoring relayer settles the voucher on Stellar Testnet (`redeem`), paying the merchant from the locked vault.

**Eslogan:** *"Tu pago, asegurao, con o sin señal"* (asegurado hasta el monto apartado).  
**Competencia:** Buildathon Stellar Codember Perú 2026.  
**Red:** Exclusivamente Stellar Testnet (nunca mainnet).

---

## 1. Problema que resuelve

En ferias itinerantes, mercados de abastos, transporte público y zonas rurales del Perú y Latinoamérica, la señal móvil se corta justo al momento de cobrar. Las billeteras digitales tradicionales fallan sin conexión, obligando a volver al efectivo o perdiendo ventas.

**Usuario objetivo:** pequeños comercios (ferias, puestos de mercado, transporte) y compradores que ya usan pagos digitales pero sufren cortes de señal.

---

## 2. Solución y flujo de extremo a extremo

**PagoAsegurao** permite cobrar y pagar sin conexión a internet manteniendo el pago **asegurado hasta el monto apartado** en una bóveda del contrato Soroban:

1. **Fase Online (antes de salir a la feria):** el cliente activa su cuenta en Stellar Testnet, recibe `tUSDC` de prueba y aparta fondos en el contrato Soroban (`open_vault`), fijando vigencia y tope máximo por compra (`max_per_voucher`).
2. **Fase Offline (Modo Avión en ambos teléfonos):**
   - El comercio ingresa el monto y muestra **QR-A** (`SSC1.`, ~69 caracteres).
   - El cliente escanea **QR-A**, revisa comercio y monto, firma un vale Ed25519 localmente, descuenta su saldo local y muestra **QR-B** (`SSV1.`, ~208 caracteres).
   - El comercio escanea **QR-B**, verifica criptográficamente la firma Ed25519, el receptor, el monto, el vencimiento y que el nonce no esté duplicado — todo **sin señal** — y guarda el vale en su cola local (IndexedDB).
3. **Fase Online (al recuperar señal):**
   - La PWA del comercio detecta el regreso de conexión y sincroniza automáticamente la cola con el relayer (`POST /api/redeem`).
   - El relayer patrocina las comisiones de red (*fee sponsorship*) y ejecuta `redeem` en Soroban. El contrato transfiere los `tUSDC` desde la bóveda del cliente hacia el comercio.
   - Al vencer la bóveda, el cliente ejecuta `close_vault` y recupera el saldo no gastado.

```
FASE ONLINE (con señal)
  Cliente  ──> open_vault(monto, vencimiento, tope_por_vale) ──> Contrato Soroban
  Comercio ──> activa trustline tUSDC (una sola vez)

FASE OFFLINE (Modo Avión / Sin Señal)
  Comercio ────── QR-A (SSC1. cobro) ──────> Cliente
  Comercio <───── QR-B (SSV1. vale Ed25519) ── Cliente
  [Comercio verifica firma Ed25519 localmente y encola en IndexedDB]

FASE ONLINE (liquidación al volver señal)
  Comercio ──> Relayer (/api/redeem, patrocina fees) ──> Contrato Soroban (redeem)
  Contrato ──> Transfiere tUSDC de la bóveda al Comercio (finalidad ~5s)
  Cliente  ──> close_vault() al vencer ──> recupera saldo restante
```

> **Sobre `tUSDC`:** `tUSDC` es un activo de prueba sin valor económico emitido en Stellar Testnet y envuelto con su Stellar Asset Contract (SAC) para simular un stablecoin como USDC. No representa un token especulativo ni tiene valor financiero. El contrato recibe la dirección del token al inicializarse, por lo que podría usar USDC real sin cambiar su lógica.

---

## 3. Despliegue verificado en Stellar Testnet

Todos los contratos y transacciones están desplegados y verificables en **Stellar Testnet (Protocol 30)**:

| Recurso | ID / Hash | Explorador (`stellar.expert`) |
|---|---|---|
| **Contrato `PagoAsegurao`** | `CD2XXTNNXVP2VCYL2RID4EIQCCADQPM24ZENU6CZAHJ4DAZJAQEZML5O` | [Ver contrato](https://stellar.expert/explorer/testnet/contract/CD2XXTNNXVP2VCYL2RID4EIQCCADQPM24ZENU6CZAHJ4DAZJAQEZML5O) |
| **Token `tUSDC` (SAC)** | `CA7N5AY7VBL4BHPOOLRONB5HC2XAT2ADIZOCFEK5IMDNZU2DFDQPWRMD` | [Ver token SAC](https://stellar.expert/explorer/testnet/contract/CA7N5AY7VBL4BHPOOLRONB5HC2XAT2ADIZOCFEK5IMDNZU2DFDQPWRMD) |
| **Emisor `tUSDC`** | `GDX4ZNACYNYJFY2QK6P7BKSF5UTDUYFY6J5VLRHMEN2H76KSN6N3AWYL` | [Ver cuenta](https://stellar.expert/explorer/testnet/account/GDX4ZNACYNYJFY2QK6P7BKSF5UTDUYFY6J5VLRHMEN2H76KSN6N3AWYL) |
| **Relayer (Fee Sponsor)** | `GDTAPYWCT4VCDKAQ7NUI6E5NQ6DYXDX5AV7OUF7ACQ6JO575ZMRPKBQV` | [Ver cuenta](https://stellar.expert/explorer/testnet/account/GDTAPYWCT4VCDKAQ7NUI6E5NQ6DYXDX5AV7OUF7ACQ6JO575ZMRPKBQV) |
| **Tx `open_vault` (demo)** | `9744d0e8...046bb124` | [Ver transacción](https://stellar.expert/explorer/testnet/tx/9744d0e86e6bfa8a8936ce4ac23437ed34416ad6ab1440af581ac01c046bb124) |
| **Tx `redeem` patrocinado** | `cb7d31d2...ccdaa7c3` | [Ver transacción](https://stellar.expert/explorer/testnet/tx/cb7d31d2dc40601467a90cbe1b6a6f743e90e38a974bb93bff8ec5c2ccdaa7c3) |
| **Tx `top_up` (+5 tUSDC)** | `e17e335f...29d0acc60` | [Ver transacción](https://stellar.expert/explorer/testnet/tx/e17e335fbada3595c08694e94b9bdae7bb49bef859e9ab20102ebf329d0acc60) |
| **Tx `close_vault` (devolución)** | `204ef56b...5b3b80094` | [Ver transacción](https://stellar.expert/explorer/testnet/tx/204ef56b48b249f6afa2ae7f2951222b1ef03eaf2c61f19e172ace05b3b80094) |

Todos los IDs públicos y hashes también están registrados en [`deployments/testnet.json`](deployments/testnet.json).

---

## 4. Arquitectura del sistema

Ver detalle completo en [`docs/architecture.md`](docs/architecture.md).

1. **Contrato Inteligente Soroban (`contracts/pagoasegurao`)** — Rust + `soroban-sdk 29.0.1`, compilado con `stellar contract build` al target `wasm32v1-none` (8,910 bytes optimizados):
   - `initialize(token)` / `get_token()`: registra y consulta el SAC de `tUSDC`.
   - `open_vault(owner, signer, amount, expires_at, max_per_voucher)`: bloquea `tUSDC` del cliente en la bóveda y extiende el TTL dinámicamente más allá de `expires_at`.
   - `top_up(owner, signer, amount)`: permite al dueño original incrementar el saldo mientras la bóveda esté vigente.
   - `redeem(voucher, signature)`: verifica nonce único, vigencia, tope por vale, firma Ed25519 nativa (`env.crypto().ed25519_verify`) sobre el mensaje canónico de 161 bytes y saldo disponible; aplica efectos antes de transferir (patrón CEI) y emite evento `Redeemed`.
   - `close_vault(owner, signer)`: exige autorización del dueño original (`vault.owner == owner`) y que `now >= expires_at`, eliminando la bóveda y devolviendo el saldo remanente.
   - `get_vault(signer)` y `is_redeemed(signer, nonce)`: lectura del estado on-chain.
   - Códigos de error estables (`#1`–`#10`) traducidos a español claro en relayer y UI.

2. **Aplicación Móvil PWA (`app/`)** — React 18, TypeScript estricto, Vite 5, `vite-plugin-pwa` (Workbox precaching de 16 archivos) y `@stellar/stellar-sdk 17.4.0`:
   - Dos modos en una sola PWA: **Cliente (Pagar)** y **Comercio (Cobrar)**.
   - Almacenamiento local en IndexedDB v2 (`idb`) con almacenes separados (`client_vouchers`, `merchant_vouchers`, `vault_cache`, `keys`, `vault`).
   - Montos en enteros de 7 decimales (`BigInt` stroops, sin floats).
   - Escáner QR con cámara (`html5-qrcode`) compatible con iOS Safari y Android Chrome, más fallback manual/portapapeles.
   - Sincronización automática al volver la conexión (`window.addEventListener('online')`).

3. **Relayer Serverless (`api/`)** — TypeScript para Vercel (`vercel.json`):
   - `POST /api/redeem`: verifica idempotencia (`is_redeemed`), trustline del comercio, simula en Soroban, traduce errores `#1`–`#10` a español, patrocina comisiones con `RELAYER_SECRET` y espera confirmación en ledger.
   - `POST /api/faucet`: fondea cuentas vía Friendbot y emite 100 `tUSDC` de prueba (con rate limiting).
   - `GET /api/vault/:signer`: simula `get_vault` en Soroban y devuelve balances reales de Horizon.

---

## 5. Cómo ejecutarlo desde cero

### Prerrequisitos
- Node.js v20+ y `pnpm` v9+
- Rust (`rustup`) con target `wasm32v1-none`, `clippy` y `rustfmt`
- Stellar CLI (`stellar 30.x`)

### Pasos

```bash
# 1. Clonar e instalar dependencias JS/TS
git clone https://github.com/vizarreta/pagoasegurao.git
cd pagoasegurao
pnpm install

# 2. Probar, validar y compilar el contrato Soroban (15 pruebas unitarias)
cargo test --lib
cargo fmt --check
cargo clippy --lib --tests -- -D warnings
stellar contract build

# 3. Verificar el vector criptográfico compartido Rust <-> TypeScript
pnpm verify:vector

# 4. (Opcional) Desplegar un entorno fresco en Stellar Testnet y generar .env local
pnpm setup:testnet

# 5. Ejecutar la suite E2E de 12 escenarios reales contra Stellar Testnet
# (requiere .env con RELAYER_SECRET e ISSUER_SECRET generados en el paso 4)
pnpm test:e2e

# 6. Iniciar la PWA en desarrollo (conectada al relayer real de Stellar Testnet)
pnpm dev

# 7. Compilar la PWA de producción con Service Worker offline
pnpm build
```

---

## 6. Pruebas verificadas

### Contrato Soroban (`cargo test --lib`) — **15 / 15 pasando** (`clippy`: 0 warnings)
1. `test_happy_path_open_and_redeem`
2. `test_double_redeem_fails`
3. `test_invalid_signature_fails`
4. `test_voucher_signed_by_other_key_fails`
5. `test_expired_voucher_fails`
6. `test_wrong_merchant_fails`
7. `test_amount_above_max_per_voucher_fails`
8. `test_insufficient_funds_fails_without_state_change`
9. `test_close_vault_lifecycle`
10. `test_voucher_from_another_contract_fails`
11. `test_shared_test_vector_matches_typescript` (vector compartido de 161 bytes)
12. `test_close_vault_unauthorized_fails`
13. `test_top_up_authorized_and_unauthorized`
14. `test_open_vault_past_expiry_fails`
15. `test_voucher_expiry_after_vault_expiry_fails`

### Suite End-to-End en vivo (`pnpm test:e2e`) — **12 / 12 pasando en Stellar Testnet**
Valida en vivo: onboarding cliente y comercio (`/api/faucet` + trustline `tUSDC`), `open_vault`, `GET /api/vault/:signer`, flujo offline `QR-A -> QR-B` con verificación Ed25519 local, `POST /api/redeem` patrocinado por relayer, rechazos con mensaje claro en español (doble canje HTTP 409, monto sobre tope `#3`, vale vencido `#2`, firma alterada `#8`), `top_up`, rechazo de cierre anticipado (`#6`) y `close_vault` tras vencimiento con devolución de `tUSDC`.

---

## 7. Integrantes

- **Carlos Adrian Vizarreta Checya** — GitHub: [@vizarreta](https://github.com/vizarreta)
- **Gustavo Alexander Flores Vera** — *(completar enlace a perfil de GitHub)*

---

## 8. Uso de IA, código previo y librerías de terceros

- **Código previo:** Ninguno. Todo el código y diseño de **PagoAsegurao** se creó durante el periodo oficial de la Buildathon Stellar Codember Perú 2026 (del 14 de noviembre al 4 de diciembre de 2026). El proyecto no ha participado ni ganado premios en hackatones previas ni ha recibido financiamiento de Instawards/SCF.
- **Uso de IA:** Se utilizaron asistentes de IA (Claude y Gemini/Antigravity) para acelerar la implementación del contrato, pruebas, PWA, relayer y documentación, bajo revisión humana, auditoría de seguridad y pruebas ejecutadas en vivo sobre Stellar Testnet. El desglose detallado está en [`docs/ai-usage.md`](docs/ai-usage.md).
- **Librerías open source de terceros:** `soroban-sdk`, `ed25519-dalek`, `@stellar/stellar-sdk`, `react`, `vite`, `vite-plugin-pwa`, `idb`, `html5-qrcode`, `qrcode.react`, `lucide-react`, `buffer`.

---

## 9. Modelo de confianza y limitaciones conocidas

- **Asegurado hasta el monto apartado:** el contrato garantiza que cada vale se pague como máximo una vez (nonce), solo al comercio indicado, sin superar `max_per_voucher` ni el saldo de la bóveda, y que el cliente no pueda retirar fondos antes de `expires_at`.
- **Riesgo residual offline:** sin conexión, un cliente malicioso podría firmar vales cuya suma exceda el saldo de su bóveda; el contrato liquida por orden de llegada y rechaza los excedentes. **Mitigaciones en el MVP:** tope estricto por vale (`max_per_voucher`), descuento local inmediato en la app del cliente, y aviso en la app del comercio con el saldo de bóveda según última sincronización.
- **Claves en navegador (solo demo/testnet):** las claves Ed25519 viven en IndexedDB para facilitar la demo en dos celulares. En producción se integrarían Passkeys/WebAuthn o hardware seguro.
- **Solo Testnet:** no opera en mainnet ni maneja dinero real.

---

## 10. Entregables y enlaces

- **App desplegada (HTTPS / PWA en producción):** https://pagoasegurao.vercel.app
- **Repositorio público:** https://github.com/vizarreta/pagoasegurao
- **Contrato en Stellar Testnet:** https://stellar.expert/explorer/testnet/contract/CD2XXTNNXVP2VCYL2RID4EIQCCADQPM24ZENU6CZAHJ4DAZJAQEZML5O
- **Video demo (máx. 3 min):** *(pendiente de grabar — guion listo en [`docs/demo-script.md`](docs/demo-script.md))*

---

## 11. Licencia

Distribuido bajo licencia **MIT**. Ver [`LICENSE`](LICENSE).
