import { GetServerSideProps } from 'next'

export default function ElectionPage() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/checkout',
    permanent: false,
  },
})
