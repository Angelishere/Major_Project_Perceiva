#!/usr/bin/env python3
"""
Perceiva - Touch-Triggered Audio Client for Raspberry Pi Zero 2 W

Hardware Setup:
- INMP441 I²S MEMS Microphone (recording)
- TTP223 Capacitive Touch Sensor on GPIO17 (trigger)
- Raspberry Pi Camera Module (image capture)
- Bluetooth TWS (soundcore V20i) via PulseAudio A2DP (playback)

Workflow:
1. Wait for touch sensor activation (GPIO17 HIGH)
2. Record audio from INMP441 mic via ALSA
3. Send audio to Node.js server (/pi_intent endpoint) with JWT auth
4. Receive intent command (e.g., CAPTURE_MEDICAL_IMAGE)
5. If medical check requested:
   - Capture product image via Pi Camera
   - Send to /medical-check endpoint with JWT auth
   - Receive medical advice as TTS audio
6. Play audio response through Bluetooth via PulseAudio
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
import asyncio
import numpy as np

try:
    import pyaudio
    PYAUDIO_AVAILABLE = True
except ImportError:
    print("Warning: pyaudio not available. Audio streaming disabled.")
    PYAUDIO_AVAILABLE = False

try:
    from livekit import rtc
    LIVEKIT_AVAILABLE = True
except ImportError:
    print("Warning: livekit-rtc not available. Video call features disabled.")
    LIVEKIT_AVAILABLE = False

try:
    import RPi.GPIO as GPIO
except ImportError:
    print("Warning: RPi.GPIO not available. Running in simulation mode.")
    GPIO = None

try:
    from picamera2 import Picamera2
    CAMERA_AVAILABLE = True
except ImportError:
    print("Warning: Picamera2 not available. Camera features disabled.")
    Picamera2 = None
    CAMERA_AVAILABLE = False

# =============================================================================
# Configuration
# =============================================================================

# Server Configuration
SERVER_URL = os.environ.get("PERCEIVA_SERVER_URL", "http://192.168.85.134:4000")
PI_INTENT_ENDPOINT = f"{SERVER_URL}/pi_intent"
MEDICAL_CHECK_ENDPOINT = f"{SERVER_URL}/medical-check"
AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTdhMWM2NzcyMGRhYTliYzBkYjMzZGQiLCJ1c2VybmFtZSI6ImFyanVuIiwicm9sZSI6ImJsaW5kIiwiaWF0IjoxNzcwNDUyNzAyLCJleHAiOjE3NzA0NTYzMDJ9.s9wa_D7N1nPaaFHZp6VGFyEEgUyrx48sYx8n4TM8lyk"  # JWT token for authentication

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

# LiveKit Video Call Configuration
BACKEND_URL = os.environ.get("PERCEIVA_BACKEND_URL", "https://major-project-perceiva.onrender.com")
VIDEO_WIDTH = 960
VIDEO_HEIGHT = 540
VIDEO_FPS = 24
LIVEKIT_AUDIO_RATE = 16000
LIVEKIT_AUDIO_CHANNELS = 2
LIVEKIT_AUDIO_CHUNK = 320  # 20ms @ 16kHz

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

def send_audio_to_server(audio_path: str) -> dict:
    """
    Send recorded audio to the Node.js server (/pi_intent) and receive intent command.
    
    Args:
        audio_path: Path to the recorded WAV file
    
    Returns:
        Dict with intent information or None on failure
        {
            'action_command': str,
            'detected_module': str,
            'transcribed_text': str,
            'requires_image': bool
        }
    """
    print(f"[Server] Sending audio to {PI_INTENT_ENDPOINT}")
    
    if not AUTH_TOKEN:
        print("[Server] ERROR: No AUTH_TOKEN set. Please set PERCEIVA_AUTH_TOKEN environment variable.")
        return None
    
    try:
        with open(audio_path, 'rb') as audio_file:
            files = {
                'audio': ('recording.wav', audio_file, 'audio/wav')
            }
            
            headers = {
                'Authorization': f'Bearer {AUTH_TOKEN}'
            }
            
            response = requests.post(
                PI_INTENT_ENDPOINT,
                files=files,
                headers=headers,
                timeout=120  # 2 minute timeout for processing
            )
        
        if response.status_code != 200:
            print(f"[Server] Error: HTTP {response.status_code}")
            try:
                error_json = response.json()
                print(f"[Server] Error details: {error_json}")
            except:
                print(f"[Server] Response: {response.text[:200]}")
            return None
        
        # Parse JSON response
        intent_data = response.json()
        
        print(f"[Server] Success!")
        print(f"  - Action Command: {intent_data.get('action_command', 'Unknown')}")
        print(f"  - Detected Module: {intent_data.get('detected_module', 'Unknown')}")
        print(f"  - Transcribed: {intent_data.get('transcribed_text', '')}")
        print(f"  - Requires Image: {intent_data.get('requires_image', False)}")
        
        return intent_data
        
    except requests.exceptions.Timeout:
        print("[Server] Request timed out")
        return None
    except requests.exceptions.ConnectionError:
        print(f"[Server] Connection error - is the server running at {SERVER_URL}?")
        return None
    except Exception as e:
        print(f"[Server] Exception: {e}")
        return None


def capture_image(output_path: str) -> bool:
    """
    Capture an image using the Raspberry Pi camera.
    
    Args:
        output_path: Path to save the captured image (JPEG)
    
    Returns:
        True if capture was successful, False otherwise
    """
    if not CAMERA_AVAILABLE:
        print("[Camera] Picamera2 not available")
        return False
    
    try:
        print("[Camera] Initializing camera...")
        picam = Picamera2()
        
        # Configure for still image capture
        config = picam.create_still_configuration()
        picam.configure(config)
        
        print("[Camera] Starting camera...")
        picam.start()
        
        # Allow camera to warm up
        time.sleep(2)
        
        print(f"[Camera] Capturing image to {output_path}...")
        picam.capture_file(output_path)
        
        picam.stop()
        picam.close()
        
        print("[Camera] Image captured successfully")
        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
        
    except Exception as e:
        print(f"[Camera] Exception: {e}")
        return False


def send_image_to_medical_check(image_path: str) -> bytes:
    """
    Send image to /medical-check endpoint and receive audio advice.
    
    Args:
        image_path: Path to the image file
    
    Returns:
        Audio bytes (WAV) or None on failure
    """
    print(f"[MedicalCheck] Sending image to {MEDICAL_CHECK_ENDPOINT}")
    
    if not AUTH_TOKEN:
        print("[MedicalCheck] ERROR: No AUTH_TOKEN set")
        return None
    
    try:
        with open(image_path, 'rb') as image_file:
            files = {
                'image': ('product.jpg', image_file, 'image/jpeg')
            }
            
            headers = {
                'Authorization': f'Bearer {AUTH_TOKEN}'
            }
            
            response = requests.post(
                MEDICAL_CHECK_ENDPOINT,
                files=files,
                headers=headers,
                timeout=120  # 2 minute timeout
            )
        
        if response.status_code != 200:
            print(f"[MedicalCheck] Error: HTTP {response.status_code}")
            try:
                error_json = response.json()
                print(f"[MedicalCheck] Error details: {error_json}")
            except:
                print(f"[MedicalCheck] Response: {response.text[:200]}")
            return None
        
        # Extract product info from headers
        product_name = requests.utils.unquote(
            response.headers.get('X-Product-Name', 'Unknown')
        )
        
        print(f"[MedicalCheck] Success!")
        print(f"  - Product Name: {product_name}")
        print(f"  - Audio size: {len(response.content)} bytes")
        
        return response.content
        
    except requests.exceptions.Timeout:
        print("[MedicalCheck] Request timed out")
        return None
    except requests.exceptions.ConnectionError:
        print(f"[MedicalCheck] Connection error - is the server running?")
        return None
    except Exception as e:
        print(f"[MedicalCheck] Exception: {e}")
        return None


# =============================================================================
# LiveKit Video Call Functions
# =============================================================================

# Global audio player for remote audio
audio_player = None


async def capture_audio_for_livekit(audio_source):
    """Capture audio from INMP441 and send to LiveKit"""
    if not PYAUDIO_AVAILABLE:
        print("[LiveKit] pyaudio not available")
        return
    
    pa = pyaudio.PyAudio()
    
    stream = pa.open(
        format=pyaudio.paInt16,
        channels=LIVEKIT_AUDIO_CHANNELS,
        rate=LIVEKIT_AUDIO_RATE,
        input=True,
        frames_per_buffer=LIVEKIT_AUDIO_CHUNK,
    )
    
    print("🎤 [LiveKit] INMP441 mic started")
    
    try:
        while True:
            data = stream.read(LIVEKIT_AUDIO_CHUNK, exception_on_overflow=False)
            
            frame = rtc.AudioFrame(
                data=data,
                sample_rate=LIVEKIT_AUDIO_RATE,
                num_channels=LIVEKIT_AUDIO_CHANNELS,
                samples_per_channel=LIVEKIT_AUDIO_CHUNK,
            )
            await audio_source.capture_frame(frame)
            
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()


def start_bluetooth_player():
    """Start PulseAudio player for Bluetooth output"""
    global audio_player
    
    # pacat routes to default PulseAudio sink (Bluetooth A2DP)
    audio_player = subprocess.Popen(
        [
            "pacat",
            "--playback",
            "--rate", "48000",  # LiveKit typically sends 48kHz
            "--channels", "1",   # Mono
            "--format", "s16le",
            "--latency-msec", "100"
        ],
        stdin=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL
    )
    print("🔊 [LiveKit] Bluetooth audio player started")


def on_audio_track(track, publication, participant):
    """Receive remote audio and play through Bluetooth (A2DP)"""
    print(f"🔊 [LiveKit] Receiving audio from {participant.identity}")
    
    async def play():
        # Must use AudioStream to iterate frames
        audio_stream = rtc.AudioStream(track)
        async for event in audio_stream:
            if audio_player and audio_player.stdin:
                try:
                    # Get frame from event
                    frame = event.frame
                    # Send audio data directly to pacat stdin
                    audio_player.stdin.write(frame.data)
                    audio_player.stdin.flush()
                except:
                    pass
    
    asyncio.create_task(play())


async def initiate_video_call():
    """
    Main async function to initiate and manage a LiveKit video call with a volunteer.
    
    Returns:
        True if call completed successfully, False otherwise
    """
    global audio_player
    
    if not LIVEKIT_AVAILABLE:
        print("[VideoCall] LiveKit not available")
        return False
    
    if not CAMERA_AVAILABLE:
        print("[VideoCall] Camera not available")
        return False
    
    print("📞 [VideoCall] Initiating volunteer call...")
    
    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
    
    # Initialize variables for cleanup
    room_id = None
    picam = None
    room = None
    
    try:
        # ===== Request volunteer =====
        print("[VideoCall] Requesting volunteer...")
        resp = requests.post(
            f"{BACKEND_URL}/api/call/request-volunteer",
            headers=headers,
            timeout=10,
        )
        data = resp.json()
        
        if not data.get("success"):
            print("❌ [VideoCall] No volunteers available")
            return False
        
        room_id = data["roomID"]
        volunteer = data["volunteer"]
        print(f"✅ [VideoCall] Volunteer: {volunteer['username']}")
        
        # ===== Get LiveKit token =====
        print("[VideoCall] Getting LiveKit room token...")
        resp = requests.post(
            f"{BACKEND_URL}/api/call/get-room",
            json={"targetUserId": volunteer["_id"]},
            headers=headers,
            timeout=10,
        )
        lk = resp.json()
        livekit_url, token = lk["livekitUrl"], lk["token"]
        
        # ===== Initialize Camera =====
        print("[VideoCall] Initializing camera...")
        picam = Picamera2()
        config = picam.create_preview_configuration(
            main={"size": (VIDEO_WIDTH, VIDEO_HEIGHT), "format": "XBGR8888"}
        )
        config["buffer_count"] = 3
        picam.configure(config)
        picam.start()
        
        # ===== LiveKit room =====
        room = rtc.Room()
        room.on("track_subscribed")(
            lambda track, pub, part:
                on_audio_track(track, pub, part)
                if track.kind == rtc.TrackKind.KIND_AUDIO else None
        )
        
        print("🔗 [VideoCall] Connecting to LiveKit...")
        await room.connect(livekit_url, token)
        print("✅ [VideoCall] Connected")
        
        # Start Bluetooth audio player
        start_bluetooth_player()
        
        # ===== Publish video =====
        video_source = rtc.VideoSource(VIDEO_WIDTH, VIDEO_HEIGHT)
        video_track = rtc.LocalVideoTrack.create_video_track(
            "pi_cam", video_source
        )
        
        await room.local_participant.publish_track(
            video_track,
            rtc.TrackPublishOptions(
                source=rtc.TrackSource.SOURCE_CAMERA,
                video_encoding=rtc.VideoEncoding(
                    max_bitrate=1_500_000,
                    max_framerate=VIDEO_FPS,
                ),
            ),
        )
        print("📷 [VideoCall] Video streaming")
        
        # ===== Publish audio =====
        audio_source = rtc.AudioSource(LIVEKIT_AUDIO_RATE, LIVEKIT_AUDIO_CHANNELS)
        audio_track = rtc.LocalAudioTrack.create_audio_track(
            "inmp441", audio_source
        )
        
        await room.local_participant.publish_track(
            audio_track,
            rtc.TrackPublishOptions(
                source=rtc.TrackSource.SOURCE_MICROPHONE
            ),
        )
        print("🎤 [VideoCall] Audio streaming")
        
        asyncio.create_task(capture_audio_for_livekit(audio_source))
        
        # ===== Main video loop =====
        print("[VideoCall] Call active. Touch sensor to end call.")
        call_active = True
        last_touch_check = time.time()
        
        try:
            while call_active:
                # Capture and send video frame
                frame = picam.capture_array()
                
                video_source.capture_frame(
                    rtc.VideoFrame(
                        VIDEO_WIDTH,
                        VIDEO_HEIGHT,
                        rtc.VideoBufferType.RGBA,
                        frame.tobytes(),
                    )
                )
                
                # Check touch sensor every 100ms to end call
                if time.time() - last_touch_check >= 0.1:
                    if GPIO:
                        # Real hardware: check GPIO pin
                        if GPIO.input(TOUCH_SENSOR_PIN) == GPIO.HIGH:
                            print("[VideoCall] Touch detected - ending call...")
                            time.sleep(0.3)  # Debounce
                            call_active = False
                    # In simulation mode, call continues until Ctrl+C
                    last_touch_check = time.time()
                
                await asyncio.sleep(1 / VIDEO_FPS)
                
        except KeyboardInterrupt:
            print("⏹️ [VideoCall] Keyboard interrupt - ending call...")
        
    except requests.exceptions.RequestException as e:
        print(f"❌ [VideoCall] Network error: {e}")
        return False
    except Exception as e:
        print(f"❌ [VideoCall] Error: {e}")
        return False
    
    finally:
        # Cleanup
        print("[VideoCall] Cleaning up...")
        
        # Stop audio player
        if audio_player:
            try:
                audio_player.stdin.close()
            except:
                pass
            audio_player.terminate()
            try:
                audio_player.wait(timeout=2)
            except:
                audio_player.kill()
            audio_player = None
        
        # End call on backend
        if room_id:
            try:
                requests.post(
                    f"{BACKEND_URL}/api/call/end-call",
                    json={"roomID": room_id},
                    headers=headers,
                    timeout=5,
                )
            except:
                pass
        
        # Stop camera
        if picam:
            try:
                picam.stop()
                picam.close()  # Must close to fully release camera
                print("[VideoCall] Camera released")
            except Exception as e:
                print(f"[VideoCall] Camera cleanup error: {e}")
        
        # Disconnect from LiveKit
        if room:
            try:
                await room.disconnect()
            except:
                pass
        
        print("👋 [VideoCall] Call ended")
    
    return True


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
    2. Send to /pi_intent to get command
    3. If CAPTURE_MEDICAL_IMAGE, capture image and send to /medical-check
    4. Play response audio
    
    Returns:
        True if successful, False otherwise
    """
    # Create temp file for recording
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
        recording_path = tmp_file.name
    
    image_path = None
    
    try:
        # Step 1: Record audio
        success = record_with_touch_trigger(recording_path)
        
        if not success:
            print("[Workflow] Recording failed")
            return False
        
        file_size = os.path.getsize(recording_path)
        print(f"[Workflow] Recording saved: {file_size} bytes")
        
        if file_size < 1000:  # Less than 1KB is probably empty
            print("[Workflow] Recording too short, ignoring")
            return False
        
        # Step 2: Send audio to /pi_intent
        intent_data = send_audio_to_server(recording_path)
        
        if intent_data is None:
            print("[Workflow] Server communication failed")
            return False
        
        action_command = intent_data.get('action_command', '')
        
        # Step 3: Handle command-specific actions
        audio_response = None
        
        if action_command == "CAPTURE_MEDICAL_IMAGE":
            print("[Workflow] Medical compatibility check requested")
            
            # Create temp file for image
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp_img:
                image_path = tmp_img.name
            
            # Capture image
            print("[Workflow] Capturing product image...")
            if not capture_image(image_path):
                print("[Workflow] Image capture failed")
                return False
            
            # Send image to medical-check endpoint
            print("[Workflow] Sending image for medical analysis...")
            audio_response = send_image_to_medical_check(image_path)
            
            if audio_response is None:
                print("[Workflow] Medical check failed")
                return False
        
        elif action_command == "INITIATE_VIDEO_CALL":
            print("[Workflow] Video call requested")
            
            # Run async video call in event loop
            try:
                success = asyncio.run(initiate_video_call())
                if not success:
                    print("[Workflow] Video call failed or no volunteers available")
                else:
                    print("[Workflow] Video call completed")
                
                # No audio response to play after video call
                return success
                
            except Exception as e:
                print(f"[Workflow] Video call error: {e}")
                return False
        
        else:
            # For other commands, we would handle them here
            # For now, just inform the user
            print(f"[Workflow] Command '{action_command}' recognized but not yet implemented")
            # You might want to return here or provide a default response
            return True
        
        # Step 4: Play response audio
        if audio_response:
            success = play_audio_pulseaudio(audio_response)
            
            if not success:
                print("[Workflow] Playback failed")
                return False
        
        return True
        
    finally:
        # Clean up temporary files
        try:
            os.unlink(recording_path)
        except:
            pass
        
        if image_path:
            try:
                os.unlink(image_path)
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
