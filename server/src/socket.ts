import type { Server, Socket } from 'socket.io'
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    SocketData,
    CommandPayload,
} from './types'
import {
    tryEnqueue,
    dequeueNext,
    releaseQueue,
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
    // Phase 2: replace this with your actual arm communication
    // For now simulates execution time so the queue behavior is testable
    console.log(`Executing: ${command.servo} → ${command.angle}°`)
    await new Promise(resolve => setTimeout(resolve, 500))
}

export function registerSocketHandlers(io: IoServer, socket: IoSocket): void {
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
            socket.data.sessionId = sessionId  // ← store it
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

        const accepted = tryEnqueue(commandWithSocket)

        if (!accepted) {
            socket.emit('error', `Invalid command: ${payload.servo} ${payload.angle}° is out of range`)
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

    socket.on('disconnect', async () => {
        const user = connectedUsers.get(socket.id)
        connectedUsers.delete(socket.id)
        broadcastUsers(io)

        if (user?.userId && socket.data.sessionId) {
            try {
                await endSession(socket.data.sessionId)  // ← use real session ID
            } catch (err) {
                console.error('DB error on disconnect:', err)
            }
        }

        broadcastQueueState(io)
    })
}