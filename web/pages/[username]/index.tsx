import {
  CashIcon,
  ChevronDownIcon,
  PresentationChartLineIcon,
  ScaleIcon,
  ViewListIcon,
} from '@heroicons/react/outline'
import clsx from 'clsx'
import { getUserForStaticProps } from 'common/supabase/users'
import { buildArray } from 'common/util/array'
import { removeUndefinedProps } from 'common/util/object'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { UserBetsTable } from 'web/components/bet/user-bets-table'
import { UserSettingButton } from 'web/components/buttons/user-settings-button'
import { BackButton } from 'web/components/contract/back-button'
import { JsonLd } from 'web/components/JsonLd'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { Row } from 'web/components/layout/row'
import { Spacer } from 'web/components/layout/spacer'
import { QueryUncontrolledTabs } from 'web/components/layout/tabs'
import { BalanceChangeTable } from 'web/components/portfolio/balance-change-table'
import { BlockedUser } from 'web/components/profile/blocked-user'
import { UserContractsList } from 'web/components/profile/user-contracts-list'
import { SEO } from 'web/components/SEO'
import { Avatar } from 'web/components/widgets/avatar'
import { FullscreenConfetti } from 'web/components/widgets/fullscreen-confetti'
import ImageWithBlurredShadow from 'web/components/widgets/image-with-blurred-shadow'
import { Linkify } from 'web/components/widgets/linkify'
import { Title } from 'web/components/widgets/title'
import { StackedUserNames, UserLink } from 'web/components/widgets/user-link'
import { useAdminOrMod } from 'web/hooks/use-admin'
import { useHeaderIsStuck } from 'web/hooks/use-header-is-stuck'
import { useIsMobile } from 'web/hooks/use-is-mobile'
import { useSaveReferral } from 'web/hooks/use-save-referral'
import { usePrivateUser, useUser } from 'web/hooks/use-user'
import { useUserBans } from 'web/hooks/use-user-bans'
import { User } from 'web/lib/firebase/users'
import { buildPersonProfile } from 'web/lib/json-ld'
import { db } from 'web/lib/supabase/db'
import Custom404 from 'web/pages/404'
import { UserPayments } from 'web/pages/payments'

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
    <BlockedUser user={user} privateUser={privateUser} />
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

function MexasPublicProfileSummary(props: {
  user: User
  hasCreatedQuestion: boolean
  isCurrentUser: boolean
}) {
  const { user, hasCreatedQuestion, isCurrentUser } = props

  return (
    <Col className="border-ink-200 mt-4 gap-4 border-y py-4">
      <Row className="flex-wrap gap-3">
        <Col className="min-w-[180px] flex-1 gap-1">
          <span className="text-ink-500 text-xs font-semibold uppercase">
            Wallet
          </span>
          <span className="text-ink-1000 text-lg font-semibold">
            @{user.username}
          </span>
        </Col>
        <Col className="min-w-[180px] flex-1 gap-1">
          <span className="text-ink-500 text-xs font-semibold uppercase">
            Mercados MEX
          </span>
          <span className="text-ink-1000 text-lg font-semibold">
            {hasCreatedQuestion ? 'Activos' : 'Sin mercados creados'}
          </span>
        </Col>
        <Col className="min-w-[180px] flex-1 gap-1">
          <span className="text-ink-500 text-xs font-semibold uppercase">
            Acceso
          </span>
          <span className="text-ink-1000 text-lg font-semibold">
            {isCurrentUser ? 'Tu perfil' : 'Perfil público'}
          </span>
        </Col>
      </Row>
      <p className="text-ink-600 max-w-3xl text-sm">
        Las operaciones visibles en esta fork se liquidan en MEX. Usa las
        pestañas de operaciones, mercados y movimientos para revisar actividad
        pública de MEXAS.
      </p>
    </Col>
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
  const {
    rating,
    hasCreatedQuestion,
    shouldIgnoreUser,
    reviewCount,
    averageRating,
  } = props
  const user = props.user
  const isMobile = useIsMobile()
  const router = useRouter()
  const currentUser = useUser()
  useSaveReferral(currentUser, {
    defaultReferrerUsername: user.username,
  })
  const isCurrentUser = user.id === currentUser?.id
  const [expandProfileInfo, setExpandProfileInfo] = useState(false)
  useEffect(() => {
    // wait for user to load
    if (currentUser === undefined) return
    if (!user.isBannedFromPosting && !user.userDeleted && !isCurrentUser) {
      setExpandProfileInfo(true)
    }
  }, [user.isBannedFromPosting, user.userDeleted, currentUser, user.id])
  const [showConfetti, setShowConfetti] = useState(false)
  const { bans: userBans } = useUserBans(currentUser ? user.id : undefined)
  const { ref: titleRef, headerStuck } = useHeaderIsStuck()

  useEffect(() => {
    const claimedMex = router.query['claimed-mex'] === 'yes'
    setShowConfetti(claimedMex)
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
      className={clsx(isCurrentUser ? 'lg:!mt-0' : 'lg:mt-4')}
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
      {showConfetti && <FullscreenConfetti />}

      <Col className="relative">
        <Row
          className={
            'bg-canvas-0 sticky top-0 z-10 h-12 w-full justify-between gap-1 sm:static sm:h-auto'
          }
        >
          {isMobile && (
            <>
              <BackButton className="px-6" />

              <div
                className={clsx(
                  'self-center opacity-0 transition-opacity first:ml-4',
                  headerStuck && 'opacity-100'
                )}
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              >
                <UserLink user={user} noLink />
              </div>

              <UserSettingButton user={user} />
            </>
          )}
        </Row>

        <Row
          className={clsx('mx-4 flex-wrap justify-between gap-2 py-1')}
          ref={titleRef}
        >
          {isCurrentUser || shouldIgnoreUser ? (
            <button
              className="group flex gap-2 py-1 pr-2"
              onClick={() => setExpandProfileInfo((v) => !v)}
            >
              <Col className={'relative max-h-14'}>
                <ImageWithBlurredShadow
                  image={
                    <Avatar
                      username={user.username}
                      avatarUrl={user.avatarUrl}
                      size={'lg'}
                      className="bg-ink-1000"
                      noLink
                      entitlements={user.entitlements}
                      displayContext="profile_page"
                      animateHat={expandProfileInfo}
                    />
                  }
                  size={48}
                />

                <ChevronDownIcon
                  className={clsx(
                    'group-hover:bg-primary-700 bg-primary-600 shadow-primary-300 text-ink-0 absolute bottom-0 right-0 z-20 h-5 w-5 rounded-full p-0.5 shadow-sm transition-all',
                    expandProfileInfo ? 'rotate-180' : 'rotate-0'
                  )}
                />
              </Col>
              <StackedUserNames
                usernameClassName={'sm:text-base'}
                className={'font-bold sm:mr-0 sm:text-xl'}
                user={user}
                displayContext="profile_page"
                bans={userBans}
              />
            </button>
          ) : (
            <Row className="group gap-2 py-1">
              <ImageWithBlurredShadow
                image={
                  <Avatar
                    username={user.username}
                    avatarUrl={user.avatarUrl}
                    size={'lg'}
                    className="bg-ink-1000"
                    noLink
                    entitlements={user.entitlements}
                    displayContext="profile_page"
                  />
                }
                size={48}
              />
              <StackedUserNames
                usernameClassName={'sm:text-base'}
                className={'font-bold sm:mr-0 sm:text-xl'}
                user={user}
                displayContext="profile_page"
                bans={userBans}
              />
            </Row>
          )}

          <Row className={'items-center gap-1 sm:gap-2'}>
            {!isMobile && <UserSettingButton user={user} />}
          </Row>
        </Row>
        {expandProfileInfo && (
          <Col className={'mx-4 mt-1 gap-2'}>
            {user.bio && (
              <div className="sm:text-md mt-1 text-sm">
                <Linkify text={user.bio}></Linkify>
              </div>
            )}
          </Col>
        )}

        <Col className="mx-4">
          <QueryUncontrolledTabs
            trackingName={'profile tabs'}
            labelsParentClassName={'gap-0 sm:gap-4'}
            labelClassName={'pb-2 pt-2'}
            saveTabInLocalStorageKey={
              isCurrentUser ? `profile-tabs-v2-${user.id}` : undefined
            }
            tabs={buildArray(
              {
                title: 'Resumen',
                queryString: 'summary',
                prerender: true,
                stackedTabIcon: <PresentationChartLineIcon className="h-5" />,
                content: (
                  <MexasPublicProfileSummary
                    user={user}
                    hasCreatedQuestion={hasCreatedQuestion}
                    isCurrentUser={isCurrentUser}
                  />
                ),
              },
              !!user.lastBetTime && {
                title: 'Operaciones',
                prerender: true,
                stackedTabIcon: <ViewListIcon className="h-5 w-5" />,
                content: (
                  <>
                    <Spacer h={2} />
                    <div className="text-ink-800 border-ink-300 mx-2 mt-2 gap-2 border-b pb-3 text-xl font-semibold lg:mx-0">
                      Operaciones
                    </div>
                    <Spacer h={4} />
                    <UserBetsTable user={user} />
                  </>
                ),
              },
              hasCreatedQuestion && {
                title: 'Mercados',
                prerender: true,
                stackedTabIcon: <ScaleIcon className="h-5" />,
                content: (
                  <>
                    <Spacer h={4} />
                    <UserContractsList
                      creator={user}
                      rating={rating}
                      reviewCount={reviewCount}
                      averageRating={averageRating}
                    />
                  </>
                ),
              },
              {
                title: 'Movimientos',
                stackedTabIcon: <ViewListIcon className="h-5" />,
                content: <BalanceChangeTable user={user} />,
                queryString: balanceChangesKey,
              },
              {
                title: 'Wallet',
                queryString: 'payments',
                stackedTabIcon: <CashIcon className="h-5" />,
                content: (
                  <>
                    <Spacer h={4} />
                    <UserPayments userId={user.id} />
                  </>
                ),
              }
            )}
          />
        </Col>
      </Col>
    </Page>
  )
}
