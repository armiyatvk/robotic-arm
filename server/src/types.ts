// Servo identifiers matching ESP32 pin mapping
export type ServoId = 'base' | 'shoulder' | 'elbow' | 'gripper'

// A single command from a user to move one servo
export interface CommandPayload {
    servo: ServoId
    angle: number
    userId: string
    socketId: string
}

// What the queue looks like at any moment
export interface QueueState {
    pending: CommandPayload[]
    executing: CommandPayload | null
    depth: number
}

// Current physical state of the arm
export interface ArmState {
    base: number
    shoulder: number
    elbow: number
    gripper: number
    online: boolean
    lastSeen: string | null
}

// Result after a command executes
export interface CommandResult {
    success: boolean
    command: CommandPayload
    executedAt: string
    error?: string
}

// A connected user
export interface ConnectedUser {
    socketId: string
    userId: string | null
    connectedAt: string
}

// Socket.IO event maps — typed events between client and server
export interface ClientToServerEvents {
    command: (payload: CommandPayload) => void
    join: (userId: string) => void
    leave: () => void
}

export interface ServerToClientEvents {
    queue_update: (state: QueueState) => void
    arm_state: (state: ArmState) => void
    command_result: (result: CommandResult) => void
    users_update: (users: ConnectedUser[]) => void
    error: (message: string) => void
}

// Socket data stored per connection
export interface SocketData {
    userId: string | null
    connectedAt: string
}

export interface SocketData {
    userId: string | null
    connectedAt: string
    sessionId: number | null  // ← add this
}