import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS)
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash)
}

export function validatePinFormat(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) {
    return 'PIN must be 4–6 digits'
  }
  return null
}
