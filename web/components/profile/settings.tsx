import { RefreshIcon } from '@heroicons/react/solid'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { AiOutlineCopy } from 'react-icons/ai'
import { copyToClipboard } from 'web/lib/util/copy'
import { Button } from '../buttons/button'
import { ConfirmationButton } from '../buttons/confirmation-button'
import { Col } from '../layout/col'
import { Modal } from '../layout/modal'
import { Row } from '../layout/row'
import { InfoTooltip } from '../widgets/info-tooltip'
import { Input } from '../widgets/input'
import ShortToggle from '../widgets/short-toggle'
import { Title } from '../widgets/title'
import { PrivateUser, User } from 'common/user'
import { useEffect, useState } from 'react'
import { generateNewApiKey } from 'web/lib/api/api-key'
import { api } from 'web/lib/api/api'
import { DeleteYourselfButton } from './delete-yourself'
import { ENV_CONFIG, isAdminId } from 'common/envs/constants'
import { useNativeInfo } from '../native-message-provider'
import { postMessageToNative } from 'web/lib/native/post-message'
import { useRouter } from 'next/router'

export const AccountSettings = (props: {
  user: User
  privateUser: PrivateUser
}) => {
  const { user, privateUser } = props

  const [apiKey, setApiKey] = useState(privateUser.apiKey || '')
  const [betWarnings, setBetWarnings] = useState(!user.optOutBetWarnings)
  const [appUrl, setAppUrl] = useState('https://' + ENV_CONFIG.domain)
  const isAdmin = isAdminId(user.id)
  const { isNative } = useNativeInfo()

  const sendAppUrl = async () => {
    postMessageToNative('setAppUrl', { appUrl })
    return
  }
  const updateApiKey = async (e?: React.MouseEvent) => {
    const newApiKey = await generateNewApiKey()
    setApiKey(newApiKey ?? '')
    e?.preventDefault()

    if (!privateUser.twitchInfo) return
    await api('save-twitch', { twitchInfo: { needsRelinking: true } })
  }

  return (
    <Col className="gap-5">
      <div>
        <label className="mb-1 block">
          Alertas de operación{' '}
          <InfoTooltip text="Avisos antes de enviar una orden que use una parte grande de tu balance o mueva mucho la probabilidad" />
        </label>
        <ShortToggle
          on={betWarnings}
          setOn={(enabled) => {
            setBetWarnings(enabled)
            api('me/update', { optOutBetWarnings: !enabled })
          }}
        />
      </div>

      <div>
        <label className="mb-1 block">Notificaciones y correos</label>
        <Link href="/notifications?tab=settings">
          <Button>Editar ajustes</Button>
        </Link>
      </div>
      {isAdmin && isNative && (
        <div>
          Native url
          <Input value={appUrl} onChange={(e) => setAppUrl(e.target.value)} />
          <Button onClick={sendAppUrl}>Send</Button>
        </div>
      )}
      <div>
        <label className="mb-1 block">Clave API</label>
        <Row className="items-stretch gap-3">
          <Input
            type="text"
            placeholder="Genera una clave"
            value={apiKey}
            readOnly
            className={'w-24'}
          />

          <Button
            color={'indigo'}
            onClick={() => {
              copyToClipboard(apiKey)
              toast.success('Copiado al portapapeles')
            }}
          >
            <AiOutlineCopy className="h-5 w-5" />
          </Button>
          <ConfirmationButton
            openModalBtn={{
              className: 'p-2',
              label: '',
              icon: <RefreshIcon className="h-5 w-5" />,
              color: 'red',
            }}
            submitBtn={{
              label: 'Actualizar clave',
            }}
            onSubmitWithSuccess={async () => {
              updateApiKey()
              return true
            }}
          >
            <Col>
              <Title>¿Actualizar clave API?</Title>
              <div>
                Al actualizarla, las aplicaciones conectadas a tu cuenta tendrán
                que usar la nueva clave.
              </div>
            </Col>
          </ConfirmationButton>
        </Row>
      </div>
      {!user.isBot && (
        <div>
          <label className="mb-1 block">Estado de bot</label>
          <MarkSelfAsBotButton user={user} />
        </div>
      )}
      <div>
        <label className="mb-1 block">Eliminar cuenta</label>
        <div className="flex  items-center  ">
          <DeleteYourselfButton username={user.username} />
        </div>
      </div>
    </Col>
  )
}

function MarkSelfAsBotButton(props: { user: User }) {
  const { user } = props
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!showModal) {
      setCountdown(10)
      return
    }
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [showModal, countdown])

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      await api('set-bot-status', { userId: user.id, isBot: true })
      toast.success('Cuenta marcada como bot')
      router.reload()
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudo actualizar el estado de bot')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button color="yellow" size="xs" onClick={() => setShowModal(true)}>
        Marcar mi cuenta como bot
      </Button>
      <Modal open={showModal} setOpen={setShowModal} size="md">
        <Col className="bg-canvas-0 gap-4 rounded-xl p-6">
          <Title className="!mb-0">Marcar cuenta como bot</Title>
          <div className="text-ink-700 space-y-3 text-sm leading-relaxed">
            <p>
              Esto marcará tu cuenta como bot de forma <b>permanente</b>. La
              acción <b>no se puede deshacer</b> sin contactar a moderación.
            </p>
            <p className="font-semibold">Las cuentas bot:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Muestran una etiqueta "Bot" junto al nombre</li>
              <li>Se excluyen de ligas y se colocan en la división Silicon</li>
              <li>
                No cuentan para bonos por operadores únicos de creadores de
                mercados
              </li>
              <li>Se excluyen del cálculo de importancia</li>
              <li>No pueden generar bonos de operador para otros usuarios</li>
            </ul>
            <p>
              Usa esto solo si tu cuenta opera mediante un sistema automatizado
              (bot de trading, script API, etc.), no una persona.
            </p>
          </div>
          <Row className="mt-2 justify-end gap-3">
            <Button color="gray" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button
              color="red"
              disabled={countdown > 0 || submitting}
              loading={submitting}
              onClick={handleConfirm}
            >
              {countdown > 0
                ? `Entiendo (${countdown}s)`
                : 'Marcar como bot permanentemente'}
            </Button>
          </Row>
        </Col>
      </Modal>
    </>
  )
}
