'use client'

import { useRef } from 'react'
import * as Label from '@radix-ui/react-label'
import { Camera, ImagePlus, X } from 'lucide-react'

type Props = {
  imageUrl: string
  uploading: boolean
  onFile: (file: File) => void
  onClear: () => void
}

export function ProductImageField({ imageUrl, uploading, onFile, onClear }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onFile(file)
  }

  const preview = imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt="Product preview" className="w-full h-full object-cover" />
  ) : (
    <Camera size={24} className="text-gray-400" />
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

      {/* Desktop — unchanged layout */}
      <button
        type="button"
        disabled={uploading}
        onClick={() => galleryRef.current?.click()}
        className="hidden sm:flex items-center gap-3 text-left w-full group"
      >
        <div className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50 shrink-0 group-hover:border-blue-400 transition-colors">
          {preview}
        </div>
        <span className="text-sm text-gray-600">
          {uploading ? 'Uploading…' : 'Click to upload an image'}
        </span>
      </button>

      {/* Mobile — large preview + camera / gallery */}
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

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={() => cameraRef.current?.click()}
            className="flex items-center justify-center gap-2 py-3 px-3 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Camera size={18} />
            Take photo
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => galleryRef.current?.click()}
            className="flex items-center justify-center gap-2 py-3 px-3 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <ImagePlus size={18} />
            Gallery
          </button>
        </div>
      </div>
    </div>
  )
}
