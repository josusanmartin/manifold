import {
  CashIcon,
  PresentationChartLineIcon,
  ScaleIcon,
  ViewListIcon,
} from '@heroicons/react/outline'
import clsx from 'clsx'
import { getUserForStaticProps } from 'common/supabase/users'
import { removeUndefinedProps } from 'common/util/object'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect } from 'react'
import { JsonLd } from 'web/components/JsonLd'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { Row } from 'web/components/layout/row'
import { Spacer } from 'web/components/layout/spacer'
import { QueryUncontrolledTabs } from 'web/components/layout/tabs'
import {
  MexasProfileMarkets,
  MexasProfileMovements,
  MexasProfileOperations,
  MexasProfileWallet,
  MexasPublicProfileSummary,
} from 'web/components/profile/mexas-profile-tabs'
import { SEO } from 'web/components/SEO'
import { Title } from 'web/components/widgets/title'
import { useAdminOrMod } from 'web/hooks/use-admin'
import { useSaveReferral } from 'web/hooks/use-save-referral'
import { usePrivateUser, useUser } from 'web/hooks/use-user'
import { User } from 'web/lib/firebase/users'
import { buildPersonProfile } from 'web/lib/json-ld'
import { db } from 'web/lib/supabase/db'
import Custom404 from 'web/pages/404'

export const getStaticProps = async (props: {
  params: {
    username: string
  }
}) => {
  const { username } = props.params

  const user = await getUserForStaticProps(db, username)

  const contracts = user
    ? await db
        .from('contracts')
        .select('id')
        .eq('creator_id', user.id)
        .eq('data->>token', 'MEX')
        .eq('mechanism', 'cpmm-1')
        .eq('outcome_type', 'BINARY')
        .limit(1)
    : undefined
  const hasCreatedQuestion = !!contracts?.data?.length

  return {
    props: removeUndefinedProps({
      user,
      username,
      shouldIgnoreUser: false,
      hasCreatedQuestion,
    }),
    revalidate: 60,
  }
}

export const getStaticPaths = () => {
  return { paths: [], fallback: 'blocking' }
}

export default function UserPage(props: {
  user: User | null
  username: string
  rating?: number
  reviewCount?: number
  averageRating?: number
  shouldIgnoreUser: boolean
  hasCreatedQuestion: boolean
}) {
  const isAdminOrMod = useAdminOrMod()
  const { user, ...profileProps } = props
  const privateUser = usePrivateUser()
  const blockedByCurrentUser =
    privateUser?.blockedUserIds?.includes(user?.id ?? '_') ?? false
  if (!user) return <Custom404 />
  else if (user.userDeleted && !isAdminOrMod) return <DeletedUser />

  return privateUser && blockedByCurrentUser ? (
    <Page trackPageView={'blocked user profile'}>
      <Col className="mx-auto max-w-2xl gap-4 px-4 py-10">
        <Title>Wallet bloqueada</Title>
        <p className="text-ink-600">
          Has bloqueado esta Wallet. Puedes cambiarlo desde tu configuracion.
        </p>
      </Col>
    </Page>
  ) : (
    <UserProfile user={user} {...profileProps} />
  )
}

export const DeletedUser = () => {
  return (
    <Page trackPageView={'deleted user profile'}>
      <Head>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="flex h-full flex-col items-center justify-center">
        <Title>Cuenta eliminada</Title>
        <p>Esta cuenta fue eliminada.</p>
      </div>
    </Page>
  )
}

function UserProfile(props: {
  user: User
  rating?: number
  reviewCount?: number
  averageRating?: number
  shouldIgnoreUser: boolean
  hasCreatedQuestion: boolean
}) {
  const { hasCreatedQuestion, shouldIgnoreUser } = props
  const user = props.user
  const router = useRouter()
  const currentUser = useUser()
  useSaveReferral(currentUser, {
    defaultReferrerUsername: user.username,
  })
  const isCurrentUser = user.id === currentUser?.id

  useEffect(() => {
    const query = { ...router.query }
    if (query['claimed-mex'] || query.show) {
      const queriesToDelete = ['claimed-mex', 'show', 'badge']
      queriesToDelete.forEach((key) => delete query[key])
      router.replace(
        {
          pathname: router.pathname,
          query,
        },
        undefined,
        { shallow: true }
      )
    }
  }, [])

  useEffect(() => {
    if (!router.isReady) return
    const tab = router.query.tab
    if (tab !== 'achievements' && tab !== 'comments') return

    router.replace(
      {
        pathname: router.pathname,
        query: { ...router.query, tab: 'summary' },
      },
      undefined,
      { shallow: true }
    )
  }, [router.isReady, router.query.tab])

  const balanceChangesKey = 'balance-changes'

  return (
    <Page
      key={user.id}
      trackPageView={'user page'}
      trackPageProps={{ username: user.username }}
      className={clsx('lg:mt-4')}
    >
      <SEO
        title={`${user.name} (@${user.username})`}
        description={shouldIgnoreUser ? '' : user.bio ?? ''}
        url={`/${user.username}`}
        shouldIgnore={shouldIgnoreUser}
      />
      <JsonLd
        data={
          shouldIgnoreUser
            ? null
            : buildPersonProfile({
                name: user.name,
                username: user.username,
                avatarUrl: user.avatarUrl,
                bio: user.bio,
                website: user.website,
                twitterHandle: user.twitterHandle,
                createdTime: user.createdTime,
              })
        }
        id="person"
      />

      <Col className="relative">
        <Row className="mx-4 flex-wrap items-start justify-between gap-4 py-2">
          <Row className="min-w-0 gap-3">
            <div className="bg-primary-600 text-ink-0 flex h-12 w-12 shrink-0 items-center justify-center rounded text-lg font-bold">
              {user.name?.[0]?.toUpperCase() ?? user.username[0].toUpperCase()}
            </div>
            <Col className="min-w-0 gap-1">
              <h1 className="text-ink-1000 truncate text-2xl font-bold">
                {user.name}
              </h1>
              <span className="text-ink-500">@{user.username}</span>
              {user.bio && (
                <p className="text-ink-600 max-w-3xl text-sm">{user.bio}</p>
              )}
            </Col>
          </Row>
          {isCurrentUser && (
            <Link
              href="/wallet"
              className="border-ink-300 text-ink-900 hover:bg-canvas-50 rounded border px-3 py-2 text-sm font-semibold"
            >
              Wallet
            </Link>
          )}
        </Row>

        <Col className="mx-4">
          <QueryUncontrolledTabs
            trackingName={'profile tabs'}
            labelsParentClassName={'gap-1 sm:gap-4'}
            labelClassName={
              '!mr-0 min-w-[4.25rem] justify-center pb-2 pt-2 text-xs sm:!mr-4 sm:min-w-0 sm:text-sm'
            }
            saveTabInLocalStorageKey={
              isCurrentUser ? `profile-tabs-v2-${user.id}` : undefined
            }
            tabs={[
              {
                title: 'Resumen',
                queryString: 'summary',
                prerender: true,
                stackedTabIcon: (
                  <PresentationChartLineIcon className="hidden h-5 sm:block" />
                ),
                content: (
                  <MexasPublicProfileSummary
                    user={user}
                    hasCreatedQuestion={hasCreatedQuestion}
                    isCurrentUser={isCurrentUser}
                  />
                ),
              },
              {
                title: 'Operaciones',
                titleElement: (
                  <>
                    <span className="sm:hidden">Ops.</span>
                    <span className="hidden sm:inline">Operaciones</span>
                  </>
                ),
                queryString: 'trades',
                prerender: true,
                stackedTabIcon: (
                  <ViewListIcon className="hidden h-5 w-5 sm:block" />
                ),
                content: (
                  <>
                    <Spacer h={2} />
                    <div className="text-ink-800 border-ink-300 mx-2 mt-2 gap-2 border-b pb-3 text-xl font-semibold lg:mx-0">
                      Operaciones
                    </div>
                    <Spacer h={4} />
                    <MexasProfileOperations
                      user={user}
                      isCurrentUser={isCurrentUser}
                    />
                  </>
                ),
              },
              {
                title: 'Mercados',
                queryString: 'markets',
                prerender: true,
                stackedTabIcon: <ScaleIcon className="hidden h-5 sm:block" />,
                content: (
                  <>
                    <Spacer h={4} />
                    <MexasProfileMarkets user={user} />
                  </>
                ),
              },
              {
                title: 'Movimientos',
                titleElement: (
                  <>
                    <span className="sm:hidden">Movs.</span>
                    <span className="hidden sm:inline">Movimientos</span>
                  </>
                ),
                stackedTabIcon: (
                  <ViewListIcon className="hidden h-5 sm:block" />
                ),
                content: <MexasProfileMovements user={user} />,
                queryString: balanceChangesKey,
              },
              {
                title: 'Wallet',
                queryString: 'payments',
                stackedTabIcon: <CashIcon className="hidden h-5 sm:block" />,
                content: (
                  <>
                    <Spacer h={4} />
                    <MexasProfileWallet
                      user={user}
                      isCurrentUser={isCurrentUser}
                    />
                  </>
                ),
              },
            ]}
          />
        </Col>
      </Col>
    </Page>
  )
}
