export default function CommentsPage() {
  return null
}

export const getServerSideProps = async () => {
  return {
    redirect: {
      destination: '/checkout',
      permanent: false,
    },
  }
}
