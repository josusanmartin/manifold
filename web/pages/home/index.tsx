import Router from 'next/router'

import { SEO } from 'web/components/SEO'
import { DailyStats } from 'web/components/home/daily-stats'
import { Page } from 'web/components/layout/page'
import { DowntimeBanner } from 'web/components/nav/banner'
import { Welcome } from 'web/components/onboarding/welcome'
import { VerificationResultModal } from 'web/components/onboarding/verification-result-modal'
import { useRedirectIfSignedOut } from 'web/hooks/use-redirect-if-signed-out'
import { useSaveReferral } from 'web/hooks/use-save-referral'
import { useUser } from 'web/hooks/use-user'
import { track } from 'web/lib/service/analytics'
import { BrowsePageContent } from '../browse'
export default function Home() {
  const user = useUser()
  useSaveReferral(user)
  useRedirectIfSignedOut()

  return (
    <Page trackPageView={'home'} className="lg:px-4">
      <Welcome />
      <VerificationResultModal />
      <SEO title={`Home`} description={`Browse all questions`} url={`/home`} />
      <DowntimeBanner />
      <DailyStats className="z-50 mb-1 w-full px-2 py-2" user={user} />
      <BrowsePageContent />
      {user && (
        <button
          type="button"
          className="fixed bottom-[64px] right-3 z-20 inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-3 text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 lg:hidden"
          onClick={() => {
            Router.push('/payments')
            track('mobile wallet button')
          }}
        >
          <span className="font-semibold">Wallet</span>
        </button>
      )}
      {/* Preload feed */}
      {/* {user && <LiveGeneratedFeed userId={user.id} hidden />} */}
      {/* {user && <ExploreContent render={false} />} */}
    </Page>
  )
}
