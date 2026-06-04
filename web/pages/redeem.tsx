import { GetServerSideProps } from 'next'

export type CashoutPagesType =
  | 'select-cashout-method'
  | 'location'
  | 'get-session'
  | 'ach-details'
  | 'waiting'
  | 'documents'
  | 'custom-mana'

export default function LegacyRedirectPage() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/checkout',
    permanent: false,
  },
})
