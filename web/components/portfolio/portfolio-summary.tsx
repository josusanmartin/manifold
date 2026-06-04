import clsx from 'clsx'

import { User } from 'common/user'
import { useAPIGetter } from 'web/hooks/use-api-getter'
import { useUser } from 'web/hooks/use-user'
import { Col } from '../layout/col'
import { PortfolioValueSection } from './portfolio-value-section'
import { useEffect } from 'react'
import { useIsPageVisible } from 'web/hooks/use-page-visible'

export const PortfolioSummary = (props: { user: User; className?: string }) => {
  const { user, className } = props
  const currentUser = useUser()
  const isCreatedInLastWeek =
    user.createdTime > Date.now() - 7 * 24 * 60 * 60 * 1000

  const {
    data: portfolioData,
    refresh,
    loading,
  } = useAPIGetter('get-user-portfolio', {
    userId: user.id,
    mexasOnly: true,
  })
  useEffect(() => {
    if (currentUser?.id === user.id && !loading) {
      refresh()
    }
  }, [currentUser?.balance, currentUser?.id])

  const visible = useIsPageVisible()
  useEffect(() => {
    if (visible && !loading) {
      refresh()
    }
  }, [visible])

  return (
    <Col className={clsx(className, 'gap-4')}>
      <PortfolioValueSection
        user={user}
        defaultTimePeriod={
          isCreatedInLastWeek
            ? 'allTime'
            : currentUser?.id === user.id
            ? 'weekly'
            : 'monthly'
        }
        portfolio={portfolioData}
        mexasOnly
      />
    </Col>
  )
}
