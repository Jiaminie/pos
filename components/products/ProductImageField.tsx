'use client'

import { useRef, useState } from 'react'
import * as Label from '@radix-ui/react-label'
import { Camera, ImagePlus, X } from 'lucide-react'
import { compressProductImage } from '@/lib/image'
import { WebcamCapture } from './WebcamCapture'

type Props = {
  imageUrl: string
  uploading: boolean
  onFile: (file: File) => void
  onClear: () => void
}

export function ProductImageField({ imageUrl, uploading, onFile, onClear }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [webcamOpen, setWebcamOpen] = useState(false)

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) {
      const compressed = await compressProductImage(file)
      onFile(compressed)
    }
  }

  async function handleWebcamCapture(file: File) {
    const compressed = await compressProductImage(file)
    onFile(compressed)
  }

  function openCamera() {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
    if (isMobile) {
      cameraRef.current?.click()
    } else {
      setWebcamOpen(true)
    }
  }

  const preview = imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt="Product preview" className="w-full h-full object-cover" />
  ) : (
    <Camera size={24} className="text-gray-400" />
  )

  const actionButtons = (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-col sm:gap-2 sm:min-w-[9rem]">
      <button
        type="button"
        disabled={uploading}
        onClick={openCamera}
        className="flex items-center justify-center gap-2 py-3 sm:py-2 px-3 rounded-xl sm:rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        <Camera size={18} />
        Take photo
      </button>
      <button
        type="button"
        disabled={uploading}
        onClick={() => galleryRef.current?.click()}
        className="flex items-center justify-center gap-2 py-3 sm:py-2 px-3 rounded-xl sm:rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        <ImagePlus size={18} />
        Choose file
      </button>
    </div>
  )

  return (
    <div className="space-y-1.5">
      <Label.Root className="text-sm font-medium text-gray-700">Image</Label.Root>

      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={uploading}
        onChange={pick}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={uploading}
        onChange={pick}
      />

      {/* Desktop */}
      <div className="hidden sm:flex items-start gap-4">
        <div className="relative w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 overflow-hidden bg-gray-50 flex items-center justify-center shrink-0">
          {preview}
          {imageUrl && !uploading && (
            <button
              type="button"
              onClick={onClear}
              className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Remove image"
            >
              <X size={14} />
            </button>
          )}
          {uploading && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center text-xs text-gray-600">
              Uploading…
            </div>
          )}
        </div>
        <div className="flex-1 space-y-2">
          {actionButtons}
          <p className="text-xs text-gray-500">
            {uploading ? 'Uploading…' : 'Use your webcam or choose an image file.'}
          </p>
        </div>
      </div>

      {/* Mobile */}
      <div className="sm:hidden space-y-3">
        <div className="relative w-full aspect-[4/3] max-h-52 rounded-xl border-2 border-dashed border-gray-300 overflow-hidden bg-gray-50 flex items-center justify-center">
          {preview}
          {imageUrl && !uploading && (
            <button
              type="button"
              onClick={onClear}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Remove image"
            >
              <X size={16} />
            </button>
          )}
          {uploading && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center text-sm text-gray-600">
              Uploading…
            </div>
          )}
        </div>
        {actionButtons}
      </div>

      <WebcamCapture open={webcamOpen} onOpenChange={setWebcamOpen} onCapture={handleWebcamCapture} />
    </div>
  )
}
