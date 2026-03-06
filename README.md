# 0xhardcoded // 4-DOF IoT Robotic Arm & Web Controller
**A Full-Stack Hardware Engineering & Cloud Integration Study**

### **Project Overview**
This project bridges physical fabrication, power electronics, and modern web technologies. It features a custom 3D-printed 4-DOF robotic arm that can be controlled simultaneously via a direct **Web Serial API** (USB) or globally via **Wi-Fi** using Firebase Realtime Database. 

### **The Engineering Challenges**

**1. The Dual-Core FreeRTOS Architecture**
Network latency is the enemy of smooth robotics. A standard single-core loop would freeze the servos while waiting for HTTP responses from Google's servers. 
* **The Solution:** I leveraged the ESP32's dual-core architecture using FreeRTOS (`xTaskCreatePinnedToCore`). 
* **Core 0** handles the blocking Wi-Fi polling and Firebase authentication in the background. 
* **Core 1** is dedicated exclusively to instant USB parsing and executing an asymptotic easing filter (proportional control) for buttery-smooth servo movements at 60fps.

**2. Power Distribution & Brownout Prevention**
Four simultaneous MG90S servos draw significantly more current than the ESP32’s onboard regulator can handle, causing severe brownouts and Wi-Fi disconnects. 
* **The Solution:** I engineered a custom power distribution rail on a breadboard with a shared common ground, bypassing the microcontroller to provide a dedicated 5V power source directly to the actuators.

### **Technical Stack**
* **Fabrication:** Bambu Lab P1S (3D Printing), Custom Chassis
* **Hardware:** ESP32 (Freenove WROOM), 4x MG90S Servos
* **Frontend:** React, Vite, Tailwind CSS, Web Serial API
* **Backend/Cloud:** Firebase Realtime Database, C++ (FreeRTOS Dual-Core)

### **Repository Structure**
* `/firmware`: ESP32 C++ control logic, FreeRTOS tasks, and kinematic safety constraints.
* `/web-controller`: The React/Vite frontend interface hosted on armiyatvk.com.

*(Note: Environment variables and network credentials have been excluded from this repository for security. See the `.example` files in their respective directories to configure your own deployment).*