import crypto from "crypto";

// Official Zego Token04 Generator - Using AES-GCM Encryption
// Reference: https://github.com/zegoim/zego_server_assistant/tree/main/token/nodejs/token04

// Generate random nonce (int32 range)
function makeNonce() {
  return Math.floor(Math.random() * 0x7fffffff);
}

// AES-GCM Encryption
function aesGcmEncrypt(plainText, key) {
  // Ensure key is 32 bytes (secret must be 32 characters)
  if (![16, 24, 32].includes(key.length)) {
    throw new Error("Invalid Secret length. Key must be 16, 24, or 32 bytes.");
  }

  // Generate random 12-byte nonce for GCM
  const nonce = crypto.randomBytes(12);

  // Create cipher with GCM mode
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAutoPadding(true);

  const encrypted = cipher.update(plainText, "utf8");
  const encryptBuf = Buffer.concat([
    encrypted,
    cipher.final(),
    cipher.getAuthTag()
  ]);

  return { encryptBuf, nonce };
}

function generateToken04(
  appId,
  userId,
  secret,
  effectiveTimeInSeconds,
  payload = ""
) {
  if (!appId || typeof appId !== "number") {
    throw new Error("appID invalid");
  }

  if (!userId || typeof userId !== "string" || userId.length > 64) {
    throw new Error("userId invalid");
  }

  if (!secret || typeof secret !== "string" || secret.length !== 32) {
    throw new Error("secret must be a 32 byte string");
  }

  if (!(effectiveTimeInSeconds > 0)) {
    throw new Error("effectiveTimeInSeconds invalid");
  }

  const VERSION_FLAG = "04";

  const createTime = Math.floor(Date.now() / 1000);
  const tokenInfo = {
    app_id: appId,
    user_id: userId,
    nonce: makeNonce(),
    ctime: createTime,
    expire: createTime + effectiveTimeInSeconds,
    payload: payload || ""
  };

  // Convert token info to JSON
  const plaintText = JSON.stringify(tokenInfo);
  console.log("Token plaintext:", plaintText);

  // Encrypt using AES-GCM
  const { encryptBuf, nonce } = aesGcmEncrypt(plaintText, secret);

  // Pack binary data: [expire(8)][nonce_len(2)][nonce][encrypt_len(2)][encrypted][mode(1)]
  const b1 = new Uint8Array(8); // expire time
  const b2 = new Uint8Array(2); // nonce length
  const b3 = new Uint8Array(2); // encrypted data length
  const b4 = new Uint8Array(1); // encryption mode (GCM = 1)

  new DataView(b1.buffer).setBigInt64(0, BigInt(tokenInfo.expire), false);
  new DataView(b2.buffer).setUint16(0, nonce.byteLength, false);
  new DataView(b3.buffer).setUint16(0, encryptBuf.byteLength, false);
  new DataView(b4.buffer).setUint8(0, 1); // AesEncryptMode.GCM = 1

  const buf = Buffer.concat([
    Buffer.from(b1),
    Buffer.from(b2),
    Buffer.from(nonce),
    Buffer.from(b3),
    Buffer.from(encryptBuf),
    Buffer.from(b4)
  ]);

  const token = VERSION_FLAG + buf.toString("base64");
  return token;
}

// ES module export
export { generateToken04 };
