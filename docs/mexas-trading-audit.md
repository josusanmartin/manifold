# Auditoria del flujo MEXAS

## Alcance

Este flujo aplica a mercados binarios MEXAS con libro de ordenes. El sitio usa
Privy para identidad y wallet, Supabase para persistir contratos/ordenes/saldos,
y Arbitrum para leer balances ERC-20 y verificar recibos de transferencia.

## Garantias actuales

- Las ordenes MEXAS requieren autenticacion Privy server-side.
- Las ordenes MEXAS solo aceptan ordenes limite.
- Cada orden abierta descuenta saldo interno y guarda `mexasFundsReserved`.
- El saldo disponible se sincroniza como MEX on-chain menos reservas abiertas;
  no se calcula por delta bruto cuando hay ordenes pendientes.
- Las ordenes expiradas o cerradas se cancelan y devuelven solo la reserva
  pendiente que siga respaldada por MEX on-chain; el resto queda marcado como
  `unbacked-onchain-balance`.
- Las ordenes abiertas sin respaldo on-chain se cancelan sin reembolso interno.
- Al cancelar una orden, la ruta local rechaza cambios mientras haya lock de
  order book o resolucion en curso, y el reembolso usa clave idempotente y
  credito respaldado.
- El scheduler de expiracion tambien lee Arbitrum antes de liberar reservas
  MEXAS, revalida locks de balance frescos y no acredita saldo interno por
  encima de `walletBalance - reservasAbiertas`.
- El modelo distingue reservas respaldadas por wallet de stake marcado como
  escrowed en tesoreria; el stake escrowed no cuenta contra backing de wallet.
- La validacion pura de captura escrow comprueba recibos ERC-20 confirmados,
  payer, tesoreria y monto minimo requerido.
- El backend tiene helper de captura escrow que lee el receipt en Arbitrum y
  revalida payer, treasury, monto y tx hash no usado; el SQL de launch crea un
  indice unico para impedir reutilizar el mismo tx hash en dos ordenes.
- Las cancelaciones, expiraciones y resoluciones ya pueden enviar pagos
  salientes desde tesoreria mediante un ledger idempotente con estado
  `processing`, firma backend y verificacion de receipt confirmado.
- El RPC interno de matching separa estrictamente los modos de ejecucion:
  ordenes wallet-reserved solo cruzan contra wallet-reserved, y ordenes
  treasury-escrowed solo cruzan contra treasury-escrowed. No mezcla los dos
  modelos de settlement.
- El matching usa price-time priority: mejor precio primero, luego orden mas vieja,
  luego `bet_id` como desempate determinista.
- La colocacion de ordenes toma un lock por mercado y usa CAS por fila de orden,
  evitando que dos traders llenen la misma orden si ambos pasan por esta API.
- La resolucion toma un lock por mercado y rechaza resoluciones concurrentes.
- Los creditos de cancelacion/resolucion usan claves idempotentes.

## Barrera de settlement

El flujo activo de produccion todavia no debe habilitar escrow on-chain. La
captura wallet -> tesoreria, el matching separado de stake escrowed y el pago
tesoreria -> usuario existen como codigo, pero
`MEXAS_ONCHAIN_ESCROW_CAPABILITIES` sigue en `false` hasta que produccion tenga
SQL/env/signer/scheduler verificados end-to-end.

Cuando dos ordenes sin escrow hacen match, el codigo cambia saldos internos,
pero no transfiere MEX desde la wallet del perdedor a una cuenta custodiada ni
al ganador. Por eso un usuario podria mover sus MEX fuera de su wallet despues
de una operacion llena.

Para no crear saldos internos no respaldados, el API bloquea:

- nuevos cruces de ordenes siempre, hasta que exista un motor atomico de
  settlement; los flags de entorno no deben poder activar el matcher local
  porque actualiza filas maker/taker fuera de una unica transaccion;
- el boton solo debe bloquear una orden si el precio cruza liquidez existente;
  una orden limite que descansa en el libro puede reservar MEX y quedarse
  abierta;
- resoluciones con posiciones llenadas si no existe `MEXAS_SETTLEMENT_MODE=escrow`,
  `MEXAS_ESCROW_IMPLEMENTATION=onchain-transfer` y capacidades reales de escrow
  implementadas. Los flags de override no deben permitir launch sin escrow.

Abrir ordenes limite que no cruzan sigue permitido, porque esas ordenes pueden
cancelarse si el balance on-chain deja de respaldarlas.

## Estado de readiness

La auditoria automatica actual pasa estos checks de seguridad:

- reservas abiertas activas;
- ausencia de locks persistentes en mercados MEXAS;
- respaldo on-chain de ordenes abiertas;
- respaldo on-chain de saldos internos positivos;
- ausencia de libros cruzados persistentes;
- ausencia de exposicion de settlement llenada;
- despliegue de produccion fresco contra el HEAD auditado.

Los blockers de launch real siguen siendo estructurales:

- aplicar el SQL de launch en Supabase produccion para `contracts.token = 'MEX'`,
  indices de libro, RPC `mexas_orderbook_matching_engine_ready`, ledger
  `mexas_treasury_transfers` y guard de captura escrow
  `mexas_escrow_capture_ready`;
- configurar y proteger `MEXAS_TREASURY_SIGNER_SECRET` en produccion antes de
  cualquier pago on-chain saliente;
- mantener `MEXAS_ENABLE_ESCROW_CAPTURE_ORDERS` apagado hasta que el SQL de
  produccion, signer y scheduler runtime esten verificados;
- subir `MEXAS_ONCHAIN_ESCROW_CAPABILITIES` solo cuando captura, release y
  payout esten cubiertos end-to-end en el matcher y las rutas runtime;
- desplegar/confirmar el scheduler runtime despues de aplicar el SQL.

## Superficie publica MEXAS

El proxy publico de `mexas-manifold.vercel.app/api/v0/*` bloquea endpoints
heredados que no forman parte del producto MEXAS: comentarios, posts, boosts,
manalinks, Mana stats, cashout/checkout GIDX, iDenfy, loans, liquidez/bounties,
MCP, Predictle, sweepstakes, charity giveaways, shop/merch/tickets y compra
MEXAS por Daimo/tesoreria.

La superficie que queda disponible para el frontend MEXAS es local al sitio:
wallet Privy, consulta de libro de ordenes, colocacion/cancelacion de ordenes,
consulta de ordenes MEXAS, revalidacion local, readiness de resolucion y
resolucion de mercados MEXAS por el creador. No hay allowlist de proxy externo
Manifold para launch.

## Requisito para produccion real

Para habilitar matching/resolucion sin los flags de riesgo, MEXAS necesita una
de estas dos piezas:

- escrow contract: al abrir una orden, la wallet transfiere el stake a escrow; al
  resolver, el escrow paga a ganadores y devuelve cancelaciones;
- custodia treasury: al abrir una orden, la wallet transfiere MEX a una treasury;
  al resolver/retirar, un servicio backend firma pagos desde esa treasury.

Sin una de esas dos piezas y un motor transaccional, el orderbook puede listar
ordenes, pero no debe prometer settlement real ni ejecutar cruces.
