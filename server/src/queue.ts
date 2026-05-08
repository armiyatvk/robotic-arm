import type { CommandPayload, QueueState } from './types'

// The single source of truth for arm state
let executing: CommandPayload | null = null
const pending: CommandPayload[] = []
let locked = false

// The same boolean lock pattern from DayBreak's lobby
// Node.js is single-threaded so this is safe without a mutex
export function tryEnqueue(command: CommandPayload): boolean {
    // Validate angle against ESP32 hardware safety constraints
    const limits: Record<string, { min: number; max: number }> = {
        base: { min: 0, max: 180 },
        shoulder: { min: 10, max: 170 },
        elbow: { min: 30, max: 150 },
        gripper: { min: 10, max: 90 },
    }
    /*
    TODO this should go to frontend to map one ltterts to full words for server.
    const idMap: Record<string, string> = {
        B: 'base',
        S: 'shoulder',
        E: 'elbow',
        G: 'gripper'
    }   
    */

    const limit = limits[command.servo]
    if (!limit) return false
    if (command.angle < limit.min || command.angle > limit.max) return false

    pending.push(command)
    return true
}

export function getState(): QueueState {
    return {
        pending: [...pending],
        executing,
        depth: pending.length,
    }
}

export function isLocked(): boolean {
    return locked
}

// Called by socket.ts when it's ready to execute the next command
export function dequeueNext(): CommandPayload | null {
    if (locked) return null
    if (pending.length === 0) return null

    const next = pending.shift()
    if (!next) return null

    locked = true
    executing = next
    return next
}

// Called by socket.ts after the arm confirms execution
export function releaseQueue(): void {
    locked = false
    executing = null
}