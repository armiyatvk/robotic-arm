import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import 'dotenv/config'
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from './types'
import { initDb } from './db'
import { registerSocketHandlers } from './socket'
import { getState } from './queue'
import { watchArmHeartbeat } from './firebase'

const app = express()
const httpServer = createServer(app)

const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: {
        origin: process.env['CLIENT_URL'] ?? 'http://localhost:5173',
        methods: ['GET', 'POST'],
    },
})

app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
    })
})

app.get('/queue', (_req, res) => {
    res.json(getState())
})

io.on('connection', (socket) => {
    registerSocketHandlers(io, socket)
})

async function start(): Promise<void> {
    try {
        await initDb()
        console.log('Database ready')
    } catch (err) {
        console.error('Failed to initialize database:', err)
        console.log('Starting without database — commands will not be persisted')
    }

    // Set up Firebase arm heartbeat once at startup — broadcasts arm_state to all clients
    watchArmHeartbeat((partialState) => {
        io.emit('arm_state', {
            base: 90, shoulder: 90, elbow: 90, gripper: 20,
            online: false, lastSeen: null,
            ...partialState,
        })
    })

    const PORT = process.env['PORT'] ?? 3001
    httpServer.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`)
        console.log(`Health check: http://localhost:${PORT}/health`)
    })
}

start()