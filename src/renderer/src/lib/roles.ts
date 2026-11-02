import type { AccountRole } from '../../../shared/types'

export const ROLE_LABEL: Record<AccountRole, string> = {
  user: 'Пользователь',
  admin: 'Администратор',
  owner: 'Владелец'
}

export function isStaff(role: AccountRole | null | undefined): boolean {
  return role === 'admin' || role === 'owner'
}
