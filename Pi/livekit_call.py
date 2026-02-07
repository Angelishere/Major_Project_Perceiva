"""
Perceiva - Pi Camera + INMP441 Audio to LiveKit
Optimized for Raspberry Pi Zero 2 W
"""

import asyncio
import subprocess
import requests
import numpy as np
import pyaudio
from livekit import rtc
from picamera2 import Picamera2

# ================= CONFIG =================
BACKEND_URL = "https://major-project-perceiva.onrender.com"
AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTdhMWM2NzcyMGRhYTliYzBkYjMzZGQiLCJ1c2VybmFtZSI6ImFyanVuIiwicm9sZSI6ImJsaW5kIiwiaWF0IjoxNzcwNDMyMDgxLCJleHAiOjE3NzA0MzU2ODF9.ImMKJp75pIJbCosMavOwZvXXEiaX-ajRJy5YRz0kgUk"

WIDTH, HEIGHT = 960, 540
FPS = 24

AUDIO_RATE = 16000
AUDIO_CHANNELS = 2          # googlevoicehat exposes stereo
AUDIO_CHUNK = 320           # 20ms @ 16kHz

# ==========================================

# Global audio player (PulseAudio -> Bluetooth)
audio_player = None

async def capture_audio(audio_source):
    """INMP441 -> LiveKit"""
    pa = pyaudio.PyAudio()

    stream = pa.open(
        format=pyaudio.paInt16,
        channels=AUDIO_CHANNELS,
        rate=AUDIO_RATE,
        input=True,
        frames_per_buffer=AUDIO_CHUNK,
    )

    print("🎤 INMP441 mic started")

    try:
        while True:
            data = stream.read(AUDIO_CHUNK, exception_on_overflow=False)

            frame = rtc.AudioFrame(
                data=data,
                sample_rate=AUDIO_RATE,
                num_channels=AUDIO_CHANNELS,
                samples_per_channel=AUDIO_CHUNK,
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
        stderr=subprocess.DEVNULL
    )
    print("🔊 Bluetooth audio player started")


def on_audio_track(track, publication, participant):
    """Remote audio -> Bluetooth (A2DP)"""
    print(f"🔊 Receiving audio from {participant.identity}")

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


async def main():
    print(f"🎥 Perceiva Pi Client ({WIDTH}x{HEIGHT})")

    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}

    # ===== Request volunteer =====
    resp = requests.post(
        f"{BACKEND_URL}/api/call/request-volunteer",
        headers=headers,
        timeout=10,
    )
    data = resp.json()
    if not data.get("success"):
        print("❌ No volunteers available")
        return

    room_id = data["roomID"]
    volunteer = data["volunteer"]
    print(f"✅ Volunteer: {volunteer['username']}")

    # ===== Get LiveKit token =====
    resp = requests.post(
        f"{BACKEND_URL}/api/call/get-room",
        json={"targetUserId": volunteer["_id"]},
        headers=headers,
        timeout=10,
    )
    lk = resp.json()
    livekit_url, token = lk["livekitUrl"], lk["token"]

    # ===== Camera =====
    picam = Picamera2()
    config = picam.create_preview_configuration(
        main={"size": (WIDTH, HEIGHT), "format": "XBGR8888"}
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

    print("🔗 Connecting to LiveKit...")
    await room.connect(livekit_url, token)
    print("✅ Connected")
    
    # Start Bluetooth audio player
    start_bluetooth_player()

    # ===== Publish video =====
    video_source = rtc.VideoSource(WIDTH, HEIGHT)
    video_track = rtc.LocalVideoTrack.create_video_track(
        "pi_cam", video_source
    )

    await room.local_participant.publish_track(
        video_track,
        rtc.TrackPublishOptions(
            source=rtc.TrackSource.SOURCE_CAMERA,
            video_encoding=rtc.VideoEncoding(
                max_bitrate=1_500_000,
                max_framerate=FPS,
            ),
        ),
    )
    print("📷 Video streaming")

    # ===== Publish audio =====
    audio_source = rtc.AudioSource(AUDIO_RATE, AUDIO_CHANNELS)
    audio_track = rtc.LocalAudioTrack.create_audio_track(
        "inmp441", audio_source
    )

    await room.local_participant.publish_track(
        audio_track,
        rtc.TrackPublishOptions(
            source=rtc.TrackSource.SOURCE_MICROPHONE
        ),
    )
    print("🎤 Audio streaming")

    asyncio.create_task(capture_audio(audio_source))

    # ===== Main loop =====
    try:
        while True:
            frame = picam.capture_array()

            video_source.capture_frame(
                rtc.VideoFrame(
                    WIDTH,
                    HEIGHT,
                    rtc.VideoBufferType.RGBA,
                    frame.tobytes(),
                )
            )

            await asyncio.sleep(1 / FPS)

    except KeyboardInterrupt:
        print("⏹️ Stopping...")

    finally:
        # Stop audio player
        global audio_player
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
        
        try:
            requests.post(
                f"{BACKEND_URL}/api/call/end-call",
                json={"roomID": room_id},
                headers=headers,
                timeout=5,
            )
        except:
            pass

        picam.stop()
        await room.disconnect()
        print("👋 Done")


if __name__ == "__main__":
    asyncio.run(main())
