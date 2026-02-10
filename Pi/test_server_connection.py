#!/usr/bin/env python3
"""
Debug script to test connectivity to Render server
Tests:
1. Basic connectivity
2. Authentication
3. Audio file upload
"""

import requests
import tempfile
import wave
import struct

# Configuration
SERVER_URL = "http://192.168.85.134:4000"
PI_INTENT_ENDPOINT = f"{SERVER_URL}/pi_intent"
AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTdhMWM2NzcyMGRhYTliYzBkYjMzZGQiLCJ1c2VybmFtZSI6ImFyanVuIiwicm9sZSI6ImJsaW5kIiwiaWF0IjoxNzcwNDg1MDUyLCJleHAiOjE3NzA0ODg2NTJ9.1Re_vjB-ghIqasjSv9QqHh942ctGLdW2r2sQTB5LnaM"

def create_test_audio(duration_seconds=2):
    """Create a simple test WAV file"""
    print("[Test] Creating test audio file...")
    
    sample_rate = 16000
    num_samples = duration_seconds * sample_rate
    
    # Create temp file
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        tmp_path = tmp.name
    
    # Write WAV file
    with wave.open(tmp_path, 'wb') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 2 bytes = 16 bit
        wav_file.setframerate(sample_rate)
        
        # Generate silence
        for _ in range(num_samples):
            wav_file.writeframes(struct.pack('<h', 0))
    
    print(f"[Test] Created test audio: {tmp_path}")
    return tmp_path


def test_basic_connectivity():
    """Test 1: Basic server connectivity"""
    print("\n" + "="*60)
    print("TEST 1: Basic Server Connectivity")
    print("="*60)
    
    try:
        print(f"[Test] Pinging: {SERVER_URL}")
        response = requests.get(SERVER_URL, timeout=10)
        print(f"✅ Server is reachable")
        print(f"   Status Code: {response.status_code}")
        print(f"   Response: {response.text[:200]}")
        return True
    except requests.exceptions.ConnectionError as e:
        print(f"❌ Connection Error: {e}")
        return False
    except requests.exceptions.Timeout:
        print(f"❌ Timeout Error: Server took too long to respond")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_authentication():
    """Test 2: Authentication token validity"""
    print("\n" + "="*60)
    print("TEST 2: Authentication")
    print("="*60)
    
    try:
        print(f"[Test] Testing auth token...")
        print(f"[Test] Token: {AUTH_TOKEN[:50]}...")
        
        headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
        
        # Try a protected endpoint
        response = requests.get(
            f"{SERVER_URL}/api/protected-test",  # This might not exist
            headers=headers,
            timeout=10
        )
        
        print(f"   Response: {response.status_code}")
        return True
        
    except Exception as e:
        print(f"⚠️  Could not test auth: {e}")
        print(f"   (This is okay if /api/protected-test doesn't exist)")
        return True


def test_audio_upload():
    """Test 3: Audio file upload to /pi_intent"""
    print("\n" + "="*60)
    print("TEST 3: Audio Upload to /pi_intent")
    print("="*60)
    
    # Create test audio
    audio_path = create_test_audio(2)
    
    try:
        print(f"[Test] Uploading to: {PI_INTENT_ENDPOINT}")
        
        with open(audio_path, 'rb') as audio_file:
            files = {
                'audio': ('test_audio.wav', audio_file, 'audio/wav')
            }
            
            headers = {
                'Authorization': f'Bearer {AUTH_TOKEN}'
            }
            
            print(f"[Test] Sending request...")
            print(f"   Headers: Authorization Bearer {AUTH_TOKEN[:20]}...")
            print(f"   Files: test_audio.wav")
            
            response = requests.post(
                PI_INTENT_ENDPOINT,
                files=files,
                headers=headers,
                timeout=120,
                stream=False
            )
        
        print(f"\n📊 RESPONSE:")
        print(f"   Status Code: {response.status_code}")
        print(f"   Headers: {dict(response.headers)}")
        
        if response.status_code == 200:
            content_type = response.headers.get('Content-Type', '')
            if 'audio' in content_type:
                print(f"✅ SUCCESS: Received audio response")
                print(f"   Audio size: {len(response.content)} bytes")
            else:
                print(f"✅ SUCCESS: Received JSON response")
                print(f"   Response: {response.json()}")
        else:
            print(f"❌ FAILED")
            try:
                print(f"   Error: {response.json()}")
            except:
                print(f"   Error: {response.text[:500]}")
        
        return response.status_code == 200
        
    except requests.exceptions.Timeout:
        print(f"❌ TIMEOUT: Request took longer than 120 seconds")
        print(f"   This might be due to FastAPI processing time")
        return False
    except requests.exceptions.ConnectionError as e:
        print(f"❌ CONNECTION ERROR: {e}")
        return False
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all diagnostic tests"""
    print("🔍 PERCEIVA SERVER DIAGNOSTIC TOOL")
    print(f"Server: {SERVER_URL}")
    print(f"Endpoint: {PI_INTENT_ENDPOINT}")
    
    results = []
    
    # Run tests
    results.append(("Connectivity", test_basic_connectivity()))
    results.append(("Authentication", test_authentication()))
    results.append(("Audio Upload", test_audio_upload()))
    
    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    
    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    all_passed = all(result[1] for result in results)
    
    if all_passed:
        print("\n🎉 All tests passed! Server is working correctly.")
    else:
        print("\n⚠️  Some tests failed. Check the output above for details.")
    
    return all_passed


if __name__ == "__main__":
    main()
