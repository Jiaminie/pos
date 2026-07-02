import { v2 as cloudinary } from 'cloudinary'

export function configureCloudinary(): void {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  })
}

export function cloudinaryEnvReady(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  )
}

export const CLOUDINARY_ENV_VARS = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
] as const

export function missingCloudinaryEnvVars(): string[] {
  return CLOUDINARY_ENV_VARS.filter((name) => !process.env[name])
}
