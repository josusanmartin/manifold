import {
  ChartBarIcon,
  LoginIcon,
  LogoutIcon,
  MoonIcon,
  QuestionMarkCircleIcon,
  SunIcon,
} from '@heroicons/react/outline'
import clsx from 'clsx'

import { buildArray } from 'common/util/array'
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { usePathname, useRouter } from 'next/navigation'
import { NotificationsIcon } from 'web/components/notifications-icon'
import { usePrivyLogin } from 'web/components/crypto/privy-wallet-providers'
import { useAdminOrMod } from 'web/hooks/use-admin'
import { useTheme } from 'web/hooks/use-theme'
import { useUser } from 'web/hooks/use-user'
import { firebaseLogout } from 'web/lib/firebase/users'
import { withTracking } from 'web/lib/service/analytics'
import { SidebarSignUpButton } from '../buttons/sign-up-button'
import { Col } from '../layout/col'
import { Row } from '../layout/row'
import { AddFundsButton } from '../profile/add-funds-button'
import { ReportsIcon } from '../reports-icon'
import { ManifoldLogo } from './manifold-logo'
import { ProfileSummary } from './profile-summary'
import { NavItem, SidebarItem } from './sidebar-item'

export const SPEND_MANA_ENABLED = false

export default function Sidebar(props: {
  className?: string
  isMobile?: boolean
}) {
  const { className, isMobile } = props
  const router = useRouter()
  const currentPage = usePathname() ?? undefined
  const user = useUser()
  const isAdminOrMod = useAdminOrMod()
  const privy = usePrivyLogin()

  const { theme, setTheme } = useTheme()

  const toggleTheme = () => {
    setTheme(theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto')
  }

  const navOptions = isMobile
    ? getMobileNav(!!user, isAdminOrMod)
    : getDesktopNav(!!user, isAdminOrMod)

  const bottomNavOptions = bottomNav(
    !!user,
    theme,
    toggleTheme,
    router,
    privy.login,
    privy.logout
  )

  const addFundsButton = user && (
    <AddFundsButton
      userId={user.id}
      className="w-full whitespace-nowrap"
      size="xl"
    />
  )

  return (
    <nav
      aria-label="Sidebar"
      className={clsx(
        'border-ink-200 bg-canvas-0 flex h-screen flex-col border-r pr-2',
        className
      )}
    >
      <ManifoldLogo className="pb-3 pt-6" />

      {!isMobile && (
        <Row className="border-ink-200 mx-1 mb-3 items-center justify-between rounded-md border px-3 py-2 text-xs">
          <span className="text-ink-500 font-medium">Network</span>
          <span className="font-semibold text-teal-700 dark:text-teal-300">
            Arbitrum MEX
          </span>
        </Row>
      )}

      {user && !isMobile && <ProfileSummary user={user} className="mb-3" />}

      <ul role="list" className="m-0 mb-4 flex list-none flex-col gap-1 p-0">
        {navOptions.map((item) => (
          <li key={item.name}>
            <SidebarItem item={item} currentPage={currentPage} />
          </li>
        ))}
        {!user && (
          <li>
            <SidebarSignUpButton />
          </li>
        )}
        {addFundsButton && (
          <li>
            <Col className="gap-2">{addFundsButton}</Col>
          </li>
        )}
      </ul>
      <ul
        role="list"
        className={clsx(
          'm-0 mb-6 mt-auto flex list-none flex-col gap-1 p-0',
          isMobile && 'pb-8'
        )}
      >
        {bottomNavOptions.map((item) => (
          <li key={item.name}>
            <SidebarItem item={item} currentPage={currentPage} />
          </li>
        ))}
      </ul>
    </nav>
  )
}

const getDesktopNav = (loggedIn: boolean, isAdminOrMod: boolean) => {
  if (loggedIn)
    return buildArray(
      { name: 'Markets', href: '/checkout', icon: ChartBarIcon },
      {
        name: 'Inbox',
        href: `/notifications`,
        icon: NotificationsIcon,
      },
      isAdminOrMod && {
        name: 'Reports',
        href: '/reports',
        icon: ReportsIcon,
      }
    )

  return buildArray(
    { name: 'Markets', href: '/checkout', icon: ChartBarIcon },
    { name: 'About', href: '/about', icon: QuestionMarkCircleIcon }
  )
}

const getMobileNav = (loggedIn: boolean, isAdminOrMod: boolean) => {
  return buildArray<NavItem>(
    { name: 'Markets', href: '/checkout', icon: ChartBarIcon },
    loggedIn && {
      name: 'Inbox',
      href: `/notifications`,
      icon: NotificationsIcon,
    },
    isAdminOrMod && {
      name: 'Reports',
      href: '/reports',
      icon: ReportsIcon,
    }
  )
}

const bottomNav = (
  loggedIn: boolean,
  theme: 'light' | 'dark' | 'auto',
  toggleTheme: () => void,
  router: AppRouterInstance,
  privyLogin: () => void,
  privyLogout: () => Promise<void>
) =>
  buildArray<NavItem>(
    loggedIn && { name: 'About', href: '/about', icon: QuestionMarkCircleIcon },
    {
      name: theme ?? 'auto',
      children:
        theme === 'light' ? (
          'Light'
        ) : theme === 'dark' ? (
          'Dark'
        ) : (
          <>
            <span className="hidden dark:inline">Dark</span>
            <span className="inline dark:hidden">Light</span> (auto)
          </>
        ),
      icon: ({ className, ...props }) => (
        <>
          <MoonIcon
            className={clsx(className, 'hidden dark:block')}
            {...props}
          />
          <SunIcon
            className={clsx(className, 'block dark:hidden')}
            {...props}
          />
        </>
      ),
      onClick: toggleTheme,
    },
    loggedIn && {
      name: 'Sign out',
      icon: LogoutIcon,
      onClick: async () => {
        await withTracking(firebaseLogout, 'sign out')()
        await privyLogout()
        await router.refresh()
      },
    },
    !loggedIn && { name: 'Sign in', icon: LoginIcon, onClick: privyLogin }
  )
