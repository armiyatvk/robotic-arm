# 0xhardcoded // 4-DOF IoT Robotic Arm & Cloud Control Platform
**Hardware Engineering · Real-Time Systems · Cloud Infrastructure**

### Project Overview
A custom 3D-printed 4-DOF robotic arm controllable from anywhere in the world. The platform supports dual control modes — direct USB via the Web Serial API, and remote Wi-Fi via a cloud backend — with a multi-user command queue system that coordinates concurrent access to the physical device in real time.

---

### Engineering Challenges & Solutions

**1. Dual-Core FreeRTOS Architecture**
Network latency is the enemy of smooth robotics. A standard single-core loop freezes the servos while waiting for HTTP responses from remote servers.

**Solution:** The ESP32's dual-core architecture separates concerns completely:
- **Core 0** handles all blocking Wi-Fi polling and cloud authentication in isolation
- **Core 1** runs a dedicated 15ms asymptotic easing loop — proportional control that smoothly accelerates and decelerates servos toward their target angles at 60fps, completely unaffected by network activity

**2. Power Distribution & Brownout Prevention**
Four simultaneous MG90S servos draw significantly more current than the ESP32's onboard regulator can supply, causing brownouts and Wi-Fi disconnects under load.

**Solution:** A custom power distribution rail on a breadboard with a shared common ground bypasses the microcontroller entirely, providing a dedicated 5V source directly to the actuators.

**3. Multi-User Concurrency & Command Queue**
Multiple users sharing one physical arm creates a race condition — two simultaneous commands could send conflicting angles to the same servo.

**Solution:** A server-side command queue with a boolean lock serializes all incoming commands. The lock pattern mirrors the character-selection transaction lock built for the DayBreak multiplayer project — Node.js's single-threaded model makes a boolean flag safe without a mutex. Commands are validated against the firmware's hardware safety constraints before entering the queue, rejected server-side if out of range.

---

### Architecture
React/Vite Dashboard (armiyatvk.com)
↓
Node.js + Socket.IO Backend
↓
Command Queue (boolean lock, serial execution)
↓
PostgreSQL (users, sessions, command_history)
↓
ESP32 Firmware (FreeRTOS dual-core)
↓
4x MG90S Servos

**Control flow:**
1. User submits a command from the dashboard
2. Server validates angle against hardware safety limits
3. Command enters the queue — all connected clients see the update in real time
4. Queue processes commands one at a time, broadcasting state after each execution
5. Originating client receives the result; arm state broadcasts to all clients

---

### Technical Stack

**Hardware & Fabrication**
- Bambu Lab P1S (3D printing), custom chassis design
- ESP32 Freenove WROOM microcontroller
- 4x MG90S micro servos
- Custom 5V power distribution rail

**Firmware**
- C++ (Arduino Framework), FreeRTOS dual-core task pinning
- Asymptotic easing filter for smooth servo control
- Hardware safety constraints (angle limits per joint)

**Frontend**
- React, Vite, Tailwind CSS
- Web Serial API (local USB fallback)
- Socket.IO client (remote Wi-Fi control)

**Backend**
- Node.js, Express, Socket.IO
- TypeScript throughout
- Server-side command queue with boolean lock

**Infrastructure**
- PostgreSQL (AWS RDS) — users, sessions, command history
- Docker (containerized services)
- AWS EC2 — backend hosting
- GitHub Actions — CI/CD pipeline
- Cloudflare — frontend hosting

---

### Repository Structure

    robotic-arm-v1.1/
    ├── firmware/
    │   └── arm_servos/          ESP32 C++ firmware, FreeRTOS tasks,
    │                            safety constraints, pin mapping
    ├── web-controller/
    │   └── components/          React/Vite dashboard component
    │                            hosted on armiyatvk.com
    ├── server/
    │   └── src/
    │       ├── types.ts         Shared TypeScript interfaces,
    │       │                    Socket.IO event contracts
    │       ├── queue.ts         Command queue, boolean lock,
    │       │                    hardware validation
    │       ├── db.ts            PostgreSQL connection pool,
    │       │                    schema, query functions
    │       ├── socket.ts        Socket.IO event handlers,
    │       │                    queue coordination, broadcasting
    │       └── index.ts         Express server, HTTP + WebSocket
    │                            entry point
    ├── docker-compose.yml       Multi-container setup
    └── .github/
        └── workflows/
            └── deploy.yml       CI/CD pipeline

---

### Hardware Safety Constraints

Hardcoded limits protect the 3D-printed chassis:

| Joint | Min | Max | Default |
|-------|-----|-----|---------|
| Base rotation | 0° | 180° | 90° |
| Shoulder lift | 10° | 170° | 90° |
| Elbow extension | 30° | 150° | 90° |
| Gripper claw | 10° | 90° | 20° |

These limits are enforced at two layers — the server rejects out-of-range commands before they enter the queue, and the firmware applies them again before driving the servos.

---

### Local Development

**Prerequisites:** Node.js 18+, Docker

```bash
# Clone the repo
git clone https://github.com/armiyatvk/robotic-arm

# Start the database
docker run --name arm-postgres \
  -e POSTGRES_DB=armdb \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 -d postgres:16

# Start the backend
cd server
cp .env.example .env
npm install
npm run dev

# Server runs on http://localhost:3001
# Health check: http://localhost:3001/health
# Queue state: http://localhost:3001/queue
```

---

### ESP32 Setup

1. Install `ESP32Servo` and `Firebase_ESP_Client` libraries in Arduino IDE
2. Copy `firmware/arm_servos/secrets.example.h` → `secrets.h`
3. Add Wi-Fi credentials and Firebase API key to `secrets.h`
4. Connect ESP32 via USB-C with external 5V servo power rail active
5. Upload the sketch

**Pin mapping:**
- Base rotation: GPIO 14
- Shoulder flex: GPIO 27
- Elbow extension: GPIO 26
- Gripper claw: GPIO 33

---

*Credentials and environment variables are excluded from this repository. See `.example` files in each directory to configure your own deployment.*