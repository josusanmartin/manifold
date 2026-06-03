import clsx from 'clsx'

type CoinProps = {
  className?: string
}

function MexCoinMark(props: CoinProps & { flat?: boolean }) {
  const { className, flat } = props

  return (
    <span
      aria-label="MEX"
      className={clsx(
        'inline-flex items-center justify-center rounded-full bg-emerald-600 align-middle text-[0.46em] font-semibold leading-none text-white shadow-sm ring-1 ring-emerald-900/10',
        flat ? 'bg-emerald-500' : 'bg-emerald-600',
        className
      )}
      style={{
        height: '1em',
        marginRight: flat ? undefined : '0.1em',
        width: '1em',
      }}
    >
      M
    </span>
  )
}

export function ManaCoin(props: CoinProps) {
  return <MexCoinMark {...props} />
}

export function ManaFlatCoin(props: CoinProps) {
  return <MexCoinMark {...props} flat />
}
