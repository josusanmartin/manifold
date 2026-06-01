import { GetServerSideProps } from 'next'

export default function NewsPage() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/checkout',
    permanent: false,
  },
})
