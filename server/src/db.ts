import { Pool } from 'pg'
import type { CommandResult } from './types'

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
})

export async function initDb(): Promise<void> {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

    await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      socket_id TEXT NOT NULL,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      disconnected_at TIMESTAMPTZ
    )
  `)

    await pool.query(`
    CREATE TABLE IF NOT EXISTS command_history (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      socket_id TEXT NOT NULL,
      servo TEXT NOT NULL,
      angle INTEGER NOT NULL,
      success BOOLEAN NOT NULL,
      error TEXT,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

    console.log('Database tables initialized')
}

export async function upsertUser(userId: string): Promise<void> {
    await pool.query(
        `INSERT INTO users (id, first_seen, last_seen)
     VALUES ($1, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE
     SET last_seen = NOW()`,
        [userId]
    )
}

export async function startSession(
    userId: string,
    socketId: string
): Promise<number> {
    const result = await pool.query(
        `INSERT INTO sessions (user_id, socket_id, connected_at)
     VALUES ($1, $2, NOW())
     RETURNING id`,
        [userId, socketId]
    )
    return result.rows[0].id as number
}

export async function endSession(sessionId: number): Promise<void> {
    await pool.query(
        `UPDATE sessions SET disconnected_at = NOW() WHERE id = $1`,
        [sessionId]
    )
}

export async function logCommand(result: CommandResult): Promise<void> {
    const { command, success, error, executedAt } = result
    await pool.query(
        `INSERT INTO command_history
       (user_id, socket_id, servo, angle, success, error, executed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [command.userId, command.socketId, command.servo, command.angle, success, error ?? null, executedAt]
    )
}

export async function getRecentCommands(limit = 20): Promise<unknown[]> {
    const result = await pool.query(
        `SELECT * FROM command_history ORDER BY executed_at DESC LIMIT $1`,
        [limit]
    )
    return result.rows
}