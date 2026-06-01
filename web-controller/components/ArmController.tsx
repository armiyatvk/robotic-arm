import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import type {
    ServoId,
    CommandPayload,
    QueueState,
    ArmState,
    CommandResult,
    ConnectedUser,
    ServerToClientEvents,
    ClientToServerEvents,
} from '../../server/src/types';
import './ArmController.css';

const JOINTS = [
    { id: 'B', label: 'Base Rotation', min: 0, max: 180, initial: 90 },
    { id: 'S', label: 'Shoulder Lift', min: 10, max: 170, initial: 90 },
    { id: 'E', label: 'Elbow Extension', min: 30, max: 150, initial: 90 },
    { id: 'G', label: 'Gripper Claw', min: 10, max: 90, initial: 20 },
] as const;

// Maps single-letter hardware IDs to full servo names expected by the server
const SERVO_MAP: Record<string, ServoId> = {
    B: 'base',
    S: 'shoulder',
    E: 'elbow',
    G: 'gripper',
};

const SOCKET_URL =
    (import.meta.env['VITE_SOCKET_URL'] as string | undefined) ?? 'http://localhost:3001';

const DEFAULT_ARM_STATE: ArmState = {
    base: 90, shoulder: 90, elbow: 90, gripper: 20,
    online: false, lastSeen: null,
};

function buildInitial(): Record<string, number> {
    return Object.fromEntries(JOINTS.map(j => [j.id, j.initial]));
}

export default function ArmController() {
    // 'cloud' | 'usb'
    const [mode, setMode] = useState<'cloud' | 'usb'>('cloud');
    const [cloudForced, setCloudForced] = useState(false);
    const [usbConnected, setUsbConnected] = useState(false);

    const [isHoming, setIsHoming] = useState(false);
    const [isSending, setIsSending] = useState(false);

    const [draft, setDraft] = useState<Record<string, number>>(buildInitial);
    const [sent, setSent] = useState<Record<string, number>>(buildInitial);

    // Socket.IO state
    const [userId] = useState<string>(() => crypto.randomUUID());
    const [armState, setArmState] = useState<ArmState>(DEFAULT_ARM_STATE);
    const [queueState, setQueueState] = useState<QueueState | null>(null);
    const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
    const [lastCommandResult, setLastCommandResult] = useState<CommandResult | null>(null);
    const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
    const [startSecondsLeft, setStartSecondsLeft] = useState<number | null>(null);

    const pending = JOINTS.filter(j => draft[j.id] !== sent[j.id]);

    const portRef = useRef<SerialPort | null>(null);
    const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
    // Per-joint throttle: tracks last time a live cmd was sent for each joint
    const throttleRef = useRef<Record<string, number>>({});

    const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
    // Stale-closure guard — avoids re-creating the socket when usbConnected changes
    const usbConnectedRef = useRef(usbConnected);

    const ready = mode === 'cloud' ? (armState.online || cloudForced) : usbConnected;
    const isController  = queueState?.controller === userId;
    const isOfferedTurn = queueState?.pendingStart?.userId === userId;
    const isInQueue     = queueState?.waitQueue.includes(userId) ?? false;
    const queuePosition = (queueState?.waitQueue.indexOf(userId) ?? -1) + 1;
    // USB bypasses the queue; cloud requires holding the active controller slot
    const canControl = mode === 'usb' ? ready : (isController && ready);

    /* ─── Keep usbConnected ref in sync ──────────────── */
    useEffect(() => {
        usbConnectedRef.current = usbConnected;
    }, [usbConnected]);

    /* ─── Socket.IO lifecycle ─────────────────────────── */
    useEffect(() => {
        const socket = io<ServerToClientEvents, ClientToServerEvents>(SOCKET_URL);
        socketRef.current = socket;

        socket.on('connect', () => socket.emit('join', userId));

        socket.on('arm_state', (s: ArmState) => {
            setArmState(s);
            if (s.online && !usbConnectedRef.current) setMode('cloud');
        });

        socket.on('queue_update', (s: QueueState) => setQueueState(s));

        socket.on('users_update', (u: ConnectedUser[]) => setConnectedUsers(u));

        socket.on('command_result', (r: CommandResult) => {
            setLastCommandResult(r);
            setTimeout(() => setLastCommandResult(null), 3000);
        });

        socket.on('error', (msg: string) => console.error('[Socket]', msg));

        return () => {
            socket.emit('leave');
            socket.disconnect();
        };
    }, [userId]); // userId is stable — runs once

    /* ─── Controller countdown ───────────────────────── */
    useEffect(() => {
        const expiresAt = queueState?.controllerExpiresAt ?? null;
        if (!expiresAt) { setSecondsLeft(null); return; }
        const tick = () => setSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [queueState?.controllerExpiresAt]);

    /* ─── Start-window countdown (10 s to click Start) ── */
    useEffect(() => {
        const expiresAt = queueState?.pendingStart?.expiresAt ?? null;
        if (!expiresAt) { setStartSecondsLeft(null); return; }
        const tick = () => setStartSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [queueState?.pendingStart?.expiresAt]);

    /* ─── USB Serial ─────────────────────────────────── */
    const connectSerial = async () => {
        try {
            if (!navigator.serial) {
                alert('Web Serial API not supported — use Chrome or Edge.');
                return;
            }
            const port = await navigator.serial.requestPort();
            await port.open({ baudRate: 115200 });
            portRef.current = port;
            writerRef.current = port.writable.getWriter();
            setUsbConnected(true);
            setMode('usb');
        } catch (err) {
            console.error('USB connection failed:', err);
        }
    };

    /* ─── Send helpers ───────────────────────────────── */
    const writeSerial = async (cmd: string) => {
        if (!writerRef.current) return;
        await writerRef.current.write(new TextEncoder().encode(cmd + '\n'));
    };

    const pushCloud = (cmd: string) => {
        if (cmd === 'R') return; // hardware reset — serial only
        const servo = SERVO_MAP[cmd[0] ?? ''];
        const angle = parseInt(cmd.slice(1), 10);
        const sock = socketRef.current;
        if (!servo || !sock || !sock.connected) return;
        sock.emit('command', { servo, angle, userId, socketId: sock.id ?? '' });
    };

    const sendCmd = async (cmd: string) => {
        if (mode === 'usb') return writeSerial(cmd);
        // cloud — also try serial as bonus if connected
        pushCloud(cmd);
        if (usbConnected) await writeSerial(cmd);
    };

    /* ─── Confirm & send pending joints ─────────────── */
    const handleSendAll = async () => {
        if (!canControl || pending.length === 0) return;
        setIsSending(true);
        for (const j of pending) {
            await sendCmd(`${j.id}${draft[j.id]}`);
            await new Promise(r => setTimeout(r, 60));
        }
        setSent({ ...draft });
        setIsSending(false);
    };

    /* ─── Calibrate ──────────────────────────────────── */
    const handleCalibrate = async () => {
        if (!canControl) return;
        setIsHoming(true);
        await sendCmd('R');
        for (const j of JOINTS) {
            await sendCmd(`${j.id}${j.initial}`);
            await new Promise(r => setTimeout(r, 60));
        }
        const initial = buildInitial();
        setDraft(initial);
        setSent(initial);
        setIsHoming(false);
    };

    const handleQueueUp    = () => { socketRef.current?.emit('join_queue') }
    const handleLeaveQueue = () => { socketRef.current?.emit('leave_queue') }
    const handleStartTurn  = () => { socketRef.current?.emit('start_turn') }

    const handleSlider = (id: string, rawValue: string) => {
        setDraft(prev => ({ ...prev, [id]: Number(rawValue) }));
    };

    // Called once when user releases the slider thumb.
    // Value comes directly from the event (not from draft state) to avoid stale closures.
    const handleRelease = (id: string, rawValue: string) => {
        if (!canControl) return;
        const value = Number(rawValue);
        setDraft(prev => ({ ...prev, [id]: value }));
        sendCmd(`${id}${value}`);
        setSent(prev => ({ ...prev, [id]: value }));
    };

    const pct = (joint: typeof JOINTS[number], val: number) =>
        ((val - joint.min) / (joint.max - joint.min)) * 100;

    /* ─── Mode switcher handler ──────────────────────── */
    const switchMode = (next: 'cloud' | 'usb') => {
        if (next === 'usb' && !usbConnected) {
            connectSerial();
        } else {
            setMode(next);
        }
    };

    return (
        <section className="arm-page">
            <Link to="/projects/robotic-arm" className="arm-page__back">
                <i className="ri-arrow-left-line" /> Back to Project
            </Link>

            <div className="arm-page__inner">

                {/* ── Header ── */}
                <div className="arm-page__head">
                    <div className="arm-page__brand">
                        <span className="arm-page__brand-title">Arm Controller</span>
                        <span className="arm-page__brand-sub">
                            {ready
                                ? mode === 'cloud' ? 'Connected via Wi-Fi' : 'Connected via USB'
                                : 'Not connected'}
                        </span>
                    </div>

                    {/* Live arm status dot */}
                    <div className={`arm-page__led ${ready ? 'arm-page__led--on' : 'arm-page__led--off'}`}>
                        <span className="arm-page__led-dot" />
                        <span className="arm-page__led-label">
                            {ready ? 'Online' : 'Offline'}
                        </span>
                    </div>
                </div>

                {/* ── Mode switcher ── */}
                <div className="arm-page__mode-row">
                    <button
                        className={`arm-page__mode-btn ${mode === 'cloud' ? 'arm-page__mode-btn--active' : ''}`}
                        onClick={() => switchMode('cloud')}
                    >
                        <i className="ri-wifi-line" />
                        Wi-Fi
                        {armState.online && <span className="arm-page__mode-dot" />}
                    </button>
                    <button
                        className={`arm-page__mode-btn ${mode === 'usb' ? 'arm-page__mode-btn--active' : ''}`}
                        onClick={() => switchMode('usb')}
                    >
                        <i className="ri-usb-line" />
                        USB
                        {usbConnected && <span className="arm-page__mode-dot" />}
                    </button>
                </div>

                {/* ── Status bar ── */}
                <div className="arm-page__status-bar">
                    <span className="arm-page__status-chip">
                        {connectedUsers.length} online
                    </span>
                    {(queueState?.waitQueue.length ?? 0) > 0 && (
                        <span className="arm-page__status-chip arm-page__status-chip--busy">
                            {queueState!.waitQueue.length} waiting
                        </span>
                    )}
                    {isController && secondsLeft !== null && (
                        <span className="arm-page__status-chip arm-page__status-chip--executing">
                            Your turn: {secondsLeft}s
                        </span>
                    )}
                    {!isController && queueState?.controller && secondsLeft !== null && (
                        <span className="arm-page__status-chip arm-page__status-chip--busy">
                            Arm in use: {secondsLeft}s
                        </span>
                    )}
                    {queueState?.calibrating && (
                        <span className="arm-page__status-chip arm-page__status-chip--busy">
                            Arm resetting…
                        </span>
                    )}
                    {isOfferedTurn && startSecondsLeft !== null && (
                        <span className="arm-page__status-chip arm-page__status-chip--start">
                            Click Start! {startSecondsLeft}s
                        </span>
                    )}
                    {isInQueue && !isOfferedTurn && (
                        <span className="arm-page__status-chip">
                            #{queuePosition} in line
                        </span>
                    )}
                </div>

                {/* ── Connected users list ── */}
                <details className="arm-page__users">
                    <summary>
                        {connectedUsers.length} connected user{connectedUsers.length !== 1 ? 's' : ''}
                    </summary>
                    <ul className="arm-page__users-list">
                        {connectedUsers.map(u => (
                            <li key={u.socketId} className="arm-page__users-item">
                                {u.userId ?? u.socketId.slice(0, 8)}
                            </li>
                        ))}
                    </ul>
                </details>

                {/* ── Command result toast (auto-dismisses after 3 s) ── */}
                {lastCommandResult && (
                    <div className={`arm-page__result ${lastCommandResult.success ? 'arm-page__result--ok' : 'arm-page__result--err'}`}>
                        {lastCommandResult.success
                            ? `✓ ${lastCommandResult.command.servo} → ${lastCommandResult.command.angle}°`
                            : `✗ ${lastCommandResult.error ?? 'Command failed'}`}
                    </div>
                )}

                {/* ── Queue UI (cloud mode only) ── */}
                {mode === 'cloud' && ready && !isController && !isOfferedTurn && !isInQueue && (
                    <div className="arm-page__queue-prompt">
                        <p className="arm-page__connect-hint">
                            {queueState?.controller
                                ? <>Someone is using the arm.
                                    <span className="arm-page__connect-sub">
                                        Queue up and you'll be notified when it's your turn.
                                    </span></>
                                : <>The arm is free.
                                    <span className="arm-page__connect-sub">
                                        Queue up to take control for 60 seconds.
                                    </span></>
                            }
                        </p>
                        <button className="arm-page__connect-btn" onClick={handleQueueUp}>
                            <i className="ri-time-line" /> Queue Up
                        </button>
                    </div>
                )}

                {mode === 'cloud' && isInQueue && !isOfferedTurn && (
                    <div className="arm-page__queue-prompt">
                        <p className="arm-page__connect-hint">
                            You're #{queuePosition} in line.
                            <span className="arm-page__connect-sub">
                                {queueState?.controller
                                    ? `Current user has ${secondsLeft ?? '…'}s remaining.`
                                    : queueState?.calibrating
                                        ? 'Arm is resetting, almost your turn…'
                                        : 'Waiting…'}
                            </span>
                        </p>
                        <button
                            className="arm-page__connect-btn arm-page__connect-btn--secondary"
                            onClick={handleLeaveQueue}
                        >
                            Leave Queue
                        </button>
                    </div>
                )}

                {mode === 'cloud' && isOfferedTurn && (
                    <div className="arm-page__start-banner">
                        <p className="arm-page__start-title">It's your turn!</p>
                        <p className="arm-page__start-sub">
                            Click Start to take control for 60 seconds.
                        </p>
                        <button className="arm-page__start-btn" onClick={handleStartTurn}>
                            Start ({startSecondsLeft ?? 10}s)
                        </button>
                    </div>
                )}

                {/* ── Status / connect prompt ── */}
                {!ready && (
                    <div className="arm-page__connect-wrap">
                        {mode === 'cloud' ? (
                            <>
                                <p className="arm-page__connect-hint">
                                    No heartbeat detected from the arm.
                                    <span className="arm-page__connect-sub">
                                        If the arm is on Wi-Fi and listening,
                                        click <strong>Connect to Cloud</strong> to send commands anyway.
                                    </span>
                                </p>
                                <div className="arm-page__connect-pair">
                                    <button
                                        className="arm-page__connect-btn"
                                        onClick={() => setCloudForced(true)}
                                    >
                                        <i className="ri-wifi-line" /> Connect to Cloud
                                    </button>
                                    <button
                                        className="arm-page__connect-btn arm-page__connect-btn--secondary"
                                        onClick={() => switchMode('usb')}
                                    >
                                        <i className="ri-usb-line" /> Use USB instead
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="arm-page__connect-hint">
                                    Plug the arm in via <strong>USB-C</strong>, then initialize.
                                    <span className="arm-page__connect-sub">
                                        Requires Chrome or Edge (Web Serial API).
                                    </span>
                                </p>
                                <button className="arm-page__connect-btn" onClick={connectSerial}>
                                    <i className="ri-plug-line" /> Initialize USB Link
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* ── Sliders ── */}
                <div className={`arm-page__joints ${!canControl ? 'arm-page__joints--disabled' : ''}`}>
                    {JOINTS.map(joint => {
                        const val = draft[joint.id] ?? joint.initial;
                        const sentVal = sent[joint.id] ?? joint.initial;
                        const isDirty = val !== sentVal;
                        const fill = pct(joint, val);

                        return (
                            <div
                                key={joint.id}
                                className={`arm-joint ${isDirty ? 'arm-joint--dirty' : ''}`}
                            >
                                <div className="arm-joint__meta">
                                    <div className="arm-joint__info">
                                        <span className="arm-joint__id">{joint.id}</span>
                                        <span className="arm-joint__label">{joint.label}</span>
                                    </div>
                                    <div className="arm-joint__vals">
                                        {isDirty && (
                                            <span className="arm-joint__sent-val">{sentVal}°</span>
                                        )}
                                        <span className="arm-joint__val">
                                            {val}<small>°</small>
                                        </span>
                                    </div>
                                </div>

                                <div className="arm-joint__track-wrap">
                                    <span className="arm-joint__tick">{joint.min}°</span>
                                    <div className="arm-joint__track">
                                        <div className="arm-joint__fill" style={{ width: `${fill}%` }} />
                                        <input
                                            type="range"
                                            min={joint.min}
                                            max={joint.max}
                                            value={val}
                                            disabled={!canControl}
                                            onChange={e => handleSlider(joint.id, e.target.value)}
                                            onPointerUp={e => handleRelease(joint.id, (e.target as HTMLInputElement).value)}
                                            onKeyUp={e => handleRelease(joint.id, (e.target as HTMLInputElement).value)}
                                            className="arm-joint__slider"
                                        />
                                    </div>
                                    <span className="arm-joint__tick arm-joint__tick--right">{joint.max}°</span>
                                </div>

                                {isDirty && (
                                    <div className="arm-joint__pending-tag">
                                        {sentVal}° → {val}°
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* ── Footer ── */}
                {canControl && (
                    <div className="arm-page__footer">
                        {pending.length > 0 ? (
                            <div className="arm-page__pending">
                                <span className="arm-page__pending-count">
                                    {pending.length} joint{pending.length > 1 ? 's' : ''} staged
                                </span>
                                <div className="arm-page__pending-list">
                                    {pending.map(j => (
                                        <span key={j.id} className="arm-page__pending-chip">
                                            {j.label}: {sent[j.id]}° → {draft[j.id]}°
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="arm-page__all-sent">
                                <i className="ri-checkbox-circle-line" /> All joints synced
                            </p>
                        )}

                        <div className="arm-page__action-row">
                            <button
                                className={`arm-page__send-btn
                                    ${isSending ? 'arm-page__send-btn--busy' : ''}
                                    ${pending.length === 0 ? 'arm-page__send-btn--idle' : ''}`}
                                onClick={handleSendAll}
                                disabled={isSending || pending.length === 0}
                            >
                                {isSending ? 'Transmitting...' : `Send${pending.length > 0 ? ` (${pending.length})` : ''}`}
                            </button>

                            <button
                                className={`arm-page__calibrate-btn ${isHoming ? 'arm-page__calibrate-btn--busy' : ''}`}
                                onClick={handleCalibrate}
                                disabled={isHoming}
                            >
                                <i className="ri-focus-3-line" />
                                {isHoming ? 'Calibrating...' : 'Calibrate'}
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </section>
    );
}
