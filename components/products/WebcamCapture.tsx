'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Camera, RefreshCw, X } from 'lucide-react'
import { isRearCameraLabel, openCameraStream, openPreferredRearCamera } from '@/lib/camera'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCapture: (file: File) => void
}

export function WebcamCapture({ open, onOpenChange, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const camerasRef = useRef<MediaDeviceInfo[]>([])
  const activeDeviceIdRef = useRef<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [cameraCount, setCameraCount] = useState(0)
  const [usingRear, setUsingRear] = useState(true)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const attachStream = useCallback(
    async (stream: MediaStream) => {
      stopStream()
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      const deviceId = track?.getSettings().deviceId
      activeDeviceIdRef.current = deviceId
      const camera = camerasRef.current.find((c) => c.deviceId === deviceId)
      const label = camera?.label ?? track?.label ?? ''
      setUsingRear(isRearCameraLabel(label))

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setReady(true)
      }
    },
    [stopStream],
  )

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        stopStream()
        setError(null)
        setReady(false)
        setCameraCount(0)
        setUsingRear(true)
        camerasRef.current = []
        activeDeviceIdRef.current = undefined
      }
      onOpenChange(next)
    },
    [onOpenChange, stopStream],
  )

  useEffect(() => {
    if (!open) return

    let cancelled = false

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera is not supported in this browser.')
        return
      }

      try {
        const { stream, cameras, activeDeviceId } = await openPreferredRearCamera()
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        camerasRef.current = cameras
        setCameraCount(cameras.length)
        activeDeviceIdRef.current = activeDeviceId
        await attachStream(stream)
      } catch {
        setError('Could not access the camera. Check permissions and try again.')
      }
    }

    startCamera()
    return () => {
      cancelled = true
      stopStream()
    }
  }, [attachStream, open, stopStream])

  async function switchCamera() {
    const cameras = camerasRef.current
    if (cameras.length < 2) return

    setReady(false)
    stopStream()

    const currentId = activeDeviceIdRef.current
    const next = cameras.find((c) => c.deviceId !== currentId) ?? cameras[0]
    try {
      const stream = await openCameraStream(next.deviceId)
      await attachStream(stream)
      setUsingRear(isRearCameraLabel(next.label))
    } catch {
      setError('Could not switch camera.')
    }
  }

  function capture() {
    const video = videoRef.current
    if (!video || !ready) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `product-${Date.now()}.jpg`, { type: 'image/jpeg' })
        onCapture(file)
        handleOpenChange(false)
      },
      'image/jpeg',
      0.92,
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]" />
        <Dialog.Content className="fixed z-[70] bg-white shadow-2xl focus:outline-none inset-x-4 top-1/2 -translate-y-1/2 rounded-xl p-5 w-auto max-w-lg mx-auto sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">Take product photo</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="text-gray-500 hover:text-gray-700 rounded-md p-1" aria-label="Close">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-gray-900">
            {error ? (
              <div className="absolute inset-0 flex items-center justify-center p-4 text-sm text-center text-gray-300">
                {error}
              </div>
            ) : (
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            )}
            {!ready && !error && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-300">
                Starting camera…
              </div>
            )}
          </div>

          <p className="mt-2 text-xs text-gray-500 text-center">
            {usingRear ? 'Using rear camera — point the back of the device at the product.' : 'Using front camera.'}
          </p>

          <div className="mt-4 flex gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex-1 py-2.5 px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </Dialog.Close>
            {cameraCount > 1 && (
              <button
                type="button"
                disabled={!ready}
                onClick={switchCamera}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                title="Switch camera"
              >
                <RefreshCw size={16} />
                Switch
              </button>
            )}
            <button
              type="button"
              disabled={!ready}
              onClick={capture}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Camera size={16} />
              Capture
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
