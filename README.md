# DuckSoup + Mozza Research Platform

A real-time facial manipulation and recording platform designed for psychological research. This system enables researchers to manipulate a participant's smile intensity in real-time during a video call or self-reflection task, while simultaneously recording both the "clean" (unaltered) and "altered" (manipulated) video streams.

## Key Features

- **Real-time Smile Manipulation**: Powered by the Mozza GStreamer plugin using `dlib` face detection.
- **Dual-Stream Recording**: Synchronized capture of raw webcam input and manipulated WebRTC output.
- **Dynamic Control**: Live adjustment of smile intensity (`alpha`), detection sensitivity, and debug overlays.
- **Cross-Platform Architecture**: Docker-based backend for consistent GStreamer performance and an Electron/Next.js frontend for a premium user experience.

---

## Architecture

- **Backend (`ducksoup-server`)**: 
  - GStreamer-based WebRTC server (DuckSoup).
  - Custom Mozza plugin for facial landmark transformation.
  - Runs in Docker for easy deployment on ARM64/x86.
- **Frontend (`ducksoup-frontend`)**:
  - Electron application for low-latency video handling.
  - Next.js (Renderer) for the research control interface.
  - Integrated dual MediaRecorder pipeline for data collection.

---

## Quick Start

### 1. Prerequisites
- **Docker & Docker Compose**
- **Node.js (v18+) & npm**
- **ARM64 Mac (M1/M2/M3)** or Linux machine.

### 2. Start the Backend
```bash
cd ducksoup-server
docker compose up -d
```
*Note: The first run will pull the ducksouplab/ducksoup image.*

### 3. Start the Frontend
```bash
cd ducksoup-frontend
npm install
npm run dev
```

---

## Usage Guide

### Connecting to the Session
1. Click **Connect** in the top right corner.
2. Grant camera/microphone permissions.
3. You will see two panels:
   - **Altered Reflection**: The feed coming back from the server with Mozza FX applied.
   - **Clean Reflection**: Your raw local webcam feed for reference.

### Adjusting Mozza Parameters
Use the sidebar sliders to tweak the experiment:
- **Smile Alpha**: `1.0` is neutral. `>1.0` increases smile intensity. `<1.0` (down to `-2.0`) creates a frown.
- **Detection Threshold**: Adjust if the face tracking is unstable. Lower values (e.g., `0.05`) are more sensitive.
- **Debug Overlay**: Toggle this to see the green landmark dots and deformation vectors.

### Recording Data
1. Click **Select Save Folder** to choose where to store the research data.
2. Click **Start Dual Recording**.
3. When finished, click **Stop Recording**. 
4. The system will save two files to your selected folder:
   - `{timestamp}-clean.webm`
   - `{timestamp}-altered.webm`

---

## ⚡ Performance Optimization (ARM Macs)

Running real-time face detection in a Docker VM can be resource-intensive. If you experience lag:
- **Close Background Apps**: Ensure your CPU is dedicated to the research session.
- **Lighting**: Ensure the participant's face is well-lit for faster `dlib` detection.
- **Stream Settings**: The system is currently optimized for `320x240 @ 10fps` to ensure stability. These can be adjusted in `renderer/pages/home.tsx` if more power is available.

---

## Project Structure

```text
.
├── ducksoup-server/      # Docker configuration and GStreamer plugins
│   ├── plugins/          # Mozza .so and .dfm files
│   └── data/             # Server-side logs and debug recordings
├── ducksoup-frontend/    # Electron + Next.js source code
│   ├── main/             # Electron main process (IPC handlers)
│   └── renderer/         # Next.js UI (Mozza controls and Video logic)
└── mozza-main/           # Source code for the Mozza plugin (for reference)
```

## Maintenance & Plugin Updates

To update the Mozza plugin or change the deformation model:
1. Replace `libgstmozza.so` or `default.dfm` in `ducksoup-server/plugins/`.
2. Restart the server: `cd ducksoup-server && docker compose restart ducksoup`.
3. Re-connect the Electron app.

---
*Developed for Psychology Research Applications.*
