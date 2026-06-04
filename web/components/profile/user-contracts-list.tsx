import { User } from 'common/user'
import { shortFormatNumber } from 'common/util/format'
import { ReactNode, useEffect, useState } from 'react'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import {
  FILTER_KEY,
  LoadingContractResults,
  NoMoreResults,
  QUERY_KEY,
  useSearchQueryState,
  useSearchResults,
} from 'web/components/search'
import { Tooltip } from 'web/components/widgets/tooltip'
import { useUser } from 'web/hooks/use-user'
import { db } from 'web/lib/supabase/db'
import { SearchInput } from '../search/search-input'
import { LoadMoreUntilNotVisible } from 'web/components/widgets/visibility-observer'
import { CombinedResults } from '../contract/combined-results'

export function UserContractsList(props: {
  creator: User
  rating?: number
  reviewCount?: number
  averageRating?: number
}) {
  const { creator } = props
  const [marketsCreated, setMarketsCreated] = useState<number | undefined>()
  const [unresolvedMarkets, setUnresolvedMarkets] = useState<number>(0)

  useEffect(() => {
    getMexasContractsCreatedCount(creator.id).then((count) =>
      setMarketsCreated(count ?? 0)
    )
    getMexasUnresolvedContractsCount(creator.id).then((count) =>
      setUnresolvedMarkets(count ?? 0)
    )
  }, [creator.id])

  const user = useUser()

  const persistPrefix = `user-contracts-list-${creator.id}`

  const [params, updateParams, isReady] = useSearchQueryState({
    defaultFilter: 'all',
    defaultSort: 'newest',
    persistPrefix,
    defaultSweepies: '2',
  })

  const { contracts, loading, shouldLoadMore, loadMoreContracts } =
    useSearchResults({
      persistPrefix,
      searchParams: params,
      includeUsersAndTopics: false,
      isReady,
      additionalFilter: { creatorId: creator.id, mexasOnly: true },
    })

  const query = params[QUERY_KEY]
  const setQuery = (query: string) => updateParams({ [QUERY_KEY]: query })

  const seeClosed = () => updateParams({ [FILTER_KEY]: 'closed' })

  return (
    <Col className={'w-full'}>
      <Row className={'mb-4 gap-8'}>
        <MarketStats
          title={'Mercados MEX'}
          total={shortFormatNumber(marketsCreated ?? 0)}
          subTitle={
            unresolvedMarkets === 0 ? null : (
              <Tooltip text={'Cerrados y pendientes de resolucion'}>
                <button
                  className="bg-scarlet-300 text-ink-0 min-w-[15px] cursor-pointer rounded-full p-[2px] text-center text-[10px] leading-3"
                  onClick={seeClosed}
                >
                  {`${unresolvedMarkets}`}
                </button>
              </Tooltip>
            )
          }
        />
        <MarketStats
          title={'Por resolver'}
          total={shortFormatNumber(unresolvedMarkets)}
        />
      </Row>

      <Col className="bg-canvas-0 sticky -top-px z-20">
        <SearchInput
          value={query}
          setValue={setQuery}
          placeholder={
            creator.id === user?.id
              ? 'Buscar tus mercados'
              : `Buscar mercados de ${creator.name}`
          }
          autoFocus={true}
          loading={loading}
        />
      </Col>
      <Col className="w-full">
        {loading && !contracts ? (
          <LoadingContractResults />
        ) : !contracts || contracts.length === 0 ? (
          <>
            <div className="text-ink-700 mx-2 mt-3 text-center">
              No hay mercados MEXAS.
            </div>
          </>
        ) : (
          <>
            <CombinedResults
              contracts={contracts ?? []}
              posts={[]}
              searchParams={params}
              hideAvatars={true}
            />
            <LoadMoreUntilNotVisible loadMore={loadMoreContracts} />
            {shouldLoadMore && <LoadingContractResults />}
            {!shouldLoadMore && (
              <NoMoreResults params={params} onChange={updateParams} />
            )}
          </>
        )}
      </Col>
    </Col>
  )
}

async function getMexasContractsCreatedCount(creatorId: string) {
  const { count } = await db
    .from('contracts')
    .select('*', { head: true, count: 'exact' })
    .eq('visibility', 'public')
    .eq('creator_id', creatorId)
    .eq('data->>token', 'MEX')
    .eq('mechanism', 'cpmm-1')
    .eq('outcome_type', 'BINARY')

  return count
}

async function getMexasUnresolvedContractsCount(creatorId: string) {
  const { count } = await db
    .from('contracts')
    .select('*', { head: true, count: 'exact' })
    .eq('creator_id', creatorId)
    .is('resolution_time', null)
    .lt('close_time', new Date().toISOString())
    .eq('data->>token', 'MEX')
    .eq('mechanism', 'cpmm-1')
    .eq('outcome_type', 'BINARY')

  return count
}

export const MarketStats = (props: {
  title: string
  total: string
  subTitle?: ReactNode
}) => {
  const { title, total, subTitle } = props
  return (
    <Col className="select-none">
      <div className="text-ink-600 text-xs sm:text-sm">{title}</div>
      <Row className="items-center gap-2">
        <span className="text-primary-600 text-lg sm:text-xl">{total}</span>
        {subTitle}
      </Row>
    </Col>
  )
}
