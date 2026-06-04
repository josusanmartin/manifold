import { JSONContent } from '@tiptap/core'
import clsx from 'clsx'
import { useUser } from 'web/hooks/use-user'
import { LogoIcon } from '../icons/logo-icon'
import { CollapsibleContent } from '../widgets/collapsible-content'
import { PendingClarifications } from './pending-clarifications'

export function ContractDescription(props: {
  contractId: string // the description is stored on this contract
  creatorId: string
  hidePendingClarifications?: boolean
  isSweeps: boolean
  description: string | JSONContent
}) {
  const {
    contractId,
    creatorId,
    hidePendingClarifications = false,
    isSweeps,
    description,
  } = props

  const user = useUser()
  const isCreator = user?.id === creatorId

  return (
    <>
      <div className="mb-2 mt-6">
        <CollapsibleContent
          mediaSize="md"
          content={description}
          stateKey={`isCollapsed-contract-${contractId}`}
          hideCollapse={!user}
        />

        {!hidePendingClarifications && (
          <PendingClarifications contractId={contractId} isCreator={isCreator} />
        )}

        <div
          className={clsx(
            !isSweeps && 'hidden',
            'text-ink-600 bg-canvas-50 flex items-center justify-center space-x-2 rounded-md px-4 py-2 italic'
          )}
        >
          <LogoIcon className="h-5 w-5 text-teal-600" />
          <span>Este mercado es gestionado y resuelto por MEXAS Markets.</span>
          <LogoIcon className="h-5 w-5 text-teal-600" />
        </div>
      </div>
    </>
  )
}

export function JSONEmpty(text: string | JSONContent) {
  if (!text) return true
  if (typeof text === 'string') {
    return text.trim() === ''
  } else if ('content' in text) {
    return !(
      text.content &&
      text.content.length > 0 &&
      text.content.some((node) => node.content || node.attrs)
    )
  }
  return true
}
