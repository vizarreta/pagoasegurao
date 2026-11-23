# SPEC — PagoAsegurao

**Nombre:** *PagoAsegurao* = "pago asegurado" dicho como se habla en la calle. Transmite la idea central del producto: el comercio sabe que su cobro está respaldado por fondos ya apartados. Eslogan sugerido: "Tu pago, asegurao, con o sin señal".

**Cuidado con la promesa del nombre:** "asegurado" aplica a los fondos apartados en la bóveda, no a cualquier monto que un cliente deshonesto pudiera firmar offline (ver sección 3). En el README y en el video, decir siempre "asegurado hasta el monto apartado".

Pagos sin internet sobre Stellar testnet. Un cliente firma un vale offline, el comercio lo recibe por QR y lo liquida cuando recupera conexión; un contrato Soroban paga desde una bóveda de fondos apartados.

## 1. Problema y propuesta

- **Problema:** en ferias, buses y zonas rurales la señal falla justo cuando hay que cobrar, y los pagos digitales dejan de funcionar.
- **Propuesta:** el cliente aparta fondos en una bóveda del contrato *antes* de quedarse sin señal. Sin internet, firma vales que el comercio verifica localmente y liquida después. El contrato garantiza que cada vale se pague una sola vez, solo al comercio indicado y solo desde fondos ya apartados.
- **Qué debe verse en la demo:** dos celulares en modo avión completan un pago (QR → QR); al reconectar, el comercio recibe los fondos y se ve la transacción en el explorador de Stellar.

## 2. Flujo de extremo a extremo

```
FASE ONLINE (preparación)
  Cliente: crea cuenta (testnet) → recibe tUSDC (activo de prueba) → open_vault(monto, vencimiento)

FASE OFFLINE (sin internet)
  Comercio: ingresa monto → muestra QR-A (cobro)
  Cliente:  escanea QR-A → revisa comercio y monto → confirma → firma vale → muestra QR-B
  Comercio: escanea QR-B → verifica la firma localmente → "Pago recibido (pendiente de liquidar)"
            → guarda el vale en una cola local

FASE ONLINE (liquidación)
  Comercio → relayer: envía los vales de la cola
  Relayer → contrato: redeem(vale, firma)  (el relayer paga la comisión)
  Contrato → comercio: transfiere tUSDC desde la bóveda del cliente
  Cliente: al vencer la bóveda, close_vault() devuelve el saldo no gastado
```

**Decisión de diseño:** se usan dos QR (cobro del comercio y vale del cliente) en lugar de uno. Así el vale queda atado a un comercio y a un monto concretos, y nadie que vea el QR del cliente puede cobrarlo. Si el tiempo apremia, el MVP puede aceptar que el cliente ingrese comercio y monto manualmente, pero el vale siempre debe incluir al comercio.

## 3. Modelo de confianza (leer antes de diseñar)

**Lo que el contrato garantiza:**

- Un vale solo se paga una vez (nonce).
- Solo se paga al comercio que figura en el vale.
- Nunca se paga más que el saldo de la bóveda.
- Un vale con firma inválida, vencido o por encima del tope por vale se rechaza.
- El dueño no puede retirar fondos antes del vencimiento de la bóveda, así que los fondos apartados siguen disponibles para liquidar.

**Riesgo residual (documentarlo en el README, no esconderlo):**

- Estando offline, nadie puede impedir que un cliente deshonesto firme más vales que su saldo. El contrato paga por orden de llegada y los que exceden el saldo fallan.
- Mitigaciones del MVP: tope por vale (`max_per_voucher`); la app del cliente lleva un saldo local y se niega a firmar de más; la app del comercio muestra el saldo de la bóveda "según la última sincronización" y advierte si el vale es alto.
- Ideas futuras (no implementar): reputación, límites por comercio, hardware seguro.

**Otros límites conocidos:**

- La clave de firma vive en el navegador (IndexedDB). Es aceptable solo para testnet y demo.
- El relayer no puede mover fondos: solo envía vales ya firmados y gasta comisiones.
- El comercio debe ser una cuenta Stellar normal (dirección G...) con trustline al activo.

## 4. Contrato Soroban (`contracts/pagoasegurao`)

### 4.1 Activo

Usar un activo de prueba propio llamado `tUSDC` (la "t" es de testnet) emitido por una cuenta de testnet del proyecto y envuelto con su Stellar Asset Contract (SAC). Así se pueden crear fondos de demo a voluntad. **No es un token con valor ni un lanzamiento de token:** es un activo de prueba sin valor económico, que simula un stablecoin como USDC. Declarar esto en el README y en el video. El contrato recibe la dirección del token al inicializarse, por lo que en el futuro podría apuntar al USDC real sin cambiar su lógica.

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

En el MVP, `signer` es la clave pública de la misma cuenta del cliente (una sola clave). Una "llave de gasto" separada queda como mejora opcional.

### 4.3 Funciones

| Función | Quién la llama | Qué hace |
|---|---|---|
| `__constructor(token)` (o `initialize` si el constructor no está disponible) | despliegue | Guarda la dirección del token. |
| `open_vault(owner, signer, amount, expires_at, max_per_voucher)` | cliente (`owner.require_auth()`) | Transfiere `amount` del cliente al contrato y crea la bóveda indexada por `signer`. Falla si ya existe una activa. |
| `top_up(owner, signer, amount)` | cliente | Suma saldo a su bóveda. |
| `redeem(voucher, signature)` | cualquiera (relayer o comercio) | Valida y paga al comercio. No exige autorización del comercio: el pago siempre va al `merchant` del vale. Esto permite que un relayer pague la comisión. |
| `close_vault(owner, signer)` | cliente | Solo después de `expires_at`. Devuelve el saldo y borra la bóveda. |
| `get_vault(signer)` | lectura | Devuelve la bóveda si existe. |
| `is_redeemed(signer, nonce)` | lectura | Indica si el vale ya se canjeó. |

### 4.4 Mensaje canónico a firmar

Debe ser **idéntico byte a byte** entre Rust y TypeScript:

```
msg = "PAGOASEGURAO1" (ASCII, 13 bytes)
   || contract_address_xdr
   || signer (32 bytes)
   || merchant_address_xdr
   || amount (i128, big-endian, 16 bytes)
   || nonce  (u64, big-endian, 8 bytes)
   || expiry (u64, big-endian, 8 bytes)
```

- `*_address_xdr` es el XDR del `ScVal` de la dirección (en Rust, `to_xdr`; en TypeScript, `new Address(...).toScVal().toXDR()`).
- La firma es ed25519 sobre `msg` sin hash previo. En TypeScript sirve `Keypair.sign(msg)`; en el contrato, `env.crypto().ed25519_verify(...)`.
- Incluir la dirección del contrato evita que un vale se reutilice en otro despliegue.
- Si el AI encuentra una forma más simple y robusta de serializar, puede cambiarla, **siempre que** exista un vector de prueba compartido (ver 4.7) que pase en ambos lenguajes.

### 4.5 Orden de validación en `redeem`

1. El nonce no fue usado.
2. `ledger.timestamp() <= voucher.expiry` y `voucher.expiry <= vault.expires_at`.
3. `0 < amount <= vault.max_per_voucher`.
4. La firma es válida para el mensaje canónico.
5. `vault.balance >= amount`.
6. **Efectos primero:** marcar nonce usado y descontar saldo.
7. Transferir del contrato al comercio.
8. Emitir evento `redeemed` con signer, merchant, amount y nonce.

### 4.6 Almacenamiento y errores

- `instance`: dirección del token.
- `persistent`: `Vault(signer)` y `Used(signer, nonce)`. Extender el TTL al escribir, de modo que cubra al menos hasta `expires_at` más un margen.
- Errores con `#[contracterror]` y códigos estables (`AlreadyRedeemed`, `VoucherExpired`, `InvalidAmount`, `InsufficientFunds`, `VaultNotFound`, `VaultStillActive`, `VaultExists`, etc.). La UI traduce cada código a un mensaje en español.

### 4.7 Pruebas obligatorias (`cargo test`)

1. Flujo feliz: abrir bóveda, canjear, saldos correctos.
2. Doble canje del mismo vale → falla.
3. Firma inválida (mensaje alterado) → falla.
4. Vale firmado por otra clave → falla.
5. Vale vencido → falla.
6. Comercio distinto al del vale → la firma no valida.
7. Monto mayor al tope por vale → falla.
8. Saldo insuficiente → falla y no altera estado.
9. `close_vault` antes de `expires_at` → falla; después → devuelve el saldo.
10. Vale de otro contrato (otra dirección de contrato en el mensaje) → falla.
11. **Vector de prueba compartido:** un archivo `test-vectors/voucher.json` con entradas y firma esperada, usado por un test de Rust y por un script de TypeScript (`scripts/verify-vector.ts`).

## 5. Formato de los QR

Binario compacto, codificado en base64url, con prefijo de versión. Objetivo: menos de ~300 caracteres para que el QR se escanee rápido con poca luz.

- **QR-A (cobro):** `SSC1.` + base64url( merchant_pubkey[32] | amount_i64 | request_id[8] ).
- **QR-B (vale):** `SSV1.` + base64url( signer[32] | merchant_pubkey[32] | amount_i64 | nonce_u64 | expiry_u64 | signature[64] ).

El comercio debe validar en QR-B: firma correcta, `merchant` igual al suyo, `amount` igual al que cobró y vale aún no vencido por su propio reloj.

## 6. Aplicación (PWA, `app/`)

Una sola PWA con dos modos: **Cliente** y **Comercio**. Interfaz en español, pensada para teléfono.

### 6.1 Requisitos transversales

- Debe funcionar sin internet después de la primera carga (service worker con precache). Mostrar siempre un indicador "Sin conexión / En línea".
- Almacenamiento local con `idb`: clave, saldo local, historial, cola de vales.
- Lectura de QR con cámara que funcione en Safari de iOS y Chrome de Android. El AI elige la librería y verifica compatibilidad.
- Requiere HTTPS para la cámara. Desplegar en un host con HTTPS (Vercel, Netlify o GitHub Pages).

### 6.2 Modo Cliente

1. Crear cuenta (se genera la clave localmente, se financia con Friendbot).
2. Pedir fondos de prueba (endpoint `/api/faucet`).
3. Abrir bóveda (monto, duración, tope por vale).
4. Pagar: escanear QR-A → pantalla de confirmación → mostrar QR-B.
5. Historial y saldo local restante.
6. Cerrar bóveda cuando haya vencido.

### 6.3 Modo Comercio

1. Registrar cuenta de comercio con trustline al activo (asistido por el relayer o por el script de onboarding).
2. Cobrar: ingresar monto → mostrar QR-A.
3. Recibir: escanear QR-B → verificación local → "Pago recibido, pendiente de liquidar".
4. Cola de vales con estados: pendiente, liquidado, rechazado (con motivo).
5. Botón "Sincronizar" y sincronización automática al volver la conexión.

## 7. Relayer (`api/`)

Pequeño backend que paga las comisiones (esto es el *fee sponsorship* del proyecto).

- `POST /api/redeem`: recibe un vale y su firma, simula la transacción, la envía con la cuenta del relayer como origen, devuelve el hash o un código de error mapeado.
- `POST /api/faucet`: entrega tUSDC (activo de prueba, sin valor) a una cuenta (solo testnet, con límite de uso).
- `GET /api/vault/:signer`: devuelve el estado de la bóveda para que el comercio lo consulte cuando está en línea.
- La clave del relayer vive solo en variables de entorno (`RELAYER_SECRET`). Nunca en el repo.
- Debe ser idempotente: reenviar el mismo vale no puede dar un error confuso al usuario.

## 8. Estructura del repositorio

```
pagoasegurao/
├─ CLAUDE.md
├─ SPEC.md
├─ README.md
├─ LICENSE                 (MIT)
├─ .gitignore
├─ .env.example
├─ Cargo.toml              (workspace de Rust)
├─ contracts/
│  └─ pagoasegurao/
│     ├─ Cargo.toml
│     ├─ src/lib.rs
│     ├─ src/test.rs
│     └─ test-vectors/voucher.json
├─ app/                    (Vite + React + TS + PWA)
│  ├─ src/lib/             (stellar.ts, voucher.ts, qr.ts, storage.ts)
│  └─ src/screens/         (cliente y comercio)
├─ api/                    (relayer serverless)
├─ scripts/
│  ├─ setup-testnet.ts
│  └─ verify-vector.ts
├─ deployments/
│  └─ testnet.json         (IDs públicos; sin secretos)
└─ docs/
   ├─ progress.md
   ├─ ai-usage.md
   ├─ architecture.md
   └─ demo-script.md
```

## 9. Fases

Fechas pensadas desde el 22 de noviembre de 2026. Cada fase termina con commit y actualización de `docs/progress.md`.

### Fase 0 — Preparación (22–23 nov)
- Repo público con `CLAUDE.md`, `SPEC.md`, `LICENSE` (MIT), `.gitignore` (Node y Rust) y `README.md` mínimo.
- Herramientas instaladas y verificadas (`rustc`, `stellar`, `node`, `pnpm`).
- **Aceptación:** el repo es público y tiene al menos el commit inicial. Repo registrado en el Hub antes del miércoles 25 de noviembre, 11:59 p. m.

### Fase 1 — Contrato y pruebas (23–25 nov)
- Esqueleto con el CLI, estructuras, funciones y pruebas de la sección 4.
- **Aceptación:** `cargo test` pasa con todas las pruebas de 4.7 (excepto el script de TypeScript); `cargo clippy` sin warnings.

### Fase 2 — Testnet y vector compartido (25–26 nov)
- `scripts/setup-testnet.ts` idempotente: crea emisor y activo de prueba, despliega el SAC y el contrato, fondea dos cuentas demo (cliente y comercio con trustline) y escribe `deployments/testnet.json`.
- `scripts/verify-vector.ts` valida en TypeScript el mismo vector de prueba que Rust.
- **Aceptación:** desde cero, el script deja todo listo; un `open_vault` y un `redeem` ejecutados por CLI o script se ven en stellar.expert (enlaces en `docs/progress.md`).

### Fase 3 — App del cliente (26–29 nov)
- PWA, almacenamiento local, creación de cuenta, faucet, abrir bóveda, pagar (QR-A → QR-B).
- **Aceptación:** con el teléfono en modo avión (tras una primera carga con conexión) se genera un vale válido que el contrato acepta al canjearlo después.

### Fase 4 — App del comercio y relayer (29 nov–1 dic)
- Cobrar, recibir, verificar localmente, cola, sincronización y endpoints del relayer.
- **Aceptación:** el flujo completo funciona de punta a punta en testnet con dos dispositivos.

### Fase 5 — Casos de error y prueba real (1–2 dic)
- Mensajes claros para vale vencido, doble canje, fondos insuficientes y comercio equivocado.
- Despliegue público con HTTPS, instalación como PWA y prueba en dos celulares reales en modo avión.
- **Aceptación:** la demo del guion (sección 11) sale limpia al menos tres veces seguidas.

### Fase 6 — Entrega (2–3 dic)
- README completo, diagrama de arquitectura, `docs/ai-usage.md`, video de máximo 3 minutos, enlace a la app desplegada.
- **Aceptación:** checklist de la sección 10 completo. Entrega en APEX el jueves 3; el viernes 4 es solo colchón.

## 10. Checklist del README (exigido por las bases)

- [ ] Resumen en inglés (3–4 líneas) y luego todo en español.
- [ ] Problema que resuelve.
- [ ] Solución y flujo (con diagrama).
- [ ] Arquitectura: contrato, app, relayer.
- [ ] Cómo ejecutarlo (paso a paso, desde cero).
- [ ] **ID del contrato y direcciones en testnet**, con enlaces a stellar.expert.
- [ ] Integrantes.
- [ ] **Uso de IA y de código previo o de terceros** (qué partes, cómo se revisó).
- [ ] Limitaciones conocidas (sección 3).
- [ ] Enlaces: app desplegada, video demo.
- [ ] Licencia MIT.

## 11. Guion del video demo (máximo 3 minutos)

1. **0:00–0:25 Problema:** una escena real (feria, bus, zona sin señal) y por qué fallan los pagos digitales.
2. **0:25–0:55 Idea y arquitectura:** diagrama simple de bóveda → vale offline → liquidación.
3. **0:55–2:20 Demo en vivo:** cliente abre bóveda; ambos teléfonos a modo avión; comercio cobra; cliente paga; comercio ve "pago recibido"; se apaga el modo avión; se liquida; se muestra la transacción en stellar.expert.
4. **2:20–2:50 Por qué Stellar:** Soroban, verificación de firmas, pagos en stablecoin (tUSDC en testnet, pensado para USDC), comisiones patrocinadas, finalidad en segundos.
5. **2:50–3:00 Límites y siguientes pasos.**

## 12. Fuera de alcance (no implementar salvo que todo lo anterior funcione)

- Mainnet, KYC, soles reales, conversión a efectivo.
- Mejoras opcionales: llave de gasto separada protegida con passkey, reservas patrocinadas para la trustline del comercio, vales de varios comercios, panel de historial.

## 13. Preguntas que la IA debe resolver verificando documentación actual

- Versión actual de `soroban-sdk` y del `stellar` CLI, y el target de compilación a WASM que corresponde.
- Si `__constructor` está disponible en la versión elegida.
- Requisitos para que un SAC transfiera a una cuenta (trustline) y cómo manejar el error.
- Flujo actual de simulación y preparación de transacciones con `@stellar/stellar-sdk`.
- Mejor librería de escaneo de QR que funcione en iOS y Android.
