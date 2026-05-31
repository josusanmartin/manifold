import { JsonLd } from './JsonLd'
import {
  MEXAS_SITE_DESCRIPTION,
  MEXAS_SITE_NAME,
  MEXAS_SITE_URL,
} from 'web/lib/mexas-brand'

export function LogoSEO() {
  const orgData = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: MEXAS_SITE_NAME,
    url: MEXAS_SITE_URL,
    description: MEXAS_SITE_DESCRIPTION,
  }

  return <JsonLd data={orgData} id="organization" />
}
