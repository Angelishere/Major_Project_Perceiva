#!/usr/bin/env python3
"""
Perceiva - Touch-Triggered Audio Client for Raspberry Pi Zero 2 W

Hardware Setup:
- INMP441 I²S MEMS Microphone (recording)
- TTP223 Capacitive Touch Sensor on GPIO17 (trigger)
- Bluetooth TWS (soundcore V20i) via PulseAudio A2DP (playback)

Workflow:
1. Wait for touch sensor activation (GPIO17 HIGH)
2. Record audio from INMP441 mic via ALSA
3. Send audio to Node.js server (/pi_audio endpoint)
4. Receive TTS audio response
5. Play audio through Bluetooth via PulseAudio
"""

import os
import sys
import time
import wave
import struct
import tempfile
import subprocess
import requests
from pathlib import Path

try:
    import RPi.GPIO as GPIO
except ImportError:
    print("Warning: RPi.GPIO not available. Running in simulation mode.")
    GPIO = None

# =============================================================================
# Configuration
# =============================================================================

# Server Configuration
SERVER_URL = os.environ.get("PERCEIVA_SERVER_URL", "http://192.168.85.134:4000")
PI_AUDIO_ENDPOINT = f"{SERVER_URL}/pi_audio"

# GPIO Configuration
TOUCH_SENSOR_PIN = 17  # GPIO17 (Pin 11) - TTP223 OUT

# Audio Recording Configuration (INMP441 I²S Mic)
AUDIO_DEVICE = "hw:0,0"  # Google Voice HAT sound card
SAMPLE_RATE = 16000      # 16 kHz as per hardware spec
CHANNELS = 2             # Stereo (left channel has audio)
SAMPLE_WIDTH = 4         # 32-bit = 4 bytes
RECORD_FORMAT = "S32_LE" # 32-bit signed little-endian

# Recording Settings
MIN_RECORD_DURATION = 0.5    # Minimum recording duration (seconds)
MAX_RECORD_DURATION = 30.0   # Maximum recording duration (seconds)
SILENCE_THRESHOLD = 2.0      # Release touch for this long to stop (seconds)

# Audio Playback
PLAYBACK_COMMAND = "paplay"  # PulseAudio playback (routes to Bluetooth A2DP)

# =============================================================================
# Audio Recording Functions
# =============================================================================

def record_audio_arecord(output_path: str, duration: float = None) -> bool:
    """
    Record audio using arecord from ALSA.
    
    Args:
        output_path: Path to save the WAV file
        duration: Optional fixed duration. If None, records until stopped.
    
    Returns:
        True if recording was successful, False otherwise
    """
    cmd = [
        "arecord",
        "-D", AUDIO_DEVICE,
        "-f", RECORD_FORMAT,
        "-r", str(SAMPLE_RATE),
        "-c", str(CHANNELS),
        "-t", "wav",
    ]
    
    if duration:
        cmd.extend(["-d", str(int(duration))])
    
    cmd.append(output_path)
    
    try:
        print(f"[Recording] Starting: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=MAX_RECORD_DURATION + 5)
        
        if result.returncode != 0:
            print(f"[Recording] Error: {result.stderr}")
            return False
            
        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
        
    except subprocess.TimeoutExpired:
        print("[Recording] Timeout expired")
        return False
    except Exception as e:
        print(f"[Recording] Exception: {e}")
        return False


def record_with_touch_trigger(output_path: str) -> bool:
    """
    Record audio while touch sensor is held, with timeout protection.
    Uses subprocess with manual termination based on touch state.
    
    Returns:
        True if recording was successful, False otherwise
    """
    cmd = [
        "arecord",
        "-D", AUDIO_DEVICE,
        "-f", RECORD_FORMAT,
        "-r", str(SAMPLE_RATE),
        "-c", str(CHANNELS),
        "-t", "wav",
        output_path
    ]
    
    try:
        print("[Recording] Starting touch-triggered recording...")
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        start_time = time.time()
        touch_released_time = None
        
        while True:
            elapsed = time.time() - start_time
            
            # Check max duration
            if elapsed >= MAX_RECORD_DURATION:
                print(f"[Recording] Max duration ({MAX_RECORD_DURATION}s) reached")
                break
            
            # Check touch sensor state
            if GPIO:
                touch_active = GPIO.input(TOUCH_SENSOR_PIN) == GPIO.HIGH
            else:
                # Simulation mode: stop after 3 seconds
                touch_active = elapsed < 3.0
            
            if touch_active:
                touch_released_time = None
            else:
                if touch_released_time is None:
                    touch_released_time = time.time()
                elif time.time() - touch_released_time >= SILENCE_THRESHOLD:
                    # Check minimum duration
                    if elapsed >= MIN_RECORD_DURATION:
                        print(f"[Recording] Touch released, stopping after {elapsed:.1f}s")
                        break
            
            time.sleep(0.05)  # 50ms polling interval
        
        # Terminate arecord gracefully
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        
        duration = time.time() - start_time
        print(f"[Recording] Complete. Duration: {duration:.1f}s")
        
        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
        
    except Exception as e:
        print(f"[Recording] Exception: {e}")
        return False


# =============================================================================
# Server Communication
# =============================================================================

def send_audio_to_server(audio_path: str) -> tuple[bytes, dict]:
    """
    Send recorded audio to the Node.js server and receive TTS response.
    
    Args:
        audio_path: Path to the recorded WAV file
    
    Returns:
        Tuple of (audio_bytes, headers_dict) or (None, None) on failure
    """
    print(f"[Server] Sending audio to {PI_AUDIO_ENDPOINT}")
    
    try:
        with open(audio_path, 'rb') as audio_file:
            files = {
                'audio': ('recording.wav', audio_file, 'audio/wav')
            }
            
            response = requests.post(
                PI_AUDIO_ENDPOINT,
                files=files,
                timeout=120  # 2 minute timeout for processing
            )
        
        if response.status_code != 200:
            print(f"[Server] Error: HTTP {response.status_code}")
            try:
                error_json = response.json()
                print(f"[Server] Error details: {error_json}")
            except:
                print(f"[Server] Response: {response.text[:200]}")
            return None, None
        
        # Extract headers
        headers = {
            'detected_module': response.headers.get('X-Detected-Module', 'Unknown'),
            'transcribed_text': requests.utils.unquote(
                response.headers.get('X-Transcribed-Text', '')
            )
        }
        
        print(f"[Server] Success!")
        print(f"  - Detected Module: {headers['detected_module']}")
        print(f"  - Transcribed: {headers['transcribed_text']}")
        print(f"  - Audio size: {len(response.content)} bytes")
        
        return response.content, headers
        
    except requests.exceptions.Timeout:
        print("[Server] Request timed out")
        return None, None
    except requests.exceptions.ConnectionError:
        print(f"[Server] Connection error - is the server running at {SERVER_URL}?")
        return None, None
    except Exception as e:
        print(f"[Server] Exception: {e}")
        return None, None


# =============================================================================
# Audio Playback Functions
# =============================================================================

def play_audio_pulseaudio(audio_data: bytes) -> bool:
    """
    Play audio through PulseAudio (routes to Bluetooth A2DP sink).
    
    Args:
        audio_data: Raw WAV audio bytes
    
    Returns:
        True if playback was successful, False otherwise
    """
    # Save to temporary file
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
        tmp_path = tmp_file.name
        tmp_file.write(audio_data)
    
    try:
        print(f"[Playback] Playing via {PLAYBACK_COMMAND}...")
        
        result = subprocess.run(
            [PLAYBACK_COMMAND, tmp_path],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if result.returncode != 0:
            print(f"[Playback] Error: {result.stderr}")
            return False
        
        print("[Playback] Complete")
        return True
        
    except subprocess.TimeoutExpired:
        print("[Playback] Timeout")
        return False
    except FileNotFoundError:
        print(f"[Playback] {PLAYBACK_COMMAND} not found. Is PulseAudio installed?")
        return False
    except Exception as e:
        print(f"[Playback] Exception: {e}")
        return False
    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except:
            pass


def play_feedback_beep(frequency: int = 800, duration: float = 0.1):
    """
    Play a short beep for user feedback using ALSA speaker-test.
    Falls back silently if not available.
    """
    try:
        subprocess.run(
            ["speaker-test", "-t", "sine", "-f", str(frequency), 
             "-l", "1", "-p", str(int(duration * 1000))],
            capture_output=True,
            timeout=2
        )
    except:
        pass  # Silently ignore if beep fails


# =============================================================================
# GPIO Setup and Touch Detection
# =============================================================================

def setup_gpio():
    """Initialize GPIO for touch sensor input."""
    if not GPIO:
        print("[GPIO] Running in simulation mode (no RPi.GPIO)")
        return False
    
    try:
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(TOUCH_SENSOR_PIN, GPIO.IN)  # No pull-down needed for TTP223
        print(f"[GPIO] Touch sensor configured on GPIO{TOUCH_SENSOR_PIN}")
        return True
        
    except Exception as e:
        print(f"[GPIO] Setup error: {e}")
        return False


def cleanup_gpio():
    """Clean up GPIO on exit."""
    if GPIO:
        try:
            GPIO.cleanup()
            print("[GPIO] Cleanup complete")
        except Exception:
            pass


def wait_for_touch() -> bool:
    """
    Wait for touch sensor activation using polling.
    
    Returns:
        True when touch is detected, False on error/exit
    """
    if not GPIO:
        # Simulation: wait for Enter key
        print("\n[Simulation] Press Enter to simulate touch...")
        try:
            input()
            return True
        except (KeyboardInterrupt, EOFError):
            return False
    
    print("\n[Touch] Waiting for touch sensor activation...")
    
    try:
        while True:
            if GPIO.input(TOUCH_SENSOR_PIN):
                print("[Touch] Touch detected!")
                time.sleep(0.3)  # Debounce delay
                return True
            time.sleep(0.05)  # 50ms polling interval
            
    except KeyboardInterrupt:
        return False
    except Exception as e:
        print(f"[Touch] Error: {e}")
        return False


# =============================================================================
# Main Workflow
# =============================================================================

def process_single_interaction():
    """
    Handle a single touch-triggered interaction:
    1. Record audio while touch is held
    2. Send to server
    3. Play response
    
    Returns:
        True if successful, False otherwise
    """
    # Create temp file for recording
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
        recording_path = tmp_file.name
    
    try:
        # Record audio
        success = record_with_touch_trigger(recording_path)
        
        if not success:
            print("[Workflow] Recording failed")
            return False
        
        file_size = os.path.getsize(recording_path)
        print(f"[Workflow] Recording saved: {file_size} bytes")
        
        if file_size < 1000:  # Less than 1KB is probably empty
            print("[Workflow] Recording too short, ignoring")
            return False
        
        # Send to server
        audio_response, headers = send_audio_to_server(recording_path)
        
        if audio_response is None:
            print("[Workflow] Server communication failed")
            return False
        
        # Play response
        success = play_audio_pulseaudio(audio_response)
        
        if not success:
            print("[Workflow] Playback failed")
            return False
        
        return True
        
    finally:
        # Clean up recording
        try:
            os.unlink(recording_path)
        except:
            pass


def main():
    """Main entry point - runs the touch-triggered loop."""
    print("=" * 60)
    print("  PERCEIVA - Assistive Wearable Audio Client")
    print("=" * 60)
    print(f"Server: {SERVER_URL}")
    print(f"Audio Device: {AUDIO_DEVICE}")
    print(f"Touch Sensor: GPIO{TOUCH_SENSOR_PIN}")
    print("-" * 60)
    
    # Setup
    setup_gpio()
    
    try:
        print("\nReady! Touch the sensor to start recording...")
        
        while True:
            # Wait for touch
            if not wait_for_touch():
                break
            
            # Process interaction
            print("\n" + "-" * 40)
            success = process_single_interaction()
            
            if success:
                print("[Main] Interaction complete ✓")
            else:
                print("[Main] Interaction failed ✗")
            
            # Small delay before next interaction
            time.sleep(0.5)
            
    except KeyboardInterrupt:
        print("\n\n[Main] Shutting down...")
    finally:
        cleanup_gpio()
    
    print("[Main] Goodbye!")


if __name__ == "__main__":
    main()
