const KEY = 'pos_device_ui_mode'

export type DeviceUiMode = 'desktop' | 'touch' | 'mobile'

export const DEVICE_UI_MODES: {
  value: DeviceUiMode
  label: string
  description: string
}[] = [
  {
    value: 'desktop',
    label: 'Desktop',
    description: 'Mouse and keyboard — compact controls, side cart on wide screens.',
  },
  {
    value: 'touch',
    label: 'Touch screen',
    description: 'Finger-friendly tap targets on tablets and touch monitors.',
  },
  {
    value: 'mobile',
    label: 'Mobile',
    description: 'Phone-optimized checkout — floating cart, full-screen products.',
  },
]

const VALID: DeviceUiMode[] = ['desktop', 'touch', 'mobile']

export function parseDeviceUiMode(value: unknown): DeviceUiMode {
  if (typeof value === 'string' && (VALID as string[]).includes(value)) {
    return value as DeviceUiMode
  }
  return 'desktop'
}

export function getDeviceUiMode(): DeviceUiMode {
  if (typeof window === 'undefined') return 'desktop'
  return parseDeviceUiMode(localStorage.getItem(KEY))
}

export function setDeviceUiMode(mode: DeviceUiMode): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, mode)
}

export function isTouchOptimized(mode: DeviceUiMode): boolean {
  return mode === 'touch' || mode === 'mobile'
}

/** Radix dialog content classes — bottom sheet on mobile, centered otherwise. */
export function posDialogContentClass(mode: DeviceUiMode, maxWidth = 'max-w-sm'): string {
  const base = 'fixed z-50 bg-white shadow-2xl focus:outline-none overflow-y-auto'
  if (mode === 'mobile') {
    return `${base} max-h-[92vh] inset-x-0 bottom-0 rounded-t-2xl p-5 pb-8 w-full safe-area-pb`
  }
  if (mode === 'touch') {
    return `${base} top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 w-[calc(100%-2rem)] ${maxWidth}`
  }
  return `${base} top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 w-full ${maxWidth}`
}

/** Primary action button sizing for POS checkout area. */
export function posActionBtnClass(mode: DeviceUiMode): string {
  if (isTouchOptimized(mode)) {
    return 'min-h-11 text-base active:scale-[0.98]'
  }
  return 'text-sm'
}

/** Quantity stepper button classes. */
export function posQtyBtnClass(mode: DeviceUiMode): string {
  if (mode === 'mobile') {
    return 'min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-gray-200 bg-white active:bg-gray-100 active:scale-95'
  }
  if (mode === 'touch') {
    return 'min-h-10 min-w-10 flex items-center justify-center rounded-lg border border-gray-200 bg-white active:bg-gray-100 active:scale-95'
  }
  return 'p-1 rounded-md hover:bg-gray-100 border border-gray-200'
}

/** Product grid column classes. */
export function posProductGridClass(mode: DeviceUiMode): string {
  if (mode === 'mobile') return 'grid grid-cols-2 gap-3 pt-3'
  if (mode === 'touch') return 'grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 pt-3'
  return 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-3'
}

/** Product card image height. */
export function posProductImageClass(mode: DeviceUiMode): string {
  if (mode === 'mobile') return 'w-full h-36 object-cover'
  if (mode === 'touch') return 'w-full h-32 object-cover'
  return 'w-full h-28 object-cover'
}

/** Product card press feedback. */
export function posProductCardClass(mode: DeviceUiMode, stockClass: string): string {
  const feedback = isTouchOptimized(mode)
    ? 'active:scale-[0.98] active:brightness-95'
    : 'hover:border-blue-400 hover:bg-blue-50'
  return `text-left border rounded-xl overflow-hidden transition-transform focus:outline-none focus:ring-2 focus:ring-blue-500 ${feedback} ${stockClass}`
}
