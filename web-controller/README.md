# 0xhardcoded // Next.js Hardware Controller
**Experimental Web Serial API Integration**

### **Core Functionality**
This component serves as the primary interface hosted on **armiyatvk.com**. It establishes a direct hardware-to-browser link over USB-C using modern web standards.

### **Technical Implementation**
* **Signal Throttling:** Implemented a 50ms (20Hz) throttle on slider inputs to prevent Serial buffer overflow and maintain smooth movement.
* **Web Serial API:** Leverages `navigator.serial` to request port access and stream data directly to the ESP32.
* **Packet Protocol:** Sends data as a newline-terminated string for reliable parsing by the firmware (`readStringUntil('\n')`).

### **Development**
1. Run `npm install` to install dependencies.
2. Run `npm run dev` to start the local development server.
3. Ensure you are using a Chromium-based browser (Chrome/Edge) for Web Serial support.