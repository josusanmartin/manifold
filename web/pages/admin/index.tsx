import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from 'web/components/buttons/button'
import { ConfirmationButton } from 'web/components/buttons/confirmation-button'
import { Page } from 'web/components/layout/page'
import { Row } from 'web/components/layout/row'
import { NoSEO } from 'web/components/NoSEO'
import ShortToggle from 'web/components/widgets/short-toggle'
import { Title } from 'web/components/widgets/title'
import { useAdmin } from 'web/hooks/use-admin'
import { useRedirectIfSignedOut } from 'web/hooks/use-redirect-if-signed-out'
import { handleCreateSportsMarkets } from 'web/lib/admin/create-sports-markets'
import { api } from 'web/lib/api/api'
import { db } from 'web/lib/supabase/db'

export default function AdminPage() {
  useRedirectIfSignedOut()
  const isAdmin = useAdmin()
  const [loanStatus, setLoanStatus] = useState(true)
  const [togglesEnabled, setTogglesEnabled] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isFinished, setIsFinished] = useState(false)

  useEffect(() => {
    db.from('system_trading_status')
      .select('*')
      .then((result) => {
        const statuses = result.data ?? []
        setLoanStatus(statuses.find((s) => s.token === 'LOAN')?.status ?? true)
      })
  }, [])

  const toggleStatus = async (token: 'LOAN') => {
    if (!togglesEnabled) return
    const result = await api('toggle-system-trading-status', { token })
    setLoanStatus(result.status)
  }

  if (!isAdmin) return <></>

  return (
    <Page trackPageView={'admin page'}>
      <NoSEO />
      <div className="mx-8">
        <Title>Admin</Title>
        <Row className="mb-4 flex items-center justify-around gap-2 p-2">
          <span> Toggles: {togglesEnabled ? 'Unlocked' : 'Locked'} </span>
          <ShortToggle
            on={togglesEnabled}
            setOn={setTogglesEnabled}
            disabled={false}
          />
          <span>Loans: {loanStatus ? 'Enabled' : 'Disabled'}</span>
          <ShortToggle
            on={loanStatus}
            setOn={() => toggleStatus('LOAN')}
            disabled={!togglesEnabled}
          />
        </Row>

        <AdminCard title="Sales" href="/admin/sales" />
        <AdminCard title="Manifest tickets" href="/admin/tickets" />
        <AdminCard title="New users" href="/admin/new-users" />
        <AdminCard title="Whales" href="/admin/whales" />
        <AdminCard title="Stats" href="/stats" />
        <AdminCard
          title="Umami"
          href="https://analytics.eu.umami.is/websites/ee5d6afd-5009-405b-a69f-04e3e4e3a685"
        />
        <AdminCard
          title="Grafana"
          description="db performance"
          href="https://manifoldmarkets.grafana.net/d/TFZtEJh4k/supabase"
        />
        <AdminCard
          title="Postgres logs"
          href="https://app.supabase.com/project/pxidrgkatumlvfqaxcll/logs/postgres-logs"
        />
        <AdminCard title="Reports" href="/admin/reports" />
        <AdminCard title="Merch management" href="/admin/merch" />
        <AdminCard title="Design system" href="/styles" />
        <AdminCard title="Test new user" href="/admin/test-user" />
        <AdminCard title="Update user" href="/admin/update-user" />
        <AdminCard
          title="User info and account management"
          href="/admin/user-info"
        />
        <Row className="gap-2">
          <Button onClick={() => api('refresh-all-clients', {})}>
            Refresh all clients
          </Button>
          <ConfirmationButton
            openModalBtn={{
              label: isLoading ? 'Creating...' : 'Create Sports Markets',
              disabled: isLoading,
            }}
            submitBtn={{
              label: 'Create',
              isSubmitting: isLoading,
              color: 'green',
            }}
            onSubmit={() =>
              handleCreateSportsMarkets(setIsLoading, setIsFinished)
            }
          >
            <p>Are you sure you want to create new sports markets?</p>
            <p>
              Make sure you are logged into the Manifold account and have
              ~50,000 mana.
            </p>
          </ConfirmationButton>
          {isFinished && (
            <div className="mt-4 text-green-600">
              ✅ Sports markets created successfully!
            </div>
          )}
        </Row>
      </div>
    </Page>
  )
}

function AdminCard(props: {
  title: string
  description?: string
  href: string
}) {
  const { title, description, href } = props

  return (
    <Link
      href={href}
      className="border-ink-300 hover:bg-primary-100 mb-4 block rounded-md border px-4 py-3"
    >
      <div className="text-lg font-semibold">{title}</div>
      {description && <p className="text-ink-600">{description}</p>}
    </Link>
  )
}

const Badge = (props: { src: string; href: string }) => {
  return (
    <a href={props.href}>
      <img src={props.src} alt="" />
    </a>
  )
}
