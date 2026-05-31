import clsx from 'clsx'
import { shortenNumber } from 'common/util/formatNumber'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  mergeEntitlements,
  useOptimisticEntitlements,
} from 'web/hooks/use-optimistic-entitlements'
import { User } from 'web/lib/firebase/users'
import { trackCallback } from 'web/lib/service/analytics'
import { Avatar } from '../widgets/avatar'

export function ProfileSummary(props: { user: User; className?: string }) {
  const { user, className } = props
  const optimisticContext = useOptimisticEntitlements()

  // Merge server entitlements with optimistic updates from shop
  const effectiveEntitlements = mergeEntitlements(
    user.entitlements,
    optimisticContext?.optimisticEntitlements ?? []
  )

  const currentPage = usePathname() ?? ''
  const url = `/${user.username}`
  return (
    <Link
      href={url}
      onClick={trackCallback('sidebar: profile')}
      className={clsx(
        'text-ink-700 hover:bg-canvas-50 hover:text-ink-900 group flex w-full shrink-0 flex-row items-center truncate rounded-md py-3',
        className,
        currentPage === url &&
          'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
      )}
    >
      <div className="w-2 shrink" />
      <Avatar
        avatarUrl={user.avatarUrl}
        username={user.username}
        noLink
        size="md"
        entitlements={effectiveEntitlements}
        displayContext="profile_sidebar"
      />
      <div className="mr-1 w-2 shrink-[2]" />
      <div className="shrink-0 grow">
        {user.cashBalance < 1 && <div className="text-sm">{user.name}</div>}
        <div className="flex items-center text-sm font-semibold">
          {shortenNumber(user.balance ?? 0)} MEX
        </div>
      </div>
      <div className="w-2 shrink" />
    </Link>
  )
}
