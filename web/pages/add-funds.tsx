import { GetServerSideProps } from 'next'

export default function AddFundsPage() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/wallet',
    permanent: false,
  },
})
