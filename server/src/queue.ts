import type { CommandPayload, QueueState, PendingStart } from './types'

const CONTROLLER_DURATION = 60_000  // 60 s active turn
const START_WINDOW       = 10_000  // 10 s to click Start

// ── Arm-movement command queue ────────────────────────────────────────────────
let executing: CommandPayload | null = null
const pending: CommandPayload[] = []
let locked = false

// ── Turn management ───────────────────────────────────────────────────────────
let activeController: string | null = null
let controllerExpiresAt: number | null = null
let controllerTimer: ReturnType<typeof setTimeout> | null = null

let waitQueue: string[] = []
let pendingStartState: PendingStart | null = null
let pendingStartTimer: ReturnType<typeof setTimeout> | null = null
let isCalibrating = false

// ── Callbacks wired up by socket.ts ──────────────────────────────────────────
let onStateChange: (() => void) | null = null
let onTurnExpired: (() => Promise<void>) | null = null

export function setOnStateChange(cb: () => void): void {
    onStateChange = cb
}

export function setOnTurnExpired(cb: () => Promise<void>): void {
    onTurnExpired = cb
}

function broadcast(): void {
    onStateChange?.()
}

// Offer the next person in waitQueue a 10 s window to click Start.
// If the queue is empty, just broadcast the idle state.
function offerTurn(): void {
    if (waitQueue.length === 0) {
        broadcast()
        return
    }
    const userId = waitQueue.shift()!   // remove from front of queue
    pendingStartState = { userId, expiresAt: Date.now() + START_WINDOW }
    pendingStartTimer = setTimeout(() => {
        pendingStartState = null
        pendingStartTimer = null
        offerTurn()   // skip this user; no calibration needed
    }, START_WINDOW)
    broadcast()
}

// Called when an active controller's time is up (or they disconnect).
// Calibrates the arm, then offers the turn to the next person.
async function endTurn(): Promise<void> {
    if (controllerTimer) clearTimeout(controllerTimer)
    controllerTimer = null
    activeController = null
    controllerExpiresAt = null
    pending.length = 0   // discard any queued movement commands

    isCalibrating = true
    broadcast()

    try {
        if (onTurnExpired) await onTurnExpired()
    } finally {
        isCalibrating = false
        offerTurn()
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function joinQueue(userId: string): void {
    if (
        waitQueue.includes(userId) ||
        activeController === userId ||
        pendingStartState?.userId === userId
    ) return

    waitQueue.push(userId)

    // If nobody is controlling and nothing is pending, offer immediately
    if (activeController === null && pendingStartState === null && !isCalibrating) {
        offerTurn()   // shifts from waitQueue and broadcasts
        return
    }

    broadcast()
}

export async function leaveQueue(userId: string): Promise<void> {
    // Remove from the waiting list if present
    const idx = waitQueue.indexOf(userId)
    if (idx !== -1) waitQueue.splice(idx, 1)

    if (pendingStartState?.userId === userId) {
        if (pendingStartTimer) clearTimeout(pendingStartTimer)
        pendingStartState = null
        pendingStartTimer = null
        offerTurn()   // offer to next person
        return
    }

    if (activeController === userId) {
        await endTurn()   // calibrate then offer next
        return
    }

    broadcast()
}

// Returns true if the offer was accepted, false if the user wasn't next.
export function startTurn(userId: string): boolean {
    if (pendingStartState?.userId !== userId) return false

    if (pendingStartTimer) clearTimeout(pendingStartTimer)
    pendingStartTimer = null
    pendingStartState = null

    activeController = userId
    controllerExpiresAt = Date.now() + CONTROLLER_DURATION
    controllerTimer = setTimeout(() => { void endTurn() }, CONTROLLER_DURATION)

    broadcast()
    return true
}

// Returns null on success, or an error string to emit back to the client.
export function tryEnqueue(command: CommandPayload): string | null {
    const limits: Record<string, { min: number; max: number }> = {
        base:     { min: 0,  max: 180 },
        shoulder: { min: 10, max: 170 },
        elbow:    { min: 30, max: 150 },
        gripper:  { min: 10, max: 90  },
    }

    const limit = limits[command.servo]
    if (!limit) return `Unknown servo: ${command.servo}`
    if (command.angle < limit.min || command.angle > limit.max) {
        return `${command.servo} ${command.angle}° is out of range`
    }

    if (activeController !== command.userId) return 'Not your turn'

    pending.push(command)
    return null
}

export function getState(): QueueState {
    return {
        pending: [...pending],
        executing,
        depth: pending.length,
        controller: activeController,
        controllerExpiresAt,
        waitQueue: [...waitQueue],
        pendingStart: pendingStartState ? { ...pendingStartState } : null,
        calibrating: isCalibrating,
    }
}

export function isLocked(): boolean { return locked }

export function dequeueNext(): CommandPayload | null {
    if (locked || pending.length === 0) return null
    const next = pending.shift()!
    locked = true
    executing = next
    return next
}

export function releaseQueue(): void {
    locked = false
    executing = null
}

// Called on socket disconnect — same cleanup as leaveQueue.
export async function handleUserDisconnect(userId: string): Promise<void> {
    await leaveQueue(userId)
}
