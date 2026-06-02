# Auditoria del flujo MEXAS

## Alcance

Este flujo aplica a mercados binarios MEXAS con libro de ordenes. El sitio usa
Privy para identidad y wallet, Supabase para persistir contratos/ordenes/saldos,
y Arbitrum solo para leer el balance ERC-20 del usuario.

## Garantias actuales

- Las ordenes MEXAS requieren autenticacion Privy server-side.
- Las ordenes MEXAS solo aceptan ordenes limite.
- Cada orden abierta descuenta saldo interno y guarda `mexasFundsReserved`.
- El saldo disponible se sincroniza como MEX on-chain menos reservas abiertas;
  no se calcula por delta bruto cuando hay ordenes pendientes.
- Las ordenes expiradas se cancelan y devuelven solo la reserva pendiente.
- Las ordenes abiertas sin respaldo on-chain se cancelan sin reembolso interno.
- Al cancelar una orden, la ruta local rechaza cambios mientras haya lock de
  order book o resolucion en curso, y el reembolso usa clave idempotente.
- El matching usa price-time priority: mejor precio primero, luego orden mas vieja,
  luego `bet_id` como desempate determinista.
- La colocacion de ordenes toma un lock por mercado y usa CAS por fila de orden,
  evitando que dos traders llenen la misma orden si ambos pasan por esta API.
- La resolucion toma un lock por mercado y rechaza resoluciones concurrentes.
- Los creditos de cancelacion/resolucion usan claves idempotentes.

## Barrera de settlement

El flujo actual no tiene escrow on-chain. Cuando dos ordenes hacen match, el
codigo cambia saldos internos, pero no transfiere MEX desde la wallet del
perdedor a una cuenta custodiada ni al ganador. Por eso un usuario podria mover
sus MEX fuera de su wallet despues de una operacion llena.

Para no crear saldos internos no respaldados, el API bloquea:

- nuevos cruces de ordenes siempre, hasta que exista un motor atomico de
  settlement; los flags de entorno no deben poder activar el matcher local
  porque actualiza filas maker/taker fuera de una unica transaccion;
- resoluciones con posiciones llenadas si no existe `MEXAS_SETTLEMENT_MODE=escrow`,
  salvo que se active explicitamente `MEXAS_ALLOW_UNESCROWED_RESOLUTION=true`.

Abrir ordenes limite que no cruzan sigue permitido, porque esas ordenes pueden
cancelarse si el balance on-chain deja de respaldarlas.

## Superficie publica MEXAS

El proxy publico de `mexas-manifold.vercel.app/api/v0/*` bloquea endpoints
heredados que no forman parte del producto MEXAS: comentarios, posts, boosts,
manalinks, Mana stats, cashout/checkout GIDX, iDenfy, loans, liquidez/bounties,
MCP, Predictle, sweepstakes, charity giveaways, shop/merch/tickets y compra
MEXAS por Daimo/tesoreria.

La superficie que queda disponible para el frontend MEXAS es trading local
MEXAS, consulta de ordenes, busqueda/lectura de mercados, usuarios, txns,
revalidacion y resolucion de mercados MEXAS por el creador.

## Requisito para produccion real

Para habilitar matching/resolucion sin los flags de riesgo, MEXAS necesita una
de estas dos piezas:

- escrow contract: al abrir una orden, la wallet transfiere el stake a escrow; al
  resolver, el escrow paga a ganadores y devuelve cancelaciones;
- custodia treasury: al abrir una orden, la wallet transfiere MEX a una treasury;
  al resolver/retirar, un servicio backend firma pagos desde esa treasury.

Sin una de esas dos piezas y un motor transaccional, el orderbook puede listar
ordenes, pero no debe prometer settlement real ni ejecutar cruces.
