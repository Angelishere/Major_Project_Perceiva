# Perceiva - Raspberry Pi Audio Client

Python client for the Perceiva wearable assistive device that runs on Raspberry Pi Zero 2 W.

## Features

- **Touch-triggered recording**: Hold the TTP223 touch sensor to record
- **I²S audio capture**: Records from INMP441 MEMS microphone via ALSA
- **Server integration**: Sends audio to Node.js backend for processing
- **Bluetooth playback**: Plays TTS responses via PulseAudio → A2DP

## Hardware Requirements

| Component | Connection | Notes |
|-----------|------------|-------|
| INMP441 Mic | I²S (GPIO18,19,20) | Left channel only |
| TTP223 Touch | GPIO17 | Active HIGH |
| Bluetooth TWS | PulseAudio A2DP | soundcore V20i |

## Installation

```bash
# Install Python dependencies
pip install -r requirements.txt

# Ensure system packages are installed
sudo apt install pulseaudio pulseaudio-module-bluetooth alsa-utils
```

## Configuration

Set the server URL via environment variable:

```bash
export PERCEIVA_SERVER_URL="http://your-server-ip:4000"
```

Or edit the default in `perceiva_client.py`.

## Usage

```bash
# Run the client
python perceiva_client.py
```

### Workflow

1. **Wait**: Client waits for touch sensor activation
2. **Record**: Touch and hold to record your voice
3. **Release**: Release touch to stop recording
4. **Process**: Audio is sent to server (STT → Gemini → TTS)
5. **Listen**: TTS response plays through Bluetooth earbuds

## Audio Configuration

The client expects this ALSA/PulseAudio setup:

```
# Verify mic is available
arecord -l

# Verify Bluetooth sink is default
pactl info | grep "Default Sink"
```

## Troubleshooting

### No audio recording
- Check I²S overlay is enabled in `/boot/config.txt`
- Verify `arecord -l` shows the device

### No Bluetooth playback
- Ensure PulseAudio is running: `pulseaudio --check`
- Check Bluetooth connection: `bluetoothctl info`
- Verify default sink: `pactl list sinks short`

### Server connection failed
- Verify server URL and port
- Check network connectivity
- Ensure firewall allows connection
