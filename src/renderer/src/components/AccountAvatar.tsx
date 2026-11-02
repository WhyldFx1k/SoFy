import { UserRound } from 'lucide-react'
import type { Account } from '../../../shared/types'
import { initials } from '../lib/format'

export function AccountAvatar({
  account,
  className = ''
}: {
  account: Account | null
  className?: string
}) {
  return (
    <span className={`account-avatar ${className}`.trim()} aria-hidden="true">
      {account?.avatar ? (
        <img src={account.avatar} alt="" draggable={false} />
      ) : account ? (
        <span className="account-avatar__initials">{initials(account.displayName)}</span>
      ) : (
        <UserRound size={18} strokeWidth={1.9} />
      )}
    </span>
  )
}
