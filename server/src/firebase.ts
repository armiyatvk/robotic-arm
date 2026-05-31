import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app'
import { getDatabase, type DataSnapshot } from 'firebase-admin/database'
import type { ArmState } from './types'

if (getApps().length === 0) {
  const serviceAccount = process.env['FIREBASE_SERVICE_ACCOUNT']
  const databaseURL = process.env['FIREBASE_DATABASE_URL']
  if (!databaseURL) throw new Error('FIREBASE_DATABASE_URL is not set')
  initializeApp({
    credential: serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault(),
    databaseURL,
  })
}

const db = getDatabase()
console.log('[Firebase] Connected to:', db.ref('/arm/command').toString())

const servoMap: Record<string, string> = {
  base: 'B',
  shoulder: 'S',
  elbow: 'E',
  gripper: 'G',
}

/**
 * Writes a command string to /arm/command in Firebase.
 * The ESP32's Core 0 polls this path every 250ms and clears it after reading.
 */
export async function writeCommandToFirebase(servo: string, angle: number): Promise<void> {
  const key = servoMap[servo]
  if (!key) throw new Error(`Unknown servo: ${servo}`)
  await db.ref('/arm/command').set(`${key}${angle}`)
  // Wait for ESP32 to poll and execute (polls every 250ms, 300ms gives margin)
  await new Promise(resolve => setTimeout(resolve, 300))
}

/**
 * Listens to /arm/lastSeen — the ESP32 writes a value every 5s.
 * Uses server-side wall-clock time to detect if the arm goes silent.
 * Calls callback({ online: false }) if no update is received for 12s.
 * Returns an unsubscribe function.
 */
export function watchArmHeartbeat(
  callback: (state: Partial<ArmState>) => void
): () => void {
  const lastSeenRef = db.ref('/arm/lastSeen')
  let lastHeartbeat: number | null = null

  const handler = (snapshot: DataSnapshot) => {
    if (snapshot.val() !== null) {
      lastHeartbeat = Date.now()
      callback({ online: true, lastSeen: new Date().toISOString() })
    }
  }

  lastSeenRef.on('value', handler)

  // ESP32 writes every 5s — mark offline if silent for >12s
  const interval = setInterval(() => {
    if (lastHeartbeat === null || Date.now() - lastHeartbeat > 12000) {
      callback({ online: false, lastSeen: null })
    }
  }, 8000)

  return () => {
    lastSeenRef.off('value', handler)
    clearInterval(interval)
  }
}
