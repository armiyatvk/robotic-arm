# 0xhardcoded // React Hardware Controller
**Hybrid Cloud & Web Serial GUI**

### **Core Functionality**
This React/Vite component serves as the primary interface hosted on **armiyatvk.com**. It establishes a real-time, bidirectional link to the robotic arm using two fallback methods: Global Wi-Fi (Firebase) and Local USB (Web Serial).

### **Technical Implementation**
* **Real-Time Cloud Sync:** Uses Firebase `onValue` websockets to watch a "Heartbeat" timestamp from the ESP32. If the arm is online, the UI automatically unlocks the Wi-Fi control mode.
* **Web Serial API Fallback:** Leverages `navigator.serial` to request port access and stream data directly to the hardware if Wi-Fi is unavailable (requires Chromium-based browser).
* **Network Throttling:** Slider `onChange` events update local draft states, but network payloads are optimized to only fire `onPointerUp` to prevent overloading the database queue and hardware buffer.

### **Development Setup**
1. Duplicate the `.env.example` file and rename it to `.env`.
2. Add your Firebase `VITE_` credentials to the file.
3. Run `npm install` to install dependencies.
4. Run `npm run dev` to start the local Vite development server.