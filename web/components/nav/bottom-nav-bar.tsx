import {
  CloseButton,
  Dialog,
  DialogBackdrop,
  DialogPanel,
  Transition,
  TransitionChild,
} from '@headlessui/react'
import {
  CreditCardIcon,
  QuestionMarkCircleIcon,
  UserCircleIcon,
} from '@heroicons/react/outline'
import {
  CreditCardIcon as CreditCardIconSolid,
  MenuAlt3Icon,
  QuestionMarkCircleIcon as QuestionMarkCircleIconSolid,
  UserCircleIcon as UserCircleIconSolid,
  XIcon,
} from '@heroicons/react/solid'
import clsx from 'clsx'
import { shortenNumber } from 'common/util/formatNumber'
import { User } from 'common/user'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment, useState } from 'react'
import { NotificationsIcon } from 'web/components/notifications-icon'
import { usePrivyLogin } from 'web/components/crypto/privy-wallet-providers'
import { useIsIframe } from 'web/hooks/use-is-iframe'
import {
  mergeEntitlements,
  useOptimisticEntitlements,
} from 'web/hooks/use-optimistic-entitlements'
import { useUser } from 'web/hooks/use-user'
import { trackCallback } from 'web/lib/service/analytics'
import { Col } from '../layout/col'
import { Row } from '../layout/row'
import { Avatar } from '../widgets/avatar'
import Sidebar from './sidebar'
import { NavItem } from './sidebar-item'

export const BOTTOM_NAV_BAR_HEIGHT = 58

const itemClass =
  'sm:hover:bg-ink-200 block w-full py-1 px-3 text-center sm:hover:text-primary-700 transition-colors'
const selectedItemClass = 'text-primary-700'
const touchItemClass = 'touch-press-effect'
const iconClassName = 'mx-auto my-1 h-[1.6rem] w-[1.6rem]'

// Wrapper components for NotificationsIcon to work with the navigation system
const NotificationsIconOutline = (props: { className?: string }) => (
  <NotificationsIcon {...props} solid={false} />
)
const NotificationsIconSolid = (props: { className?: string }) => (
  <NotificationsIcon {...props} solid={true} />
)

function getNavigation(user: User) {
  return [
    {
      name: 'Mercados',
      href: '/checkout',
      icon: CreditCardIcon,
      solidIcon: CreditCardIconSolid,
    },
    {
      name: 'Perfil',
      href: `/${user.username}`,
    },
    {
      name: 'Buzón',
      href: `/notifications`,
      icon: NotificationsIconOutline,
      solidIcon: NotificationsIconSolid,
    },
  ]
}

const signedOutNavigation = (privyLogin: () => void) => [
  {
    name: 'Mercados',
    href: '/checkout',
    icon: CreditCardIcon,
    solidIcon: CreditCardIconSolid,
    alwaysShowName: true,
  },
  {
    name: 'Acerca',
    href: '/about',
    icon: QuestionMarkCircleIcon,
    solidIcon: QuestionMarkCircleIconSolid,
  },
  {
    name: 'Entrar',
    onClick: privyLogin,
    icon: UserCircleIcon,
    solidIcon: UserCircleIconSolid,
  },
]

// From https://codepen.io/chris__sev/pen/QWGvYbL
export function BottomNavBar() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const currentPage = usePathname() ?? ''

  const user = useUser()
  const privy = usePrivyLogin()

  const isIframe = useIsIframe()
  if (isIframe) {
    return null
  }

  const navigationOptions = user
    ? getNavigation(user)
    : signedOutNavigation(privy.login)

  return (
    <nav
      aria-label="Navegación inferior"
      className="border-ink-100/30 dark:border-ink-300 text-ink-700 bg-canvas-0 fixed inset-x-0 bottom-0 z-50 flex min-h-[58px] select-none items-center justify-between border-t pb-[env(safe-area-inset-bottom)] text-xs lg:hidden"
    >
      <ul
        role="list"
        className="m-0 flex w-full list-none items-center justify-between p-0"
      >
        {navigationOptions.map((item) => (
          <li key={item.name} className="flex-1">
            <NavBarItem
              item={item}
              currentPage={currentPage}
              user={user}
              className=""
            />
          </li>
        ))}
        {!!user && (
          <li className="flex-1">
            <button
              type="button"
              aria-label="Más opciones"
              aria-expanded={sidebarOpen}
              className={clsx(
                itemClass,
                'relative',
                sidebarOpen ? selectedItemClass : ''
              )}
              onClick={() => setSidebarOpen(true)}
            >
              <MenuAlt3Icon className={iconClassName} aria-hidden="true" />
              Más
            </button>
          </li>
        )}
      </ul>
      {!!user && (
        <>
          <MobileSidebar
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
          />
        </>
      )}
    </nav>
  )
}

function NavBarItem(props: {
  item: NavItem
  currentPage: string
  children?: any
  user?: User | null
  className?: string
}) {
  const { item, currentPage, children, user, className } = props
  const track = trackCallback(`navbar: ${item.trackingEventName ?? item.name}`)
  const [touched, setTouched] = useState(false)
  const optimisticContext = useOptimisticEntitlements()

  if (item.name === 'Perfil' && user) {
    const isOnUserProfile = currentPage === `/${user.username}`

    // Merge server entitlements with optimistic updates from shop
    const effectiveEntitlements = mergeEntitlements(
      user.entitlements,
      optimisticContext?.optimisticEntitlements ?? []
    )

    return (
      <Link
        prefetch={item?.prefetch ?? true}
        href={item.href ?? '#'}
        aria-current={isOnUserProfile ? 'page' : undefined}
        aria-label={item.name}
        className={clsx(
          itemClass,
          touched && touchItemClass,
          isOnUserProfile && selectedItemClass,
          className
        )}
        onClick={track}
        onTouchStart={() => setTouched(true)}
        onTouchEnd={() => setTouched(false)}
      >
        <Col className="relative mx-auto h-full w-full items-center">
          <div
            className={clsx(
              'rounded-full',
              isOnUserProfile && 'ring-2 ring-teal-600'
            )}
          >
            <Avatar
              size="sm"
              avatarUrl={user.avatarUrl}
              noLink
              entitlements={effectiveEntitlements}
              displayContext="profile_sidebar"
            />
          </div>
          <Row className="text-ink-700 mt-0.5 gap-1 text-[11px] font-semibold">
            {shortenNumber(user.balance ?? 0)} MEX
          </Row>
        </Col>
      </Link>
    )
  }

  if (!item.href) {
    return (
      <button
        type="button"
        className={clsx(
          itemClass,
          touched && touchItemClass,
          className,
          item.itemClassName
        )}
        onClick={() => {
          track()
          item.onClick?.()
        }}
        onTouchStart={() => setTouched(true)}
        onTouchEnd={() => setTouched(false)}
      >
        {item.icon && (
          <item.icon className={clsx(iconClassName, item.iconClassName)} />
        )}
        {children}
        <NavItemLabel name={item.name} subLabel={item.subLabel} />
      </button>
    )
  }

  const currentBasePath = currentPage?.split('/')[1] ?? ''
  const itemPath = item.href.split('/')[1]
  const isCurrentPage = currentBasePath === itemPath

  // Use solid icon if available and page is active
  const IconComponent =
    isCurrentPage && item.solidIcon ? item.solidIcon : item.icon

  return (
    <Link
      href={item.href}
      aria-current={isCurrentPage ? 'page' : undefined}
      className={clsx(
        itemClass,
        touched && touchItemClass,
        isCurrentPage && selectedItemClass,
        className,
        item.itemClassName
      )}
      onClick={track}
      onTouchStart={() => setTouched(true)}
      onTouchEnd={() => setTouched(false)}
    >
      {IconComponent && (
        <IconComponent className={clsx(iconClassName, item.iconClassName)} />
      )}
      {children}
      <NavItemLabel name={item.name} subLabel={item.subLabel} />
    </Link>
  )
}

function NavItemLabel(props: { name: string; subLabel?: string }) {
  const { name, subLabel } = props
  return (
    <span className="whitespace-nowrap">
      {name}
      {subLabel && (
        <span className="hidden min-[360px]:inline">&nbsp;{subLabel}</span>
      )}
    </span>
  )
}

// Sidebar that slides out on mobile
export function MobileSidebar(props: {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}) {
  const { sidebarOpen, setSidebarOpen } = props
  return (
    <div>
      <Transition show={sidebarOpen} as={Fragment}>
        <Dialog
          as="div"
          className="fixed inset-0 z-50 flex justify-end"
          onClose={setSidebarOpen}
        >
          <TransitionChild
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            {/* background cover */}
            <DialogBackdrop className="bg-canvas-100/75 fixed inset-0" />
          </TransitionChild>
          <TransitionChild
            as={Fragment}
            enter="transition ease-in-out duration-300 transform"
            enterFrom="translate-x-full"
            enterTo="translate-x-0"
            leave="transition ease-in-out duration-300 transform"
            leaveFrom="translate-x-0"
            leaveTo="translate-x-full"
          >
            <DialogPanel className="bg-canvas-0 relative w-full max-w-xs">
              <Sidebar className="mx-2 overflow-y-auto" isMobile />
              <CloseButton className="hover:text-primary-600 focus:text-primary-600 text-ink-500 absolute left-0 top-0 z-50 -translate-x-full outline-none">
                <XIcon className="m-2 h-8 w-8" />
              </CloseButton>
            </DialogPanel>
          </TransitionChild>
        </Dialog>
      </Transition>
    </div>
  )
}
