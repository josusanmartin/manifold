type AboutManifoldProps = {
  className?: string
}

export const AboutManifold = ({ className = '' }: AboutManifoldProps) => {
  return (
    <div className={`${className}`}>
      <div className="mb-2">MEXAS is an Arbitrum prediction market.</div>
      <div className="mb-2">
        Get accurate real-time odds on politics, tech, sports, and more.
      </div>
      <div className="mb-2">
        Or create your own MEX market on any question you care about.
      </div>
    </div>
  )
}
