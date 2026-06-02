import { StarIcon, XIcon } from '@heroicons/react/solid'
import { useContractBets } from 'client-common/hooks/use-bets'
import { getMultiBetPointsFromBets } from 'client-common/lib/choice'
import clsx from 'clsx'
import { Bet } from 'common/bet'
import {
  HistoryPoint,
  MultiBase64Points,
  MultiPoints,
  unserializeBase64Multi,
} from 'common/chart'
import {
  isBinaryMulti,
  tradingAllowed,
  type Contract,
  type ContractParams,
} from 'common/contract'
import { shouldHideGraph } from 'common/contract-params'
import { base64toPoints } from 'common/edge/og'
import { HOUSE_BOT_USERNAME, SPICE_MARKET_TOOLTIP } from 'common/envs/constants'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import { DAY_MS } from 'common/util/time'
import { mergeWith, uniqBy } from 'lodash'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { UserBetsSummary } from 'web/components/bet/user-bet-summary'
import { ScrollToTopButton } from 'web/components/buttons/scroll-to-top-button'
import {
  SidebarSignUpButton,
  SignUpButton,
} from 'web/components/buttons/sign-up-button'
import { BackButton } from 'web/components/contract/back-button'
import { ChangeBannerButton } from 'web/components/contract/change-banner-button'
import { ContractDescription } from 'web/components/contract/contract-description'
import { AuthorInfo } from 'web/components/contract/contract-details'
import { ContractLeaderboard } from 'web/components/contract/contract-leaderboard'
import { ContractOverview } from 'web/components/contract/contract-overview'
import { ContractSummaryStats } from 'web/components/contract/contract-summary-stats'
import { VisibilityIcon } from 'web/components/contract/contracts-table'
import { DangerZone } from 'web/components/contract/danger-zone'
import { EditableQuestionTitle } from 'web/components/contract/editable-question-title'
import { MarketTopics } from 'web/components/contract/market-topics'
import { ExplainerPanel } from 'web/components/explainer-panel'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { Spacer } from 'web/components/layout/spacer'
import { NumericResolutionPanel } from 'web/components/numeric-resolution-panel'
import { ResolutionPanel } from 'web/components/resolution-panel'
import { Rating, ReviewPanel } from 'web/components/reviews/stars'
import { GradientContainer } from 'web/components/widgets/gradient-container'
import { Tooltip } from 'web/components/widgets/tooltip'
import { useAdmin, useTrusted } from 'web/hooks/use-admin'
import { precacheAnswers } from 'web/hooks/use-answers'
import { useLiveContract } from 'web/hooks/use-contract'
import { useGraphUserFromUrl } from 'web/hooks/use-graph-user'
import { useHeaderIsStuck } from 'web/hooks/use-header-is-stuck'
import { useIsPageVisible } from 'web/hooks/use-page-visible'
import { useReview } from 'web/hooks/use-review'
import { useSaveCampaign } from 'web/hooks/use-save-campaign'
import { useSaveReferral } from 'web/hooks/use-save-referral'
import { useSaveContractVisitsLocally } from 'web/hooks/use-save-visits'
import { useSavedContractMetrics } from 'web/hooks/use-saved-contract-metrics'
import { useTracking } from 'web/hooks/use-tracking'
import { useUser } from 'web/hooks/use-user'
import { useDisplayUserById } from 'web/hooks/use-user-supabase'
import { api } from 'web/lib/api/api'
import { track } from 'web/lib/service/analytics'
import { SpiceCoin } from 'web/public/custom-components/spiceCoin'
import { MarketContext } from './market-context'
import { YourTrades } from './your-trades'

export function ContractPageContent(props: ContractParams) {
  const {
    pointsString,
    multiPointsString,
    chartAnnotations,
    topics,
    dashboards,
  } = props

  // Just use the contract that was navigated to directly
  const liveContract = useLiveContract(props.contract)
  const isMexasOrderBookOnly = isMexasOrderBookOnlyContract(liveContract)

  const user = useUser()

  useSaveReferral(user, {
    defaultReferrerUsername: props.contract.creatorUsername,
    contractId: props.contract.id,
  })

  const myContractMetrics = useSavedContractMetrics(liveContract)
  const topContractMetrics = props.topContractMetrics

  useSaveCampaign()
  useTracking(
    'view market',
    {
      slug: props.contract.slug,
      contractId: props.contract.id,
      creatorId: props.contract.creatorId,
      isPromoted: liveContract.boosted,
    },
    true,
    [user?.id] // track user view market event if they sign up/sign in on this page
  )
  useSaveContractVisitsLocally(user === null, props.contract.id)

  useEffect(() => {
    if ('answers' in props.contract) {
      precacheAnswers(props.contract.answers)
    }
  }, [])

  const { yourNewBets, betPoints } = useBetData({
    contractId: liveContract.id,
    outcomeType: liveContract.outcomeType,
    userId: user?.id,
    lastBetTime: props.lastBetTime,
    totalBets: props.totalBets,
    pointsString: pointsString,
    multiPointsString: multiPointsString,
  })

  const { isResolved, outcomeType, resolution, closeTime, creatorId } =
    liveContract
  const { coverImageUrl } = liveContract

  const description = liveContract.description

  const isAdmin = useAdmin()
  const isMod = useTrusted()
  const isCreator = creatorId === user?.id
  const isClosed = !!(closeTime && closeTime < Date.now())
  const [showResolver, setShowResolver] = useState(false)
  const [showUnresolver, setShowUnresolver] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [showReview, setShowReview] = useState(false)

  const initialHideGraph = shouldHideGraph(liveContract)
  const [hideGraph, setHideGraph] = useState(initialHideGraph)

  const {
    graphUser,
    setGraphUser,
    ready: graphUserReady,
  } = useGraphUserFromUrl()

  // detect whether header is stuck by observing if title is visible
  const { ref: titleRef, headerStuck } = useHeaderIsStuck()

  const showExplainerPanel =
    user === null || (user && user.createdTime > Date.now() - 3 * DAY_MS)

  const [justNowReview, setJustNowReview] = useState<null | Rating>(null)
  const userReview = useReview(props.contract.id, user?.id)
  const userHasReviewed = userReview || justNowReview

  const isSpiceMarket = !!liveContract.isSpicePayout
  const isCashContract = liveContract.token === 'CASH'
  const creatorUser = useDisplayUserById(props.contract.creatorId)
  return (
    <>
      {/* Mobile header for signed-out users */}
      {!user && (
        <Row className="border-ink-200 bg-canvas-0 sticky top-0 z-50 flex items-center justify-between border-b px-4 py-2 md:hidden">
          <Link
            href="/checkout"
            className="text-ink-1000 flex items-center gap-2"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-950 text-xs font-bold text-white dark:bg-white dark:text-slate-950">
              M
            </span>
            <span className="text-sm font-semibold">MEXAS</span>
          </Link>
          <SignUpButton />
        </Row>
      )}
      <Row className="min-h-screen w-full items-start justify-center gap-4 bg-[#f7f8fa] px-0 dark:bg-slate-950 lg:px-4">
        <Col
          className={clsx(
            'border-ink-200 bg-canvas-0 w-full max-w-4xl border-x xl:w-[72%] ',
            // Keep content in view when scrolling related questions on desktop.
            'sticky bottom-0 min-h-screen self-end',
            // Accommodate scroll to top button at bottom of page.
            'pb-10 xl:pb-0'
          )}
        >
          <div
            className={clsx(
              'sticky z-20 flex items-end',
              !coverImageUrl
                ? 'bg-canvas-0 top-0 w-full'
                : 'top-[-92px] h-[140px]'
            )}
          >
            {coverImageUrl && !imageError && (
              <div className="absolute -top-10 bottom-0 left-0 right-0 -z-10">
                <Image
                  fill
                  alt=""
                  sizes="100vw"
                  className="object-cover"
                  src={coverImageUrl}
                  onError={() => {
                    track('image error on contract', {
                      contractId: props.contract.id,
                      imageUrl: coverImageUrl,
                    })
                    setImageError(true)
                  }}
                  priority
                />
                <ChangeBannerButton
                  contract={liveContract}
                  className="absolute right-4 top-12"
                />
              </div>
            )}

            <Row
              className={clsx(
                'sticky -top-px z-50 h-12 w-full transition-colors',
                headerStuck
                  ? 'dark:bg-canvas-50/80 bg-white/80 backdrop-blur-sm'
                  : '',
                // Hide on mobile for signed-out users (they have the logo header instead)
                !user && 'hidden md:flex'
              )}
            >
              <Row className="mr-4 grow items-center">
                {(headerStuck || !coverImageUrl) && (
                  <BackButton className="self-stretch pr-8" />
                )}
                {headerStuck && (
                  <span
                    className="text-ink-1000 line-clamp-2 cursor-pointer select-none first:ml-4"
                    onClick={() =>
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }
                  >
                    {isSpiceMarket && (
                      <Tooltip text={SPICE_MARKET_TOOLTIP}>
                        <SpiceCoin />
                      </Tooltip>
                    )}
                    <VisibilityIcon contract={props.contract} />{' '}
                    {props.contract.question}
                  </span>
                )}
              </Row>
            </Row>
          </div>
          {coverImageUrl && (
            <Row
              className={clsx(
                'h-10 w-full justify-between',
                // Hide on mobile for signed-out users (they have the logo header instead)
                !user && 'hidden md:flex'
              )}
            >
              {/* Wrap in div so that justify-between works when BackButton is null. */}
              <div>
                <BackButton className="pr-8" />
              </div>
            </Row>
          )}

          <Col
            className={clsx(
              'border-ink-200 mb-4 border-b p-4 pt-0 md:pb-8 lg:px-8'
            )}
          >
            <Col className="w-full gap-3 lg:gap-4">
              <Col>
                <div ref={titleRef}>
                  <VisibilityIcon
                    contract={props.contract}
                    isLarge
                    className="mr-1"
                  />
                  <EditableQuestionTitle
                    contract={liveContract}
                    canEdit={isAdmin || isCreator || isMod}
                  />
                </div>
              </Col>
              <Row className="text-ink-600 flex-wrap items-center justify-between gap-y-1 text-sm">
                <AuthorInfo
                  creatorId={props.contract.creatorId}
                  creatorName={props.contract.creatorName}
                  creatorUsername={props.contract.creatorUsername}
                  creatorAvatarUrl={props.contract.creatorAvatarUrl}
                  creatorCreatedTime={props.contract.creatorCreatedTime}
                  token={liveContract.token}
                  resolverId={liveContract.resolverId}
                />
                <ContractSummaryStats
                  contractId={props.contract.id}
                  creatorId={props.contract.creatorId}
                  question={props.contract.question}
                  financeContract={liveContract}
                  editable={isCreator || isAdmin || isMod}
                  isCashContract={isCashContract}
                />
              </Row>
              <Col className="gap-2">
                <ContractOverview
                  contract={liveContract}
                  key={liveContract.id} // reset state when switching play vs cash
                  betPoints={betPoints}
                  showResolver={showResolver}
                  showUnresolver={showUnresolver}
                  resolutionRating={
                    userHasReviewed ? (
                      <Row className="text-ink-500 items-center gap-0.5 text-sm italic">
                        Calificaste esta resolución con{' '}
                        {justNowReview ?? userReview?.rating}{' '}
                        <StarIcon className="h-4 w-4" />
                      </Row>
                    ) : null
                  }
                  setShowResolver={setShowResolver}
                  setShowUnresolver={setShowUnresolver}
                  onAnswerCommentClick={() => undefined}
                  chartAnnotations={chartAnnotations}
                  hideGraph={hideGraph}
                  setHideGraph={setHideGraph}
                  graphUser={graphUser}
                  setGraphUser={setGraphUser}
                />

                <UserBetsSummary
                  className="border-ink-200 mb-2 "
                  contract={liveContract}
                  includeSellButton={
                    tradingAllowed(liveContract) &&
                    (outcomeType === 'NUMBER' ||
                      outcomeType === 'MULTIPLE_CHOICE' ||
                      isBinaryMulti(liveContract) ||
                      outcomeType === 'BINARY' ||
                      outcomeType === 'PSEUDO_NUMERIC' ||
                      outcomeType === 'STONK')
                      ? user
                      : undefined
                  }
                />

                <YourTrades
                  contract={liveContract}
                  yourNewBets={yourNewBets}
                  contractMetric={myContractMetrics}
                />
              </Col>
            </Col>
            {showReview && user && (
              <div className="relative my-2">
                <ReviewPanel
                  marketId={props.contract.id}
                  title={props.contract.question}
                  author={props.contract.creatorName}
                  onSubmit={(rating: Rating) => {
                    setJustNowReview(rating)
                    setShowReview(false)
                  }}
                  creatorUser={creatorUser}
                  currentUser={user}
                  existingReview={
                    userReview
                      ? {
                          rating: userReview.rating as Rating,
                          content: userReview.content,
                        }
                      : undefined
                  }
                />
                <button
                  className="text-ink-400 hover:text-ink-600 absolute right-0 top-0 p-4"
                  onClick={() => setShowReview(false)}
                >
                  <XIcon className="h-5 w-5" />
                </button>
              </div>
            )}
            {showResolver &&
              user &&
              (outcomeType === 'PSEUDO_NUMERIC' ? (
                <GradientContainer className="my-2">
                  <NumericResolutionPanel
                    contract={liveContract}
                    onClose={() => setShowResolver(false)}
                  />
                </GradientContainer>
              ) : outcomeType === 'BINARY' ? (
                <GradientContainer className="my-2">
                  <ResolutionPanel
                    contract={liveContract}
                    onClose={() => setShowResolver(false)}
                  />
                </GradientContainer>
              ) : null)}

            <DangerZone
              contract={liveContract}
              showResolver={showResolver}
              setShowResolver={setShowResolver}
              showUnresolver={showUnresolver}
              setShowUnresolver={setShowUnresolver}
              showReview={showReview}
              setShowReview={setShowReview}
              userHasBet={!!myContractMetrics}
              hasReviewed={!!userHasReviewed}
            />
            {!isResolved && !isClosed && isCreator && (
              <>{showResolver && <Spacer h={4} />}</>
            )}
            {liveContract.token === 'CASH' ? (
              <span className="bg-canvas-50 rounded-md p-4">
                Ver la pregunta principal para la descripción:{' '}
                <Link
                  href={`/${
                    liveContract.creatorUsername
                  }/${liveContract.slug.replace('--cash', '')}`}
                >
                  {liveContract.question}
                </Link>
              </span>
            ) : (
              <ContractDescription
                contractId={props.contract.id}
                creatorId={props.contract.creatorId}
                isSweeps={isCashContract}
                description={description}
              />
            )}
            {props.contract.isRanked !== false && !isMexasOrderBookOnly && (
              <MarketContext contractId={props.contract.id} />
            )}

            <Row className="mb-4 mt-2 items-center gap-2">
              <MarketTopics
                contract={props.contract}
                dashboards={dashboards}
                topics={topics}
                isSpiceMarket={isSpiceMarket}
              />
            </Row>

            <Row className="my-2 flex-wrap items-center justify-between gap-y-2"></Row>
            {!user && <SidebarSignUpButton className="mb-4 flex md:hidden" />}

            {isResolved && resolution !== 'CANCEL' && (
              <>
                <ContractLeaderboard
                  topContractMetrics={topContractMetrics.filter(
                    (metric) => metric.userUsername !== HOUSE_BOT_USERNAME
                  )}
                  contractId={liveContract.id}
                  currentUser={user}
                  currentUserMetrics={myContractMetrics}
                  isCashContract={isCashContract}
                />
                <Spacer h={12} />
              </>
            )}
            {showExplainerPanel && (
              <div className="bg-canvas-50 -mx-4 p-4 pb-0 md:-mx-8 xl:hidden">
                <ExplainerPanel showAccuracy={false} />
              </div>
            )}
          </Col>
        </Col>
        <Col className="hidden min-h-full max-w-[375px] xl:flex">
          {showExplainerPanel && (
            <div>
              <ExplainerPanel showAccuracy={false} />
            </div>
          )}
        </Col>
      </Row>

      <ScrollToTopButton
        className={clsx(
          'fixed right-2 z-20 lg:bottom-2 xl:hidden',
          showResolver || showUnresolver ? 'bottom-40' : 'bottom-16'
        )}
      />
    </>
  )
}

const useBetData = (props: {
  contractId: string
  outcomeType: Contract['outcomeType'] | undefined
  userId: string | undefined
  lastBetTime: number | undefined
  totalBets: number
  pointsString: string | undefined
  multiPointsString: MultiBase64Points | undefined
}) => {
  const {
    contractId,
    userId,
    outcomeType,
    lastBetTime,
    pointsString,
    multiPointsString,
  } = props

  const isNumber = outcomeType === 'NUMBER'
  const isMultiNumeric =
    outcomeType === 'MULTI_NUMERIC' || outcomeType === 'DATE'

  const newBets = useContractBets(
    contractId,
    {
      afterTime: lastBetTime ?? 0,
      includeZeroShareRedemptions: true,
      // TODO: this shows the redemptions in the trades tab??
      filterRedemptions: !isNumber && !isMultiNumeric,
    },
    useIsPageVisible,
    (params) => api('bets', params)
  )

  const newBetsWithoutRedemptions = newBets.filter((bet) => !bet.isRedemption)
  const totalBets =
    props.totalBets +
    (isNumber
      ? uniqBy(newBetsWithoutRedemptions, 'betGroupId').length
      : newBetsWithoutRedemptions.length)
  const bets = useMemo(
    () => uniqBy(isNumber ? newBets : newBetsWithoutRedemptions, 'id'),
    [newBets.length]
  )
  const yourNewBets = newBets.filter((bet) => userId && bet.userId === userId)

  const betPoints = useMemo(() => {
    if (
      outcomeType === 'MULTIPLE_CHOICE' ||
      outcomeType === 'NUMBER' ||
      outcomeType === 'MULTI_NUMERIC' ||
      outcomeType === 'DATE'
    ) {
      const data = multiPointsString
        ? unserializeBase64Multi(multiPointsString)
        : {}
      const newData = getMultiBetPointsFromBets(newBets)

      return mergeWith(data, newData, (array1, array2) =>
        [...(array1 ?? []), ...(array2 ?? [])].sort((a, b) => a.x - b.x)
      ) as MultiPoints
    } else {
      const points = pointsString ? base64toPoints(pointsString) : []
      const newPoints = newBetsWithoutRedemptions.map((bet) => ({
        x: bet.createdTime,
        y: bet.probAfter,
      }))
      return [...points, ...newPoints] as HistoryPoint<Partial<Bet>>[]
    }
  }, [pointsString, newBets.length])

  return {
    bets,
    totalBets,
    yourNewBets,
    betPoints,
  }
}
