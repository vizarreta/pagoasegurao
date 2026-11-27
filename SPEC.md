# SPEC — PagoAsegurao

**Nombre:** *PagoAsegurao* = "pago asegurado" dicho como se habla en la calle. Transmite la idea central del producto: el comercio sabe que su cobro está respaldado por fondos ya apartados. Eslogan: **"Tu pago, asegurao, con o sin señal"**.

**Cuidado con la promesa del nombre:** "asegurado" aplica a los fondos apartados en la bóveda, no a cualquier monto que un cliente deshonesto pudiera firmar offline (ver sección 3). En el README y en el video, decir siempre **"asegurado hasta el monto apartado"**.

Pagos sin internet sobre Stellar testnet en **Soles de prueba (`S/` · `tPEN`)**. Un cliente firma un vale offline, el comercio lo recibe por QR y lo liquida cuando recupera conexión; un contrato Soroban paga desde una bóveda de fondos apartados.

## 1. Problema y propuesta

- **Problema:** en ferias itinerantes, mercados de abastos, buses y zonas rurales del Perú la señal falla justo cuando hay que cobrar, y los pagos digitales dejan de funcionar.
- **Propuesta:** el cliente aparta fondos en una bóveda del contrato *antes* de quedarse sin señal. Sin internet, firma vales en Soles de prueba (`tPEN`) que el comercio verifica localmente y liquida después. El contrato garantiza que cada vale se pague una sola vez, solo al comercio indicado y solo desde fondos ya apartados.
- **Qué debe verse en la demo:** dos celulares en modo avión completan un pago (`QR-A` → `QR-B`); al reconectar, el comercio recibe los fondos y se ve la transacción en `stellar.expert`.

## 2. Flujo de extremo a extremo

```
FASE ONLINE (preparación)
  Cliente: crea cuenta (testnet) → activa trustline y recibe tPEN (S/ de prueba) → open_vault(monto, vencimiento, tope)
  Comercio: activa cuenta y trustline tPEN (una sola vez)

FASE OFFLINE (sin internet / Modo Avión)
  Comercio: ingresa monto en S/ → muestra QR-A (cobro)
  Cliente:  escanea QR-A → revisa comercio y monto → confirma → firma vale Ed25519 → muestra QR-B
  Comercio: escanea QR-B → verifica firma, monto, receptor y vigencia localmente → "Pago recibido (pendiente de liquidar)"
            → guarda el vale en su cola local (IndexedDB)

FASE ONLINE (liquidación)
  Comercio → relayer: sincroniza los vales de la cola (auto-sync al abrir / reconectar o manual)
  Relayer → contrato: redeem(vale, firma)  (el relayer patrocina la comisión)
  Contrato → comercio: transfiere tPEN (S/) desde la bóveda del cliente
  Cliente: al vencer la bóveda, close_vault() devuelve el saldo no gastado
```

**Decisión de diseño:** se usan dos QR (`QR-A` cobro del comercio y `QR-B` vale del cliente) en lugar de uno. Así el vale queda atado a un comercio y a un monto concretos, y nadie que vea el QR del cliente puede cobrarlo.

## 3. Modelo de confianza (leer antes de diseñar)

**Lo que el contrato garantiza:**

- Un vale solo se paga una vez (nonce único en almacenamiento persistente).
- Solo se paga al comercio que figura en el vale (`voucher.merchant`).
- Nunca se paga más que el saldo de la bóveda (`vault.balance >= amount`).
- Un vale con firma inválida, vencido (`now > voucher.expiry` o `voucher.expiry > vault.expires_at`), monto inválido o por encima del tope por vale se rechaza.
- El dueño no puede retirar fondos antes del vencimiento de la bóveda (`now < vault.expires_at`), así que los fondos apartados siguen disponibles para liquidar.

**Riesgo residual (documentarlo en el README, no esconderlo):**

- Estando offline, nadie puede impedir que un cliente deshonesto firme más vales que su saldo. El contrato paga por orden de llegada y los que exceden el saldo fallan.
- Mitigaciones del MVP: tope por vale (`max_per_voucher`); la app del cliente lleva un libro local (reconciliado con `is_redeemed` y expiración) y se niega a firmar de más; la app del comercio consulta/cachea la bóveda del cliente, suma vales pendientes acumulados de ese cliente y advierte si supera el saldo conocido.
- Ideas futuras (fuera del MVP): reputación, límites por comercio, hardware seguro / Passkeys WebAuthn.

**Otros límites conocidos:**

- La clave de firma vive en el navegador (IndexedDB). Es aceptable solo para testnet y demo.
- El relayer no puede mover fondos: solo envía vales ya firmados y gasta comisiones.
- El comercio debe ser una cuenta Stellar normal (dirección `G...`) con trustline a `tPEN`.

### 3.1 Mitigaciones de producto (M1–M10)

Prioridad: obligatorias (MVP) → recomendadas → mejoras futuras.

**Implementadas en el MVP**
- **M1 — Libro local y reconciliación del cliente:** calcula `saldo disponible = saldo on-chain − vales pendientes aún vigentes` y bloquea nuevas firmas si no alcanza. Al volver la señal consulta `is_redeemed` en Soroban y libera automáticamente saldos retenidos de vales que expiraron sin canjearse.
- **M2 — Topes por diseño:** bóveda con monto y tope máximo por vale (`max_per_voucher <= amount`), con valores sugeridos (`S/ 100` bóveda, `S/ 30` tope/vale).
- **M3 — Liquidación automática en el comercio:** sincroniza automáticamente al detectar el evento `online`, al abrir la app si ya hay internet y mediante botón manual, con bloqueo anti-concurrencia y reintentos transitorios RPC en el relayer.
- **M4 — Cuenta regresiva y prioridad por urgencia:** la cola del comercio ordena vales pendientes por vencimiento más próximo, muestra un banner resumen y etiquetas de vigencia con color (verde, ámbar, rojo, vencido) **sin bloquear** bóvedas de prueba corta (`2 min`) para la demo.
- **M7 — Reemisión desde historial:** el cliente puede volver a abrir el código `QR-B` de un vale pendiente vigente desde su historial.
- **M8 — Ventana larga por defecto + corta para demo:** 72 horas (`3 días`) por defecto y opción de `2 minutos` para probar en vivo el vencimiento y `close_vault`.
- **M9 — Control acumulado del comercio con `vault_cache`:** al recibir un `QR-B`, el comercio verifica `voucher.expiry <= vault.expires_at` cuando conoce la bóveda (en vivo o caché vigente) y advierte si `vales pendientes de ese cliente + vale nuevo > saldo conocido`.

**Fuera de alcance del MVP actual (roadmap futuro)**
- **M5 — PIN WebCrypto antes de firmar:** cifrar `secretKey` con PIN; se deja fuera del MVP para no entorpecer la demo en vivo ni migrar llaves demo existentes en IndexedDB.
- **M6 — Segunda vía de liquidación desde cliente:** envío voluntario desde la app del cliente (solo manual para no liquidar por error un vale que nunca se entregó al comercio).
- **M10 — Llaves separadas (`owner` vs `signer`):** el contrato ya separa `owner` y `signer`; para habilitarlo en producción se requerirá además autorización explícita de `signer` en `open_vault` para evitar secuestro de slots.

**Regla de diseño:** no se permite cancelar una bóveda antes de `expires_at`, porque dejaría sin pago a comercios con vales válidos. La recuperación de fondos espera al vencimiento.

## 4. Contrato Soroban (`contracts/pagoasegurao`)

### 4.1 Activo

Activo de prueba llamado `tPEN` (**Soles de prueba `S/`**, 7 decimales) emitido por una cuenta de testnet del proyecto y envuelto con su Stellar Asset Contract (SAC). **No es un token con valor ni un lanzamiento de token:** es un activo de prueba sin valor económico que representa Soles peruanos en el piloto. Declararlo en el README y en el video. El contrato recibe la dirección del token al inicializarse (`initialize(token)`), por lo que podría apuntar a USDC u otro stablecoin regulado en Stellar sin cambiar su lógica.

### 4.2 Estructuras

```rust
#[contracttype]
pub struct Vault {
    pub owner: Address,        // recibe el saldo restante al cerrar
    pub balance: i128,         // fondos disponibles
    pub expires_at: u64,       // timestamp unix (s); fin de la ventana de liquidación
    pub max_per_voucher: i128, // tope por vale
}

#[contracttype]
pub struct Voucher {
    pub signer: BytesN<32>,    // clave pública ed25519 que firma (identifica la bóveda)
    pub merchant: Address,     // quien cobra
    pub amount: i128,
    pub nonce: u64,            // aleatorio, único por vale
    pub expiry: u64,           // timestamp unix (s); el vale debe liquidarse antes
}
```

### 4.3 Funciones

| Función | Quién la llama | Qué hace |
|---|---|---|
| `initialize(token)` | despliegue | Guarda la dirección del token SAC; falla con `AlreadyInitialized (#11)` si ya fue inicializado. |
| `get_token()` | lectura | Devuelve la dirección del token registrado. |
| `open_vault(owner, signer, amount, expires_at, max_per_voucher)` | cliente (`owner.require_auth()`) | Valida `amount > 0`, `0 < max_per_voucher <= amount`, `expires_at > now` y que no exista bóveda; transfiere `amount` al contrato y crea `Vault(signer)` con TTL dinámico. |
| `top_up(owner, signer, amount)` | cliente (`owner.require_auth()`) | Exige `vault.owner == owner`, `amount > 0` y `now < vault.expires_at`; suma saldo a la bóveda y extiende TTL. |
| `redeem(voucher, signature)` | cualquiera (relayer o comercio) | Valida y paga al comercio (`voucher.merchant`). Permite *fee sponsorship* del relayer. |
| `close_vault(owner, signer)` | cliente (`owner.require_auth()`) | Exige `vault.owner == owner` y `now >= vault.expires_at`. Devuelve el saldo y elimina `Vault(signer)`. |
| `get_vault(signer)` | lectura | Devuelve `Option<Vault>`. |
| `is_redeemed(signer, nonce)` | lectura | Indica si el vale ya se canjeó (`bool`). |

### 4.4 Mensaje canónico a firmar

Idéntico byte a byte entre Rust y TypeScript (**161 bytes exactos**):

```
msg = "PAGOASEGURAO1" (ASCII, 13 bytes)
   || contract_address_xdr  (ScVal::Address XDR, 40 bytes)
   || signer                (32 bytes)
   || merchant_address_xdr  (ScVal::Address XDR, 44 bytes)
   || amount                (i128 big-endian, 16 bytes)
   || nonce                 (u64 big-endian, 8 bytes)
   || expiry                (u64 big-endian, 8 bytes)
```

- `*_address_xdr`: en Rust, `to_xdr(&env)`; en TypeScript, `Address.fromString(...).toScVal().toXDR()`.
- Firma Ed25519 sin hash previo (`Keypair.sign(msg)` en TS; `env.crypto().ed25519_verify(...)` en Soroban).
- Incluir la dirección del contrato evita que un vale se reutilice en otro despliegue.

### 4.5 Orden de validación en `redeem`

1. El nonce no fue usado (`!has(Used(signer, nonce))`).
2. `ledger.timestamp() <= voucher.expiry` y `voucher.expiry <= vault.expires_at`.
3. `0 < amount <= vault.max_per_voucher`.
4. Firma Ed25519 válida (`ed25519_verify`, que aborta/panic si falla).
5. `vault.balance >= amount`.
6. **Efectos primero (CEI):** marcar nonce usado con TTL y descontar saldo.
7. Transferir `amount` del contrato al comercio vía SAC.
8. Emitir evento tipado `Redeemed` (`#[contractevent]`).

### 4.6 Almacenamiento y errores

- `instance`: `DataKey::Token`.
- `persistent`: `DataKey::Vault(signer)` y `DataKey::Used(signer, nonce)` con extensión dinámica de TTL (`compute_ttl`: mínimo ~7 días y al menos `expires_at + ~1 día` limitado por `max_ttl`).
- Errores estables `#1`–`#11` (`#[contracterror]`): `AlreadyRedeemed = 1`, `VoucherExpired = 2`, `InvalidAmount = 3`, `InsufficientFunds = 4`, `VaultNotFound = 5`, `VaultStillActive = 6`, `VaultExists = 7`, `InvalidSignature = 8`, `Unauthorized = 9`, `InvalidExpiry = 10`, `AlreadyInitialized = 11`. Mapeados a español desde una tabla compartida (`api/_errors.ts`).

### 4.7 Pruebas obligatorias (`cargo test` y `pnpm test:app`)

**Contrato Rust (21 pruebas en `contracts/pagoasegurao/src/test.rs`):**
1–10. Flujo feliz, doble canje, firma alterada, otra clave, vale vencido, comercio distinto, monto mayor al tope, fondos insuficientes sin alterar estado, ciclo `close_vault`, vale de otro contrato.
11. **Vector de prueba compartido (`test-vectors/voucher.json`):** leído directamente por Rust vía `include_str!` y verificado en TypeScript por `scripts/verify-vector.ts` y `app/src/lib/__tests__/pagoasegurao.test.ts`.
12–21. Autorización en `close_vault` y `top_up`, expiración pasada al abrir, `voucher.expiry > vault.expires_at`, `max_per_voucher > amount`, monto cero en `open_vault`/`redeem`, `top_up` tras expiración o sobre bóveda inexistente y doble `initialize`.

**App TypeScript (9 pruebas en `app/src/lib/__tests__/pagoasegurao.test.ts`):**
- Aritmética exacta `BigInt` stroops (sin floats), tabla compartida `#1`–`#11`, `QR-A`/`QR-B`, verificación offline (incluyendo `voucher.expiry <= vault.expires_at`), exposición acumulada offline, urgencia en cola y vector compartido.

## 5. Formato de los QR

Binario compacto, codificado en base64url sin padding, con prefijo de versión (menor a 300 caracteres):

- **QR-A (cobro, 48 bytes / ~69 chars):** `SSC1.` + base64url( `merchant_pubkey[32]` | `amount_u64[8]` | `request_id[8]` ).
- **QR-B (vale, 152 bytes / ~208 chars):** `SSV1.` + base64url( `signer[32]` | `merchant_pubkey[32]` | `amount_u64[8]` | `nonce_u64[8]` | `expiry_u64[8]` | `signature[64]` ).

`amount_u64` representa un entero positivo en stroops (`1..=i64::MAX`, 7 decimales) que se convierte a `i128` en el mensaje canónico y contrato. El comercio valida localmente en `QR-B`: firma Ed25519 correcta, `merchant` igual al suyo, `amount` igual al cobro activo (si hay `QR-A` activo), `expiry >= now` y `expiry <= vault.expires_at` (cuando la bóveda está en caché activa o consultada en vivo).

## 6. Aplicación (PWA, `app/`)

Una sola PWA con dos modos: **Cliente** y **Comercio**. Interfaz en español, pensada para teléfono.

### 6.1 Requisitos transversales

- Funciona sin internet tras la primera carga (`vite-plugin-pwa` / Workbox precache). Indicador sticky `En línea / Sin conexión` siempre visible.
- Almacenamiento local con `idb` (IndexedDB v4): almacenes separados `keys`, `vault`, `client_vouchers`, `merchant_vouchers`, `vault_cache`.
- Lectura de QR con cámara (`html5-qrcode`) más entrada manual/portapapeles de respaldo.
- Desplegada sobre HTTPS en Vercel (`https://pagoasegurao.vercel.app`).

### 6.2 Modo Cliente

1. Crear cuenta local (clave Ed25519 en dispositivo).
2. Activar cuenta y pedir fondos de prueba (`/api/faucet` + trustline `tPEN` de `S/ 200.00`).
3. Abrir / recargar bóveda (`open_vault`, `top_up`).
4. Pagar sin señal: escanear `QR-A` → confirmar → mostrar `QR-B` (validando colisión de nonce).
5. Historial con estados (`Pendiente`, `Liquidado`, `Vencido`) reconciliados vía `is_redeemed` y reemisión de QR pendiente.
6. Cerrar bóveda al vencer (`close_vault`) y recuperar saldo restante.

### 6.3 Modo Comercio

1. Activar cuenta de comercio con trustline `tPEN` (Friendbot + `changeTrust`).
2. Cobrar: ingresar monto (o chips `S/ 2`, `S/ 5`, `S/ 10`, `S/ 20`) → mostrar `QR-A` (persistido en `sessionStorage` al cambiar de pestaña).
3. Recibir: escanear `QR-B` → verificación criptográfica y control acumulado offline → `"Pago recibido"`.
4. Cola de vales ordenada por urgencia con etiqueta de tiempo restante, estados (`Pendiente`, `Confirmando en Stellar`, `Liquidado en Stellar`, `Rechazado` con reintento).
5. Sincronización automática al abrir la app online, al volver la conexión y con botón manual.

## 7. Relayer (`api/`)

Backend serverless ESM en TypeScript (Vercel Functions) que patrocina comisiones (*fee sponsorship*):

- `POST /api/redeem`: idempotencia vía `is_redeemed` (`HTTP 409`), valida trustline `tPEN` del comercio, simula y envía con reintentos RPC transitorios, traduce errores `#1`–`#11` usando `api/_errors.ts` y responde `HTTP 200` o `HTTP 202 PENDING` dentro del límite de 10 s de Vercel Hobby.
- `POST /api/faucet`: fondea cuentas vía Friendbot y emite `S/ 200.00` (`200 tPEN` de prueba sin valor) con rate-limit en memoria por instancia (`cooldown` por cuenta + ráfaga IP).
- `GET /api/vault/:signer`: simula `get_vault` (manejo seguro de `Option::None`) y devuelve balances de Horizon.
- Las claves secretas (`RELAYER_SECRET`, `ISSUER_SECRET`) viven solo en variables de entorno; nunca en el repo.

## 8. Estructura del repositorio

```
pagoasegurao/
├─ CLAUDE.md
├─ SPEC.md
├─ README.md
├─ LICENSE                 (MIT)
├─ .gitignore
├─ .vercelignore
├─ .env.example
├─ Cargo.toml              (workspace Rust)
├─ Cargo.lock
├─ package.json
├─ vercel.json
├─ contracts/
│  └─ pagoasegurao/
│     ├─ Cargo.toml
│     ├─ src/lib.rs
│     ├─ src/test.rs
│     └─ test-vectors/voucher.json
├─ api/                    (relayer serverless Vercel ESM)
│  ├─ _errors.ts           (CONTRACT_ERROR_MAP compartido #1-#11)
│  ├─ _config.ts
│  ├─ faucet.ts
│  ├─ redeem.ts
│  └─ vault.ts
├─ app/                    (Vite + React + TS + PWA)
│  ├─ vite.config.ts
│  ├─ src/components/QRScanner.tsx
│  ├─ src/lib/             (stellar.ts, voucher.ts, qr.ts, storage.ts, __tests__/pagoasegurao.test.ts)
│  └─ src/screens/         (cliente.tsx, comercio.tsx)
├─ scripts/
│  ├─ setup-testnet.ts
│  ├─ verify-vector.ts
│  └─ test-e2e-api.ts
├─ deployments/
│  └─ testnet.json         (IDs públicos; sin secretos)
└─ docs/
   ├─ progress.md
   ├─ ai-usage.md
   ├─ architecture.md
   └─ demo-script.md
```

## 9. Fases

Entrega final de la Buildathon: **viernes 4 de diciembre de 2026** (meta interna: jueves 3).

- **Fases 0–5 (Preparación, Contrato, Testnet `tPEN`, PWA Cliente/Comercio, Relayer, E2E y PWA HTTPS):** **COMPLETADAS.**
- **Fase 6 — Cierre y entrega (26 nov – 3 dic):**
  - Validar demo física con 2 celulares reales en Modo Avión 3 veces seguidas en `https://pagoasegurao.vercel.app`.
  - Completar usuario GitHub de Gustavo Alexander Flores Vera y enlace del video demo (máx. 3 min) en `README.md`.
  - Confirmar registro en Build Hub / entrega final en APEX.

## 10. Checklist del README (exigido por las bases)

- [x] Resumen en inglés (3–4 líneas) y luego todo en español.
- [x] Problema que resuelve.
- [x] Solución y flujo (con diagrama).
- [x] Arquitectura: contrato, app, relayer.
- [x] Cómo ejecutarlo (paso a paso, desde cero).
- [x] **ID del contrato y direcciones en testnet**, con enlaces a stellar.expert.
- [ ] Integrantes *(falta enlace GitHub de Gustavo Alexander Flores Vera)*.
- [x] **Uso de IA y de código previo o de terceros** (qué partes, cómo se revisó).
- [x] Limitaciones conocidas (sección 3).
- [ ] Enlaces: app desplegada (`https://pagoasegurao.vercel.app` listo), video demo *(pendiente grabar y enlazar)*.
- [x] Licencia MIT.

## 11. Guion del video demo (máximo 3 minutos)

Ver guion detallado en `docs/demo-script.md`:
1. **0:00–0:25 Problema:** feria/bus sin señal en Perú y por qué fallan billeteras tradicionales.
2. **0:25–0:55 Idea y arquitectura:** bóveda en Soles (`tPEN`) → vale offline → liquidación patrocinada.
3. **0:55–2:20 Demo en vivo:** dos celulares en Modo Avión (`QR-A` → `QR-B`), reconexión, liquidación automática y verificación en `stellar.expert`.
4. **2:20–2:50 Por qué Stellar:** Soroban + `ed25519_verify`, SAC (`tPEN`, compatible con USDC), comisiones patrocinadas, finalidad ~5 s.
5. **2:50–3:00 Límites y siguientes pasos.**
