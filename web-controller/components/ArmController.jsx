"use client";

import React, { useState, useRef } from 'react';

//URL/arm to use arm controller

// Joint configurations with your specific P1S physical limits
const JOINTS = [
    { id: 'B', label: "Base Rotation", min: 0, max: 180, initial: 90 },
    { id: 'S', label: "Shoulder Lift", min: 10, max: 170, initial: 90 },
    { id: 'E', label: "Elbow Extension", min: 30, max: 150, initial: 90 },
    { id: 'G', label: "Gripper Claw", min: 10, max: 90, initial: 20 },
];

const ArmController = () => {
    const [connected, setConnected] = useState(false);
    const [isHoming, setIsHoming] = useState(false);

    const portRef = useRef(null);
    const writerRef = useRef(null);

    // 1. Connect to the ESP32 via USB-C
    const connectSerial = async () => {
        try {
            if (!navigator.serial) {
                alert("Web Serial API not supported. Use Chrome or Edge on your Mac.");
                return;
            }

            const port = await navigator.serial.requestPort();
            await port.open({ baudRate: 115200 }); // Matches ESP32 Serial.begin

            portRef.current = port;
            writerRef.current = port.writable.getWriter();
            setConnected(true);
            console.log("0xhardcoded link established.");
        } catch (err) {
            console.error("Connection failed:", err);
        }
    };

    // 2. Send Command to Hardware
    const sendCommand = async (command) => {
        if (writerRef.current) {
            const encoder = new TextEncoder();
            await writerRef.current.write(encoder.encode(command + "\n"));
        }
    };

    const handleValueChange = (joint, value) => {
        sendCommand(`${joint}${value}`);
    };

    const handleHomeReset = async () => {
        setIsHoming(true);
        await sendCommand('R'); // Sends the Reset command to your ESP32
        setTimeout(() => setIsHoming(false), 2000);
    };

    return (
        <div className="p-8 bg-slate-900 text-white rounded-xl shadow-2xl max-w-md mx-auto border border-slate-700 font-sans">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-emerald-400 font-mono uppercase tracking-tighter">
                    0xhardcoded // ARM_OS
                </h2>
                <div className={`h-3 w-3 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-red-500'}`} />
            </div>

            {!connected ? (
                <button
                    onClick={connectSerial}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-bold transition-all uppercase text-sm tracking-widest"
                >
                    Initialize USB Link
                </button>
            ) : (
                <div className="space-y-6">
                    {JOINTS.map((joint) => (
                        <ControlInput
                            key={joint.id}
                            label={joint.label}
                            min={joint.min}
                            max={joint.max}
                            initial={joint.initial}
                            onSend={(v) => handleValueChange(joint.id, v)}
                        />
                    ))}

                    <div className="pt-4 border-t border-slate-800">
                        <button
                            onClick={handleHomeReset}
                            disabled={isHoming}
                            className={`w-full py-3 border rounded-lg font-mono transition-all ${isHoming
                                ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                                : 'bg-red-900/30 border-red-500/50 text-red-400 hover:bg-red-900/50'
                                }`}
                        >
                            {isHoming ? "> CALIBRATING..." : "[ EMERGENCY_HOME_RESET ]"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// Helper Input Component
const ControlInput = ({ label, min, max, initial, onSend }) => {
    const [val, setVal] = useState(initial);

    const handleSend = () => {
        // Clamp value
        let num = parseInt(val);
        if (isNaN(num)) return;
        if (num < min) num = min;
        if (num > max) num = max;

        setVal(num);
        onSend(num);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            handleSend();
        }
    };

    return (
        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
            <div className="flex justify-between items-center mb-2">
                <label className="text-[10px] font-mono uppercase text-slate-400 tracking-widest">{label}</label>
                <span className="text-[10px] text-slate-500 font-mono">Range: {min}-{max}</span>
            </div>
            <div className="flex gap-2">
                <input
                    type="number"
                    min={min}
                    max={max}
                    value={val}
                    onChange={(e) => setVal(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-emerald-400 font-mono text-center focus:outline-none focus:border-emerald-500 transition-all placeholder-slate-600"
                    placeholder={initial}
                />
                <button
                    onClick={handleSend}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs uppercase tracking-wider transition-colors"
                >
                    Set
                </button>
            </div>
        </div>
    );
};

export default ArmController;