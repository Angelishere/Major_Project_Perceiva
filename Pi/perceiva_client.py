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
import threading
from libcamera import Transform

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
SERVER_URL = "http://192.168.229.134:4000"
PI_INTENT_ENDPOINT = f"{SERVER_URL}/pi_intent"
MEDICAL_CHECK_ENDPOINT = f"{SERVER_URL}/medical-check"
PRODUCT_IDENTIFICATION_ENDPOINT = f"{SERVER_URL}/identify-product"
SCENE_DESCRIPTION_ENDPOINT = f"{SERVER_URL}/describe-scene"
PRICE_COMPARISON_ENDPOINT = f"{SERVER_URL}/compare"
FASTAPI_URL = "https://chanel-confirmed-overprotectively.ngrok-free.dev"  # FastAPI STT/TTS service
AUTH_TOKEN = None  # Set at runtime via login

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
LOGIN_ENDPOINT = f"{BACKEND_URL}/login"
VIDEO_WIDTH = 960
VIDEO_HEIGHT = 540
VIDEO_FPS = 24
LIVEKIT_AUDIO_RATE = 16000
LIVEKIT_AUDIO_CHANNELS = 2
LIVEKIT_AUDIO_CHUNK = 320  # 20ms @ 16kHz

# Audio Files (assumed to be in same directory)
AUDIO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wav")

def play_audio_file(filename: str):
    """
    Play local wav sounds reliably.

    Behaviour:
    - If pacat (video call audio) is active → inject into same stream
    - Otherwise use paplay normally
    """

    filepath = os.path.join(AUDIO_DIR, filename)

    if not os.path.exists(filepath):
        print(f"[Audio] File not found: {filepath}")
        return

    # If persistent pacat stream exists, use it
    if audio_player and audio_player.stdin:
        play_audio_via_pacat(filepath)
        return

    # Otherwise fallback to paplay
    cmd = [
        PLAYBACK_COMMAND,
        "--latency-msec=50",
        "--stream-name=perceiva-ui",
        filepath
    ]

    try:
        subprocess.run(cmd, check=False)
    except Exception as e:
        print(f"[Audio] Error playing {filename}: {e}")




def play_audio_via_pacat(filepath: str):
    """
    Send WAV audio directly into existing pacat stream.
    Assumes pacat configured as:
        --rate 48000 --channels 1 --format s16le
    """
    global audio_player

    if not audio_player or not audio_player.stdin:
        print("[Audio] pacat not active, cannot route audio")
        return

    try:
        with open(filepath, "rb") as f:
            data = f.read()

        # Skip standard WAV header (44 bytes)
        pcm_data = data[44:]

        audio_player.stdin.write(pcm_data)
        audio_player.stdin.flush()

    except Exception as e:
        print(f"[Audio] pacat playback error: {e}")

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
        touch_start_played = False
        
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
                if not touch_start_played:
                    play_audio_file("touchnew.wav")
                    touch_start_played = True
                
                touch_released_time = None
            else:
                touch_start_played = False # Reset for next touch
                
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

def speech_to_text(audio_path: str) -> str:
    """
    Send audio to FastAPI /stt-upload for speech-to-text conversion.
    
    Args:
        audio_path: Path to the recorded WAV file
    
    Returns:
        Transcribed text string, or None on failure
    """
    stt_url = f"{FASTAPI_URL}/stt-upload"
    print(f"[STT] Sending audio to {stt_url}")
    
    try:
        with open(audio_path, 'rb') as audio_file:
            files = {
                'file': ('recording.wav', audio_file, 'audio/wav')
            }
            
            response = requests.post(
                stt_url,
                files=files,
                timeout=60
            )
        
        if response.status_code != 200:
            print(f"[STT] Error: HTTP {response.status_code}")
            print(f"[STT] Response: {response.text[:200]}")
            return None
        
        result = response.json()
        text = result.get('text', '').strip()
        
        if not text:
            print("[STT] No text returned from STT")
            return None
        
        print(f"[STT] Transcribed: {text}")
        return text
        
    except requests.exceptions.Timeout:
        print("[STT] Request timed out")
        return None
    except requests.exceptions.ConnectionError:
        print(f"[STT] Connection error - is FastAPI running at {FASTAPI_URL}?")
        return None
    except Exception as e:
        print(f"[STT] Exception: {e}")
        return None


def send_text_to_intent(text: str) -> dict:
    """
    Send transcribed text to Node.js /pi_intent endpoint to get intent command.
    
    Args:
        text: Transcribed text from STT
    
    Returns:
        Dict with intent info or audio data, or None on failure
    """
    print(f"[Intent] Sending text to {PI_INTENT_ENDPOINT}")
    
    if not AUTH_TOKEN:
        print("[Intent] ERROR: No AUTH_TOKEN set.")
        return None
    
    try:
        headers = {
            'Authorization': f'Bearer {AUTH_TOKEN}',
            'Content-Type': 'application/json'
        }
        
        response = requests.post(
            PI_INTENT_ENDPOINT,
            json={'text': text},
            headers=headers,
            timeout=120
        )
        
        if response.status_code != 200:
            print(f"[Intent] Error: HTTP {response.status_code}")
            try:
                error_json = response.json()
                print(f"[Intent] Error details: {error_json}")
            except:
                print(f"[Intent] Response: {response.text[:200]}")
            return None
        
        # Parse JSON response
        intent_data = response.json()
        
        print(f"[Intent] Success!")
        print(f"  - Action Command: {intent_data.get('action_command', 'Unknown')}")
        print(f"  - Detected Module: {intent_data.get('detected_module', 'Unknown')}")
        if intent_data.get('ai_response'):
            print(f"  - AI Response: {intent_data['ai_response'][:100]}...")
        
        return intent_data
        
    except requests.exceptions.Timeout:
        print("[Intent] Request timed out")
        return None
    except requests.exceptions.ConnectionError:
        print(f"[Intent] Connection error - is the server running at {SERVER_URL}?")
        return None
    except Exception as e:
        print(f"[Intent] Exception: {e}")
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
        
        # Configure for still image capture at reduced resolution
        # 1024x768 is sufficient for product label identification and keeps upload fast
        config = picam.create_still_configuration(
            main={"size": (1024, 768)}
        )
        picam.configure(config)
        
        print("[Camera] Starting camera...")
        picam.start()
        
        # Allow camera to warm up
        time.sleep(2)
        
        play_audio_file("shutternew.wav")
        print(f"[Camera] Capturing image to {output_path}...")
        picam.capture_file(output_path)
        
        picam.stop()
        picam.close()
        
        file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        print(f"[Camera] Image captured successfully ({file_size / 1024:.0f} KB)")
        return file_size > 0
        
    except Exception as e:
        print(f"[Camera] Exception: {e}")
        return False


def send_image_to_medical_check(image_path: str) -> bytes:
    """
    Send image to /medical-check endpoint and receive advice as text,
    then convert to audio via FastAPI TTS.

    Args:
        image_path: Path to the image file

    Returns:
        Audio bytes (WAV) or None on failure
    """
    if not AUTH_TOKEN:
        print("[MedicalCheck] ERROR: No AUTH_TOKEN set")
        return None

    # Debug file size
    try:
        file_size = os.path.getsize(image_path)
        print(f"[MedicalCheck] Image size: {file_size / 1024:.0f} KB")
    except:
        pass

    headers = {
        "Authorization": f"Bearer {AUTH_TOKEN}"
    }

    MAX_RETRIES = 2

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"[MedicalCheck] Sending to {MEDICAL_CHECK_ENDPOINT} (attempt {attempt}/{MAX_RETRIES})")

            # STREAM FILE like currency recognition endpoint
            with open(image_path, "rb") as img_file:

                files = {
                    "image": ("product.jpg", img_file, "image/jpeg")
                }

                response = requests.post(
                    MEDICAL_CHECK_ENDPOINT,
                    files=files,
                    headers=headers,
                    timeout=(20, 180)  # longer connect timeout for Pi
                )

            # Retry only on 502
            if response.status_code == 502 and attempt < MAX_RETRIES:
                print("[MedicalCheck] Got 502, retrying in 3s...")
                time.sleep(3)
                continue

            if response.status_code != 200:
                print(f"[MedicalCheck] Error: HTTP {response.status_code}")
                try:
                    print(f"[MedicalCheck] Error details: {response.json()}")
                except:
                    print(f"[MedicalCheck] Response: {response.text[:200]}")
                return None

            # Parse response JSON
            result = response.json()
            product_name = result.get("product_name", "Unknown")
            advice = result.get("advice", "")

            print("[MedicalCheck] Success!")
            print(f"  - Product Name: {product_name}")
            print(f"  - Advice: {advice[:100]}...")

            if not advice:
                print("[MedicalCheck] No advice received")
                return None

            # Convert advice to audio
            TTS_API = f"{FASTAPI_URL}/tts"
            print("[MedicalCheck] Converting advice to audio...")

            tts_response = requests.post(
                TTS_API,
                json={"text": advice},
                timeout=30
            )

            if tts_response.status_code != 200:
                print(f"[MedicalCheck] TTS failed: HTTP {tts_response.status_code}")
                return None

            print(f"[MedicalCheck] TTS audio received: {len(tts_response.content)} bytes")
            return tts_response.content

        except requests.exceptions.Timeout:
            print(f"[MedicalCheck] Timeout on attempt {attempt}")
            if attempt < MAX_RETRIES:
                time.sleep(3)
                continue
            return None

        except requests.exceptions.ConnectionError as e:
            print(f"[MedicalCheck] Connection error on attempt {attempt}: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(3)
                continue
            return None

        except Exception as e:
            print(f"[MedicalCheck] Exception: {e}")
            return None

    return None



def send_image_to_currency_recognition(image_path: str) -> bytes:
    """
    Send captured image to currency recognition API and get TTS audio response.
    
    Args:
        image_path: Path to the captured image
    
    Returns:
        Audio bytes from TTS or None on failure
    """
    print(f"[CurrencyRecognition] Processing image: {image_path}")
    
    # API endpoints
    CURRENCY_API = "https://chanel-confirmed-overprotectively.ngrok-free.dev/currency-recognition"
    TTS_API = "https://chanel-confirmed-overprotectively.ngrok-free.dev/tts"
    
    try:
        # Step 1: Send image to currency recognition
        print("[CurrencyRecognition] Sending image to currency API...")
        
        with open(image_path, 'rb') as img_file:
            files = {
                'file': ('currency.jpg', img_file, 'image/jpeg')
            }
            
            response = requests.post(
                CURRENCY_API,
                files=files,
                timeout=30
            )
        
        if response.status_code != 200:
            print(f"[CurrencyRecognition] Currency API Error: HTTP {response.status_code}")
            try:
                print(f"[CurrencyRecognition] Error: {response.json()}")
            except:
                print(f"[CurrencyRecognition] Error: {response.text[:200]}")
            return None
        
        # Parse currency prediction
        result = response.json()
        
        if not result.get('ok'):
            print("[CurrencyRecognition] Currency recognition failed")
            return None
        
        prediction = result.get('prediction', 'unknown')
        confidence = result.get('confidence', 0)
        
        print(f"[CurrencyRecognition] Detected currency: ₹{prediction}")
        print(f"[CurrencyRecognition] Confidence: {confidence:.2%}")
        
        print(f"[CurrencyRecognition] Detected currency: ₹{prediction}")
        print(f"[CurrencyRecognition] Confidence: {confidence:.2%}")
        
        # Step 2: Play local audio file for currency
        # Expected files: "10.wav", "20.wav", "50.wav", "100.wav", "200.wav", "500.wav"
        currency_audio_file = f"{prediction}.wav"
        
        print(f"[CurrencyRecognition] Playing local audio: {currency_audio_file}")
        play_audio_file(currency_audio_file)
        
        # Return dummy bytes to signal success (since we handled playback locally)
        return b"LOCAL_PLAYBACK_DONE"
        
    except requests.exceptions.Timeout:
        print("[CurrencyRecognition] Request timed out")
        play_audio_file("Interaction_fail.wav")
        return None
    except requests.exceptions.ConnectionError:
        print("[CurrencyRecognition] Connection error - is the ngrok tunnel running?")
        play_audio_file("Interaction_fail.wav")
        return None
    except Exception as e:
        print(f"[CurrencyRecognition] Exception: {e}")
        play_audio_file("Interaction_fail.wav")
        return None
    except Exception as e:
        print(f"[CurrencyRecognition] Exception: {e}")
        return None


def send_image_to_find_product(image_path: str, query_text: str) -> bytes:
    """
    Send image and query to /find-product and get TTS audio response.
    """
    if not AUTH_TOKEN:
        print("[FindProduct] ERROR: No AUTH_TOKEN set")
        return None
        
    endpoint = f"{SERVER_URL}/find-product"
    print(f"[FindProduct] Sending to {endpoint} with query: '{query_text}'")
    
    try:
        with open(image_path, 'rb') as img_file:
            files = {'image': ('scene.jpg', img_file, 'image/jpeg')}
            data = {'query': query_text}
            headers = {'Authorization': f'Bearer {AUTH_TOKEN}'}
            
            response = requests.post(endpoint, files=files, data=data, headers=headers, timeout=60)
            
        if response.status_code != 200:
            print(f"[FindProduct] Error: HTTP {response.status_code}")
            return None
            
        result = response.json()
        guidance = result.get('guidance', '')
        print(f"[FindProduct] Guidance: {guidance}")
        
        # If guidance is empty, maybe play a generic fail message?
        if not guidance:
            print("[FindProduct] No guidance returned")
            return None
            
        # TTS
        tts_url = f"{FASTAPI_URL}/tts"
        tts_resp = requests.post(tts_url, json={'text': guidance}, timeout=30)
        
        if tts_resp.status_code != 200:
            print(f"[FindProduct] TTS failed: {tts_resp.status_code}")
            return None
            
        return tts_resp.content
        
    except Exception as e:
        print(f"[FindProduct] Exception: {e}")
        return None


def send_image_to_product_identification(image_path: str) -> bytes:
    """
    Send image to /identify-product endpoint and receive product name as text,
    then convert to audio via FastAPI TTS.

    Args:
        image_path: Path to the image file

    Returns:
        Audio bytes (WAV) or None on failure
    """
    if not AUTH_TOKEN:
        print("[ProductID] ERROR: No AUTH_TOKEN set")
        return None

    print(f"[ProductID] Processing image: {image_path}")

    try:
        with open(image_path, "rb") as img_file:
            files = {
                "image": ("product.jpg", img_file, "image/jpeg")
            }
            
            print("[ProductID] Sending to server...")
            response = requests.post(
                PRODUCT_IDENTIFICATION_ENDPOINT,
                files=files,
                timeout=30
            )

            if response.status_code != 200:
                print(f"[ProductID] Error: HTTP {response.status_code}")
                try:
                    print(f"[ProductID] Error details: {response.json()}")
                except:
                    print(f"[ProductID] Response: {response.text[:200]}")
                return None

            # Parse response JSON
            result = response.json()
            product_name = result.get("product_name", "")
            
            print("[ProductID] Success!")
            print(f"  - Product Name: {product_name}")

            if not product_name:
                print("[ProductID] No product name received")
                return None

            # Convert to audio
            TTS_API = f"{FASTAPI_URL}/tts"
            print("[ProductID] Converting result to audio...")

            tts_response = requests.post(
                TTS_API,
                json={"text": product_name},
                timeout=30
            )

            if tts_response.status_code != 200:
                print(f"[ProductID] TTS failed: HTTP {tts_response.status_code}")
                return None

            print(f"[ProductID] TTS audio received: {len(tts_response.content)} bytes")
            return tts_response.content

    except Exception as e:
        print(f"[ProductID] Exception: {e}")
        return None


def send_image_to_scene_description(image_path: str) -> bytes:
    """
    Send image to /describe-scene endpoint and receive scene description,
    then convert to audio via FastAPI TTS.

    Args:
        image_path: Path to the image file

    Returns:
        Audio bytes (WAV) or None on failure
    """
    if not AUTH_TOKEN:
        print("[SceneDesc] ERROR: No AUTH_TOKEN set")
        return None

    print(f"[SceneDesc] Processing image: {image_path}")

    try:
        with open(image_path, "rb") as img_file:
            files = {
                "image": ("scene.jpg", img_file, "image/jpeg")
            }
            
            print("[SceneDesc] Sending to server...")
            response = requests.post(
                SCENE_DESCRIPTION_ENDPOINT,
                files=files,
                timeout=30
            )

            if response.status_code != 200:
                print(f"[SceneDesc] Error: HTTP {response.status_code}")
                try:
                    print(f"[SceneDesc] Error details: {response.json()}")
                except:
                    print(f"[SceneDesc] Response: {response.text[:200]}")
                return None

            # Parse response JSON
            result = response.json()
            scene_description = result.get("scene_description", "")
            
            print("[SceneDesc] Success!")
            print(f"  - Description: {scene_description[:100]}...")

            if not scene_description:
                print("[SceneDesc] No description received")
                return None

            # Convert to audio
            TTS_API = f"{FASTAPI_URL}/tts"
            print("[SceneDesc] Converting result to audio...")

            tts_response = requests.post(
                TTS_API,
                json={"text": scene_description},
                timeout=30
            )

            if tts_response.status_code != 200:
                print(f"[SceneDesc] TTS failed: HTTP {tts_response.status_code}")
                return None

            print(f"[SceneDesc] TTS audio received: {len(tts_response.content)} bytes")
            return tts_response.content

    except Exception as e:
        print(f"[SceneDesc] Exception: {e}")
        return None


def send_image_to_price_comparison(image_path: str) -> bytes:
    """
    Send image to /compare endpoint and receive price comparison advice,
    then convert to audio via FastAPI TTS.

    Args:
        image_path: Path to the image file

    Returns:
        Audio bytes (WAV) or None on failure
    """
    if not AUTH_TOKEN:
        print("[PriceCompare] ERROR: No AUTH_TOKEN set")
        return None

    print(f"[PriceCompare] Processing image: {image_path}")

    try:
        with open(image_path, "rb") as img_file:
            files = {
                "image": ("product.jpg", img_file, "image/jpeg")
            }
            
            print("[PriceCompare] Sending to server...")
            response = requests.post(
                PRICE_COMPARISON_ENDPOINT,
                files=files,
                timeout=45
            )

            if response.status_code != 200:
                print(f"[PriceCompare] Error: HTTP {response.status_code}")
                try:
                    print(f"[PriceCompare] Error details: {response.json()}")
                except:
                    print(f"[PriceCompare] Response: {response.text[:200]}")
                return None

            # Parse response JSON
            result = response.json()
            advice = result.get("advice", "")
            
            print("[PriceCompare] Success!")
            print(f"  - Advice: {advice}")

            if not advice:
                print("[PriceCompare] No advice received")
                return None

            # Convert to audio
            TTS_API = f"{FASTAPI_URL}/tts"
            print("[PriceCompare] Converting result to audio...")

            tts_response = requests.post(
                TTS_API,
                json={"text": advice},
                timeout=30
            )

            if tts_response.status_code != 200:
                print(f"[PriceCompare] TTS failed: HTTP {tts_response.status_code}")
                return None

            print(f"[PriceCompare] TTS audio received: {len(tts_response.content)} bytes")
            return tts_response.content

    except Exception as e:
        print(f"[PriceCompare] Exception: {e}")
        return None


# =============================================================================
# Video Call Functions
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
        play_audio_file("Calling.wav")
        
        resp = requests.post(
            f"{BACKEND_URL}/api/call/request-volunteer",
            headers=headers,
            timeout=10,
        )
        data = resp.json()
        
        if not data.get("success"):
            print("❌ [VideoCall] No volunteers available")
            play_audio_file("Interaction_fail.wav")
            return False
        
        room_id = data["roomID"]
        volunteer = data["volunteer"]
        print(f"✅ [VideoCall] Volunteer: {volunteer['username']}")

        # ===== Wait for volunteer to answer =====
        print("[VideoCall] Waiting for volunteer to answer...")
        answered = False
        wait_start = time.time()
        ANSWER_TIMEOUT_SEC = 60

        while time.time() - wait_start < ANSWER_TIMEOUT_SEC:
            try:
                status_resp = requests.get(
                    f"{BACKEND_URL}/api/call/status",
                    params={"roomID": room_id},
                    headers=headers,
                    timeout=5,
                )

                if status_resp.status_code == 200:
                    status = status_resp.json().get("status")
                    if status == "active":
                        answered = True
                        break
                elif status_resp.status_code == 404:
                    # Rejected/ended before answering
                    print("[VideoCall] Call ended before answer")
                    play_audio_file("Interaction_fail.wav")
                    return False
            except Exception:
                # Temporary network hiccup; keep polling
                pass

            await asyncio.sleep(1)

        if not answered:
            print("[VideoCall] Timeout waiting for answer")
            play_audio_file("Interaction_fail.wav")
            return False
        
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
            main={"size": (VIDEO_WIDTH, VIDEO_HEIGHT), "format": "XBGR8888"},
            transform=Transform(hflip=1, vflip=1)
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
        play_audio_file("Call_accepted.wav")
        
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
        end_call_event = threading.Event()

        # Prefer edge detection so brief touches reliably end the call
        if GPIO:
            try:
                def _end_call_cb(_channel):
                    if not end_call_event.is_set():
                        print("[VideoCall] Touch detected (event) - ending call...")
                        end_call_event.set()

                GPIO.add_event_detect(
                    TOUCH_SENSOR_PIN,
                    GPIO.RISING,
                    callback=_end_call_cb,
                    bouncetime=250,
                )
            except Exception as e:
                print(f"[VideoCall] GPIO event detect setup failed: {e}")
        
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
                
                # End call requested via touch
                if end_call_event.is_set():
                    await asyncio.sleep(0.05)
                    call_active = False
                    continue

                # Fallback polling (in case edge detection isn't available)
                if GPIO and not end_call_event.is_set():
                    try:
                        if GPIO.input(TOUCH_SENSOR_PIN) == GPIO.HIGH:
                            print("[VideoCall] Touch detected (poll) - ending call...")
                            await asyncio.sleep(0.2)  # Debounce (non-blocking)
                            call_active = False
                    except Exception:
                        pass
                
                # In simulation mode, call continues until Ctrl+C (or add a key listener if needed)
                
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

        if GPIO:
            try:
                GPIO.remove_event_detect(TOUCH_SENSOR_PIN)
            except Exception:
                pass
        
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
            
        play_audio_file("Call_Ended.wav")
        
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
        
        # Step 2: Speech-to-text via FastAPI
        transcribed_text = speech_to_text(recording_path)
        
        if transcribed_text is None:
            print("[Workflow] Speech-to-text failed")
            return False
        
        # Step 3: Send text to /pi_intent for intent detection
        intent_data = send_text_to_intent(transcribed_text)
        
        if intent_data is None:
            print("[Workflow] Intent detection failed")
            return False
        
        action_command = intent_data.get('action_command', '')
        
        # Step 3: Handle command-specific actions
        audio_response = None
        
        if action_command == "CAPTURE_PRODUCT_IMAGE":
            print("[Workflow] Product identification requested")
            
            # Create temp file for image
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp_img:
                image_path = tmp_img.name
            
            # Capture image
            print("[Workflow] Capturing product image...")
            if not capture_image(image_path):
                print("[Workflow] Image capture failed")
                return False
            
            # Send image to identify-product endpoint
            print("[Workflow] Sending image for identification...")
            audio_response = send_image_to_product_identification(image_path)
            
            if audio_response is None:
                print("[Workflow] Product identification failed")
                return False

        elif action_command == "CAPTURE_ENVIRONMENT":
            print("[Workflow] Scene description requested")
            
            # Create temp file for image
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp_img:
                image_path = tmp_img.name
            
            # Capture image
            print("[Workflow] Capturing scene image...")
            if not capture_image(image_path):
                print("[Workflow] Image capture failed")
                return False
            
            # Send image to describe-scene endpoint
            print("[Workflow] Sending image for scene description...")
            audio_response = send_image_to_scene_description(image_path)
            
            if audio_response is None:
                print("[Workflow] Scene description failed")
                return False

        elif action_command == "CAPTURE_MEDICAL_IMAGE":
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
        
        elif action_command == "CAPTURE_CURRENCY_IMAGE":
            print("[Workflow] Currency recognition requested")
            
            # Create temp file for image
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp_img:
                image_path = tmp_img.name
            
            # Capture image
            print("[Workflow] Capturing currency image...")
            if not capture_image(image_path):
                print("[Workflow] Image capture failed")
                return False
            
            # Send image to currency recognition and get TTS audio
            print("[Workflow] Sending image for currency recognition...")
            audio_response = send_image_to_currency_recognition(image_path)
            
            if audio_response is None:
                print("[Workflow] Currency recognition failed")
                return False
        
        elif action_command == "CAPTURE_SHELF_IMAGE":
            print("[Workflow] Product finding requested")
            
            # Create temp file for image
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp_img:
                image_path = tmp_img.name
            
            # Capture image
            print("[Workflow] Capturing shelf image...")
            if not capture_image(image_path):
                print("[Workflow] Image capture failed")
                return False
            
            # Send image + text to find-product
            print("[Workflow] Sending image for analysis...")
            query_text = transcribed_text
            audio_response = send_image_to_find_product(image_path, query_text)
            
            if audio_response is None:
                print("[Workflow] Product finding failed")
                return False

        elif action_command == "CAPTURE_PRICE_IMAGE":
            print("[Workflow] Price comparison requested")
            
            # Create temp file for image
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp_img:
                image_path = tmp_img.name
            
            # Capture image
            print("[Workflow] Capturing product image for price comparison...")
            if not capture_image(image_path):
                print("[Workflow] Image capture failed")
                return False
            
            # Send image to compare endpoint
            print("[Workflow] Sending image for price analysis...")
            audio_response = send_image_to_price_comparison(image_path)
            
            if audio_response is None:
                print("[Workflow] Price comparison failed")
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
        
        elif action_command == "AI_CONVERSATION":
            print("[Workflow] AI conversation detected")
            
            # Get AI response text from server
            ai_response_text = intent_data.get('ai_response')
            
            if not ai_response_text:
                print("[Workflow] No AI response text received")
                return False
            
            print(f"[Workflow] AI response: {ai_response_text}")
            
            # Convert to audio via FastAPI TTS
            TTS_API = f"{FASTAPI_URL}/tts"
            print("[Workflow] Converting AI response to audio...")
            
            try:
                tts_response = requests.post(
                    TTS_API,
                    json={"text": ai_response_text},
                    timeout=30
                )
                
                if tts_response.status_code != 200:
                    print(f"[Workflow] TTS failed: HTTP {tts_response.status_code}")
                    return False
                
                audio_response = tts_response.content
                print(f"[Workflow] TTS audio received: {len(audio_response)} bytes")
                
            except Exception as e:
                print(f"[Workflow] TTS error: {e}")
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


def login():
    """Prompt for credentials and authenticate with the server."""
    global AUTH_TOKEN
    
    print("\n[Login] Please enter your credentials")
    username = input("  Username: ").strip()
    password = input("  Password: ").strip()
    
    if not username or not password:
        print("[Login] Username and password are required")
        return False
    
    try:
        print(f"[Login] Authenticating as '{username}'...")
        response = requests.post(
            LOGIN_ENDPOINT,
            json={"username": username, "password": password},
            timeout=15
        )
        
        if response.status_code != 200:
            print(f"[Login] Failed: HTTP {response.status_code}")
            try:
                print(f"[Login] {response.json().get('message', '')}")
            except:
                pass
            return False
        
        data = response.json()
        AUTH_TOKEN = data.get('token')
        user = data.get('user', {})
        
        print(f"[Login] ✅ Logged in as {user.get('username', username)} ({user.get('role', 'unknown')})")
        return True
        
    except requests.exceptions.ConnectionError:
        print(f"[Login] Connection error - is the server running at {SERVER_URL}?")
        return False
    except Exception as e:
        print(f"[Login] Error: {e}")
        return False


def main():
    """Main entry point - runs the touch-triggered loop."""
    print("=" * 60)
    print("  PERCEIVA - Assistive Wearable Audio Client")
    print("=" * 60)
    print(f"Server: {SERVER_URL}")
    print(f"Audio Device: {AUDIO_DEVICE}")
    print(f"Touch Sensor: GPIO{TOUCH_SENSOR_PIN}")
    print("-" * 60)
    
    # Login
    if not login():
        print("[Main] Login failed. Exiting.")
        return
    
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
