import type { AccountRole } from '../../../shared/types'
import { ROLE_LABEL } from '../lib/roles'

export function RoleBadge({ role, className = '' }: { role: AccountRole; className?: string }) {
  return (
    <span className={`role-badge role-badge--${role} ${className}`.trim()}>
      {ROLE_LABEL[role]}
    </span>
  )
}
