import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ref, set, onValue } from 'firebase/database';
import { db } from '../../lib/firebase';
import './ArmController.css';

const JOINTS = [
    { id: 'B', label: 'Base Rotation', min: 0, max: 180, initial: 90 },
    { id: 'S', label: 'Shoulder Lift', min: 10, max: 170, initial: 90 },
    { id: 'E', label: 'Elbow Extension', min: 30, max: 150, initial: 90 },
    { id: 'G', label: 'Gripper Claw', min: 10, max: 90, initial: 20 },
];

function buildInitial() {
    return Object.fromEntries(JOINTS.map(j => [j.id, j.initial]));
}

export default function ArmController() {
    // 'cloud' | 'usb'
    const [mode, setMode] = useState('cloud');
    const [armOnline, setArmOnline] = useState(false); // arm online via lastSeen heartbeat
    const [cloudForced, setCloudForced] = useState(false); // manual override when no heartbeat
    const [usbConnected, setUsbConnected] = useState(false);

    const [isHoming, setIsHoming] = useState(false);
    const [isSending, setIsSending] = useState(false);

    const [draft, setDraft] = useState(buildInitial);
    const [sent, setSent] = useState(buildInitial);

    const pending = JOINTS.filter(j => draft[j.id] !== sent[j.id]);

    const portRef = useRef(null);
    const writerRef = useRef(null);
    // Per-joint throttle: tracks last time a live cmd was sent for each joint
    const throttleRef = useRef({});

    // Ready when: cloud mode with arm online OR manually forced; or USB mode with serial connected
    const ready = mode === 'cloud' ? (armOnline || cloudForced) : usbConnected;

    /* ─── Watch Firebase lastSeen ─────────────────────── */
    useEffect(() => {
        const lastSeenRef = ref(db, 'arm/lastSeen');
        const unsub = onValue(lastSeenRef, snapshot => {
            const ts = snapshot.val();
            const online = ts ? (Date.now() - ts < 10_000) : false;
            setArmOnline(online);
            // Auto-switch to cloud if arm comes online while in USB mode
            // (only if USB isn't already connected)
            if (online && !usbConnected) setMode('cloud');
        });
        return () => unsub();
    }, [usbConnected]);

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
    const writeSerial = async (cmd) => {
        if (!writerRef.current) return;
        await writerRef.current.write(new TextEncoder().encode(cmd + '\n'));
    };

    const pushCloud = async (cmd) => {
        try {
            await set(ref(db, 'arm/command'), cmd);
            console.log('[Cloud] ✓ Sent:', cmd);
        } catch (err) {
            console.error('[Cloud] ✗ Write failed:', err.message);
        }
    };

    const sendCmd = async (cmd) => {
        if (mode === 'usb') return writeSerial(cmd);
        // cloud — also try serial as bonus if connected
        await pushCloud(cmd);
        if (usbConnected) await writeSerial(cmd);
    };

    /* ─── Confirm & send pending joints ─────────────── */
    const handleSendAll = async () => {
        if (!ready || pending.length === 0) return;
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
        if (!ready) return;
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

    const handleSlider = (id, rawValue) => {
        setDraft(prev => ({ ...prev, [id]: Number(rawValue) }));
    };

    // Called once when user releases the slider thumb.
    // Value comes directly from the event (not from draft state) to avoid stale closures.
    const handleRelease = (id, rawValue) => {
        if (!ready) return;
        const value = Number(rawValue);
        setDraft(prev => ({ ...prev, [id]: value }));
        sendCmd(`${id}${value}`);
        setSent(prev => ({ ...prev, [id]: value }));
    };

    const pct = (joint, val) =>
        ((val - joint.min) / (joint.max - joint.min)) * 100;

    /* ─── Mode switcher handler ──────────────────────── */
    const switchMode = (next) => {
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
                        {armOnline && <span className="arm-page__mode-dot" />}
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

                {/* ── Status / connect prompt ── */}
                {!ready && (
                    <div className="arm-page__connect-wrap">
                        {mode === 'cloud' ? (
                            <>
                                <p className="arm-page__connect-hint">
                                    No heartbeat detected from the arm.
                                    <span className="arm-page__connect-sub">
                                        If the arm is on Wi-Fi and listening to Firebase,
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
                <div className={`arm-page__joints ${!ready ? 'arm-page__joints--disabled' : ''}`}>
                    {JOINTS.map(joint => {
                        const val = draft[joint.id];
                        const sentVal = sent[joint.id];
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
                                            disabled={!ready}
                                            onChange={e => handleSlider(joint.id, e.target.value)}
                                            onPointerUp={e => handleRelease(joint.id, e.target.value)}
                                            onKeyUp={e => handleRelease(joint.id, e.target.value)}
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
                {ready && (
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
