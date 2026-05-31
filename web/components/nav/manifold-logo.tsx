import Link from 'next/link'
import clsx from 'clsx'
import { useUser } from 'web/hooks/use-user'

export function ManifoldLogo(props: { className?: string; twoLine?: boolean }) {
  const { className } = props
  const user = useUser()

  return (
    <div className="flex items-center gap-2">
      <Link
        href={user ? '/checkout' : '/'}
        className={clsx(
          'group flex w-full flex-row items-center gap-2 px-1 outline-none',
          className
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-950 text-sm font-bold text-white transition-colors group-hover:bg-teal-700 dark:bg-white dark:text-slate-950 dark:group-hover:bg-teal-100">
          M
        </span>
        <div
          className={clsx(
            'text-ink-1000 text-[15px] font-semibold tracking-normal'
          )}
        >
          MEXAS
        </div>
      </Link>
    </div>
  )
}
