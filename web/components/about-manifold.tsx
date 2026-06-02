type AboutManifoldProps = {
  className?: string
}

export const AboutManifold = ({ className = '' }: AboutManifoldProps) => {
  return (
    <div className={`${className}`}>
      <div className="mb-2">
        MEXAS es un mercado de predicción sobre Arbitrum.
      </div>
      <div className="mb-2">
        Consulta probabilidades en tiempo real sobre política, tecnología,
        deportes y más.
      </div>
      <div className="mb-2">
        Abre órdenes límite con MEX desde tu Wallet Privy.
      </div>
    </div>
  )
}
