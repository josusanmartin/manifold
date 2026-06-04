import { GetServerSideProps } from 'next'

export default function DiscordBotPage() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/checkout',
    permanent: false,
  },
})
