import bcrypt from 'bcryptjs'

export const PASSWORD_SIZE_ERROR = 'Password must be 72 UTF-8 bytes or less (accented characters and emoji use multiple bytes)'

/** bcrypt authenticates only the first 72 bytes, not 72 JavaScript characters. */
export function fitsBcrypt(password: unknown): password is string {
  return typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= 72
}

/** Never allow a truncated input to authenticate an account or a protected room. */
export async function comparePassword(password: unknown, hash: string): Promise<boolean> {
  return fitsBcrypt(password) && await bcrypt.compare(password, hash)
}
