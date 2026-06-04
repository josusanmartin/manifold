import { GetServerSideProps } from 'next'

export default function RemovedLegacyPage() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/checkout',
    permanent: false,
  },
})
