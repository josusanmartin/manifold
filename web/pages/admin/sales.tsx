import { GetServerSideProps } from 'next'

export default function LegacyAdminRedirectPage() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/checkout',
    permanent: false,
  },
})
