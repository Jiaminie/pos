const REAR_LABEL = /\b(rear|back|environment|world)\b/i
const FRONT_LABEL = /\b(front|user|face|facetime|selfie)\b/i

export function isRearCameraLabel(label: string) {
  return REAR_LABEL.test(label)
}

export function isFrontCameraLabel(label: string) {
  return FRONT_LABEL.test(label)
}

export async function listVideoInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'videoinput')
}

/** Labels are blank until the user has granted camera permission once. */
export async function primeCameraPermission() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  stream.getTracks().forEach((track) => track.stop())
}

export function pickRearCameraId(cameras: MediaDeviceInfo[]) {
  const labeled = cameras.filter((c) => c.label)
  const rear = labeled.find((c) => isRearCameraLabel(c.label))
  if (rear) return rear.deviceId

  const front = labeled.find((c) => isFrontCameraLabel(c.label))
  if (front && cameras.length > 1) {
    return cameras.find((c) => c.deviceId !== front.deviceId)?.deviceId
  }

  return undefined
}

export function pickFrontCameraId(cameras: MediaDeviceInfo[]) {
  const labeled = cameras.filter((c) => c.label)
  const front = labeled.find((c) => isFrontCameraLabel(c.label))
  if (front) return front.deviceId

  const rear = labeled.find((c) => isRearCameraLabel(c.label))
  if (rear && cameras.length > 1) {
    return cameras.find((c) => c.deviceId !== rear.deviceId)?.deviceId
  }

  return cameras[0]?.deviceId
}

export async function openCameraStream(deviceId?: string) {
  const video: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } }
    : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }

  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false })
  } catch {
    return navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    })
  }
}

export async function openPreferredRearCamera() {
  await primeCameraPermission()
  const cameras = await listVideoInputs()
  const rearId = pickRearCameraId(cameras)
  const stream = await openCameraStream(rearId)
  const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? rearId
  return { stream, cameras, activeDeviceId: activeId }
}
