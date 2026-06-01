import type { Server, Socket } from 'socket.io'
import { writeCommandToFirebase, watchArmHeartbeat } from './firebase'
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    SocketData,
    CommandPayload,
    ArmState,
} from './types'
import {
    tryEnqueue,
    dequeueNext,
    releaseQueue,
    joinQueue,
    leaveQueue,
    startTurn,
    handleUserDisconnect,
    setOnStateChange,
    setOnTurnExpired,
    getState,
    isLocked,
} from './queue'
import {
    upsertUser,
    startSession,
    endSession,
    logCommand,
} from './db'

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

const connectedUsers = new Map<string, { userId: string | null; connectedAt: string }>()

// Module-level — persists across socket connections
let heartbeatUnsubscribe: (() => void) | null = null
let currentArmState: ArmState = {
    base: 90,
    shoulder: 90,
    elbow: 90,
    gripper: 20,
    online: false,
    lastSeen: null,
}

function broadcastUsers(io: IoServer): void {
    const users = Array.from(connectedUsers.entries()).map(([socketId, data]) => ({
        socketId,
        userId: data.userId,
        connectedAt: data.connectedAt,
    }))
    io.emit('users_update', users)
}

function broadcastQueueState(io: IoServer): void {
    io.emit('queue_update', getState())
}

async function processNextCommand(io: IoServer): Promise<void> {
    const command = dequeueNext()
    if (!command) return

    broadcastQueueState(io)

    try {
        await sendToArm(command)

        const result = {
            success: true,
            command,
            executedAt: new Date().toISOString(),
        }

        await logCommand(result)
        io.to(command.socketId).emit('command_result', result)

    } catch (err) {
        const result = {
            success: false,
            command,
            executedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : 'Unknown error',
        }

        await logCommand(result)
        io.to(command.socketId).emit('command_result', result)

    } finally {
        releaseQueue()
        broadcastQueueState(io)
        await processNextCommand(io)
    }
}

async function sendToArm(command: CommandPayload): Promise<void> {
    console.log(`[ARM] Writing to Firebase: ${command.servo} → ${command.angle}°`)
    await writeCommandToFirebase(command.servo, command.angle)
    console.log(`[ARM] Firebase write complete`)
}

export function registerSocketHandlers(io: IoServer, socket: IoSocket): void {

    // Start heartbeat watcher once — when first client connects
    if (!heartbeatUnsubscribe) {
        heartbeatUnsubscribe = watchArmHeartbeat((partialState) => {
            currentArmState = { ...currentArmState, ...partialState }
            io.emit('arm_state', currentArmState)
        })
        setOnStateChange(() => io.emit('queue_update', getState()))
        setOnTurnExpired(async () => {
            // Reset arm to home position between turns (gripper → elbow → shoulder → base)
            for (const [servo, angle] of [['gripper', 20], ['elbow', 90], ['shoulder', 90], ['base', 90]] as const) {
                await writeCommandToFirebase(servo, angle)
            }
        })
    }

    // Send current arm state immediately to newly connected client
    socket.emit('arm_state', currentArmState)

    const connectedAt = new Date().toISOString()
    connectedUsers.set(socket.id, { userId: null, connectedAt })
    broadcastUsers(io)
    broadcastQueueState(io)

    socket.on('join', async (userId: string) => {
        socket.data.userId = userId
        socket.data.connectedAt = connectedAt

        const existing = connectedUsers.get(socket.id)
        if (existing) {
            connectedUsers.set(socket.id, { ...existing, userId })
        }

        try {
            await upsertUser(userId)
            const sessionId = await startSession(userId, socket.id)
            socket.data.sessionId = sessionId
        } catch (err) {
            console.error('DB error on join:', err)
        }

        broadcastUsers(io)
    })

    socket.on('command', async (payload: CommandPayload) => {
        const commandWithSocket: CommandPayload = {
            ...payload,
            socketId: socket.id,
            userId: socket.data.userId ?? socket.id,
        }

        const error = tryEnqueue(commandWithSocket)

        if (error !== null) {
            socket.emit('error', error)
            return
        }

        broadcastQueueState(io)

        if (!isLocked()) {
            await processNextCommand(io)
        }
    })

    socket.on('leave', () => {
        connectedUsers.delete(socket.id)
        broadcastUsers(io)
    })

    socket.on('join_queue', () => {
        joinQueue(socket.data.userId ?? socket.id)
    })

    socket.on('leave_queue', async () => {
        await leaveQueue(socket.data.userId ?? socket.id)
    })

    socket.on('start_turn', () => {
        const ok = startTurn(socket.data.userId ?? socket.id)
        if (!ok) socket.emit('error', 'Not your turn to start')
    })

    socket.on('disconnect', async () => {
        const user = connectedUsers.get(socket.id)
        connectedUsers.delete(socket.id)
        broadcastUsers(io)

        await handleUserDisconnect(socket.data.userId ?? socket.id)

        if (user?.userId && socket.data.sessionId) {
            try {
                await endSession(socket.data.sessionId)
            } catch (err) {
                console.error('DB error on disconnect:', err)
            }
        }
    })
}