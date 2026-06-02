import { useEffect } from 'react'
import { useRouter } from 'next/router'

import { useIsAuthorized, useUser } from 'web/hooks/use-user'

export default function MePage() {
  const router = useRouter()
  const user = useUser()
  const isAuthorized = useIsAuthorized()

  useEffect(() => {
    if (user) {
      const query = { ...router.query }
      delete query.username // Remove username if it exists
      router.replace({
        pathname: `/${user.username}`,
        query,
      })
    } else if (isAuthorized === false) {
      router.replace('/wallet')
    }
  }, [isAuthorized, user, router])

  return <></>
}
