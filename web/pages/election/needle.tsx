import { GetServerSideProps } from 'next'

export default function ElectionNeedlePage() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/checkout',
    permanent: false,
  },
})
