import { GetServerSideProps } from 'next'

export default function YCS23Page() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/checkout',
    permanent: false,
  },
})
