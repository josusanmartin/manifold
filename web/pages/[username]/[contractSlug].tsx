import { ContractParams, MaybeAuthedContractParams } from 'common/contract'
import { getContractParams } from 'common/contract-params'
import { base64toPoints } from 'common/edge/og'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import { getContractFromSlug } from 'common/supabase/contracts'
import { removeUndefinedProps } from 'common/util/object'
import { MexasContractPageContent } from 'web/components/contract/mexas-contract-page'
import { ContractSEO } from 'web/components/contract/contract-seo'
import { Title } from 'web/components/widgets/title'
import { toPublicMexasContractParams } from 'web/lib/mexas-public-contract'
import { initSupabaseAdmin } from 'web/lib/supabase/admin-db'
import Custom404 from '../404'

export async function getStaticProps(ctx: {
  params: { username: string; contractSlug: string }
}) {
  const { username, contractSlug } = ctx.params
  const adminDb = await initSupabaseAdmin()

  let contract
  try {
    contract = await getContractFromSlug(adminDb, contractSlug)
  } catch (error) {
    console.error('DB error fetching contract:', contractSlug, error)
    // Throw so ISR serves the previous static page and retries later.
    throw error
  }

  if (!contract) {
    return { notFound: true }
  }

  if (!isMexasOrderBookOnlyContract(contract)) {
    return { notFound: true }
  }

  if (contract.creatorUsername.toLowerCase() !== username.toLowerCase()) {
    return {
      redirect: {
        destination: `/${contract.creatorUsername}/${contract.slug}`,
        permanent: false,
      },
    }
  }

  if (contract.deleted) {
    return {
      props: {
        state: 'deleted',
        slug: contract.slug,
        visibility: contract.visibility,
      },
    }
  }

  let props
  try {
    props = await getContractParams(contract, adminDb)
  } catch (error) {
    console.error('DB error fetching contract params:', contractSlug, error)
    // Throw so ISR serves the previous static page and retries later.
    throw error
  }

  return {
    props: {
      state: 'authed',
      params: removeUndefinedProps(toPublicMexasContractParams(props)),
    },
  }
}

export async function getStaticPaths() {
  return { paths: [], fallback: 'blocking' }
}

export default function ContractPage(props: MaybeAuthedContractParams) {
  if (props.state === 'deleted') {
    return (
      <div className="min-h-screen">
        <div className="flex h-[50vh] flex-col items-center justify-center">
          <Title>Pregunta eliminada</Title>
        </div>
      </div>
    )
  }

  return <NonPrivateContractPage contractParams={props.params} />
}

function NonPrivateContractPage(props: { contractParams: ContractParams }) {
  const { contract, pointsString } = props.contractParams

  const points = pointsString ? base64toPoints(pointsString) : []

  if (!contract) {
    return <Custom404 customText="No se pudo cargar la pregunta" />
  }

  return (
    <div className="min-h-screen">
      <ContractSEO contract={contract} points={pointsString} />
      <MexasContractPageContent key={contract.id} {...props.contractParams} />
    </div>
  )
}
