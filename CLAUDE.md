# CLAUDE.md — PagoAsegurao

Instrucciones permanentes para la IA que trabaja en este repositorio.
**Antes de escribir código, lee `SPEC.md` completo.**

## Contexto

- Proyecto de la Buildathon Stellar Codember Perú 2026.
- Entrega final: viernes 4 de diciembre de 2026, 11:59 p. m. (hora de Lima). Meta interna: tener todo entregable el jueves 3.
- Es un prototipo de pagos sin internet sobre Stellar **testnet**: el cliente firma un vale offline, el comercio lo recibe por QR y lo liquida después en un contrato Soroban que paga desde una bóveda de fondos apartados.
- Pesos de evaluación: uso de Stellar 25 %, funcionalidad en testnet y calidad técnica 25 %, problema e impacto 20 %, innovación 15 %, presentación y UX 15 %.
- **Prioridad absoluta:** un flujo completo que funcione de punta a punta en testnet y se pueda mostrar con dos celulares en modo avión. Es mejor eso, sólido, que muchas funciones a medias.

## Reglas no negociables

1. **Solo testnet.** Nunca mainnet.
2. **Cero secretos en el repo:** claves privadas, frases semilla, `.env`. Usa `.env.example` sin valores reales. Si ves un secreto en un archivo a punto de commitearse, detente y avisa.
3. **No inventes APIs.** El ecosistema (soroban-sdk, stellar-cli, stellar-sdk) cambia rápido y tu conocimiento puede estar desactualizado. Verifica versiones y sintaxis en la documentación oficial (developers.stellar.org, docs.rs/soroban-sdk, repos oficiales de Stellar), con `stellar --help` y con los mensajes del compilador. Para empezar, genera el esqueleto del contrato con el CLI en vez de escribirlo de memoria. Si no tienes acceso a la web, dilo.
4. **Tests antes de desplegar.** No se despliega el contrato si `cargo test` falla.
5. **No declares una tarea terminada sin mostrar la salida real** del comando que la valida (tests, build, deploy, script).
6. **Respeta el alcance.** No agregues funciones que no estén en `SPEC.md`. Si crees que falta algo, proponlo y espera respuesta.
7. **Datos ficticios.** No pidas, guardes ni imprimas datos personales reales (DNI, teléfonos, correos).
8. **Respeta las bases de la buildathon:** nada de especulación, juegos de azar, rendimientos prometidos ni lanzamiento de tokens. Esto es un medio de pago con fondos apartados, sin intereses.
9. **Transparencia sobre la IA:** mantén `docs/ai-usage.md` con una lista de qué partes se generaron con IA y qué se escribió o revisó a mano. Las bases exigen declararlo en el README.

## Stack

- Contrato: Rust + `soroban-sdk` (última versión estable) + `stellar` CLI.
- App: Vite + React + TypeScript + PWA (`vite-plugin-pwa`), `@stellar/stellar-sdk`, `idb`, generación y lectura de QR.
- Relayer: funciones serverless en TypeScript (carpeta `api/`) pensadas para Vercel. Si da problemas, un servidor Node pequeño.
- Gestor de paquetes: `pnpm`.
- Red: Stellar testnet (RPC `https://soroban-testnet.stellar.org`, explorador `https://stellar.expert/explorer/testnet`).

## Comandos (completa esta sección en cuanto existan)

```bash
# Contrato
cargo test
cargo fmt && cargo clippy
stellar contract build

# App
pnpm install
pnpm dev
pnpm build

# Testnet
pnpm tsx scripts/setup-testnet.ts
```

## Convenciones

- Código y comentarios en **inglés**. Interfaz de usuario y README en **español** (el README lleva un resumen en inglés arriba).
- **Commits pequeños y frecuentes**, estilo Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Un commit por avance verificable, no uno gigante al final. El historial de commits es parte de la evaluación.
- TypeScript en modo estricto. Rust con `cargo fmt` y `cargo clippy` sin warnings.
- Montos siempre como enteros en la unidad mínima del activo (7 decimales). Nunca floats.
- Mensajes de error de la UI en español claro, pensados para una persona en un mercado, no para un desarrollador.

## Flujo de trabajo por fase

1. Cuando te pida "Implementa la Fase N", lee esa fase en `SPEC.md`, resume tu plan en 5 líneas y empieza.
2. Cumple los criterios de aceptación de la fase, ejecútalos y muestra los resultados.
3. Actualiza `docs/progress.md`: qué quedó hecho, qué falta, IDs de contratos y cuentas públicas, decisiones tomadas.
4. Haz commit y **detente**. Espera la siguiente instrucción.
5. Si te bloqueas más de unos 20 minutos en algo, usa la alternativa más simple indicada en `SPEC.md` y avisa qué cambió.
