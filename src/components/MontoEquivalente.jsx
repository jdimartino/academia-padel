import { formatearUSD } from '../lib/dinero'
import { formatearBs, formatearEur, usdCentsABS, usdCentsAEur } from '../lib/tasas'

/*
 * Monto en USD con sus equivalentes en Bs y EUR (si hay tasa). Es SOLO para
 * mostrar: el monto guardado sigue siendo centavos de USD y no cambia.
 */
export default function MontoEquivalente({ cents, tasas, className = '' }) {
  const bs = tasas ? usdCentsABS(cents, tasas.bsPorUsd) : null
  const eur = tasas ? usdCentsAEur(cents, tasas.bsPorUsd, tasas.bsPorEur) : null
  const hayEquivalencias = bs != null && eur != null
  return (
    <span className={`monto-eq${className ? ` ${className}` : ''}`}>
      <span className="monto-eq__usd">{formatearUSD(cents)}</span>
      {hayEquivalencias ? (
        <span className="monto-eq__alt">
          {formatearBs(bs)} · {formatearEur(eur)}
        </span>
      ) : null}
    </span>
  )
}
