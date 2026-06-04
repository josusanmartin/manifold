import { XIcon } from '@heroicons/react/outline'
import clsx from 'clsx'

import { IconButton } from '../buttons/button'
import { Row } from '../layout/row'
import { usePersistentLocalState } from 'web/hooks/use-persistent-local-state'
import Link from 'next/link'

export function Banner(props: {
  setShowBanner?: (show: boolean) => void
  className?: string
  children: React.ReactNode
  link?: string
  target?: '_blank' | '_self'
}) {
  const { setShowBanner, className, children, link, target = '_blank' } = props
  return (
    <Row
      className={clsx(
        className,
        'text-ink-900 bg-primary-100 z-10 justify-between gap-4'
      )}
    >
      {link ? (
        <Link
          target={target}
          href={link}
          className="pl-4"
          rel="noopener noreferrer"
        >
          {children}
        </Link>
      ) : (
        <div className={'pl-4'}>{children}</div>
      )}

      {setShowBanner && (
        <IconButton
          aria-label="Dismiss banner"
          className={'h-8'}
          size={'sm'}
          onClick={() => {
            setShowBanner(false)
          }}
        >
          <XIcon className="text-ink-700 h-5 w-5" />
        </IconButton>
      )}
    </Row>
  )
}

export function PivotBanner(_props: { hideBanner: () => void }) {
  return null
}

export function ManifestBanner(_props: { hideBanner: () => void }) {
  return null
}

export function Manifest2026Banner() {
  return null
}

export function Manifest2025Banner(_props: { hideBanner: () => void }) {
  return null
}

export function DowntimeBanner() {
  return null
}

export function WatchPartyBanner() {
  return null
}

export function StateOfTheUnionBanner() {
  return null
}

export function StateOfTheUnion2026Banner() {
  return null
}

export const useBanner = (name: string) => {
  const [bannerSeen, setBannerSeen] = usePersistentLocalState<number>(
    0,
    `${name}-banner-seen`
  )

  return [!bannerSeen, () => setBannerSeen(1)] as const
}

export const FeeBanner = () => {
  return null
}

export const TwombaBanner = () => {
  return null
}

export const CharityGiveawayBanner = () => {
  return null
}
