import express from "express";
import User from "../models/Users.model.js";
import { AccessToken } from "livekit-server-sdk";
import jwt from "jsonwebtoken";
import VolunteerProfile from "../models/VolunteerProfile.model.js";

const router = express.Router();

// Middleware to verify JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = user; // Contains { userId, email }
    next();
  });
}

// Get list of all users (for user selection)
router.get("/users", authenticateToken, async (req, res) => {
  try {
    const users = await User.find(
      { _id: { $ne: req.user.userId } }, // Exclude current user
      "username email _id role"
    );
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate deterministic room ID for two users
function generateRoomId(userId1, userId2) {
  const ids = [userId1, userId2].sort();
  return `call_${ids[0]}_${ids[1]}`;
}

// Get room + LiveKit token for a call
router.post("/get-room", authenticateToken, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.user.userId;

    if (!targetUserId) {
      return res.status(400).json({ error: "targetUserId required" });
    }

    // Generate deterministic room ID
    const roomID = generateRoomId(currentUserId, targetUserId);

    // Generate LiveKit token
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    const at = new AccessToken(apiKey, apiSecret, {
      identity: currentUserId,
      ttl: "1h",
    });
    at.addGrant({ roomJoin: true, room: roomID, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();

    res.json({
      roomID,
      userID: currentUserId,
      token,
      livekitUrl,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Simple in-memory call state (for notifications)
const activeCalls = new Map(); // roomID -> { caller, callee, status }

// Initiate a call (caller side)
router.post("/initiate-call", authenticateToken, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const callerId = req.user.userId;

    const roomID = generateRoomId(callerId, targetUserId);

    // Store call state
    activeCalls.set(roomID, {
      caller: callerId,
      callee: targetUserId,
      status: "ringing",
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      roomID,
      message: "Call initiated"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Request available volunteer (atomic lock)
router.post("/request-volunteer", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "blind") {
      return res.status(403).json({ message: "Only blind users allowed" });
    }

    const volunteer = await VolunteerProfile.findOneAndUpdate(
      { isAvailable: true, consentGiven: true },
      { isAvailable: false },
      { new: true }
    ).populate("user", "username email _id");

    if (!volunteer) {
      return res.status(404).json({ message: "No volunteers available" });
    }

    const blindId = req.user.userId;
    const volunteerId = volunteer.user._id.toString();
    const roomID = generateRoomId(blindId, volunteerId);

    activeCalls.set(roomID, {
      caller: blindId,
      callee: volunteerId,
      status: "ringing",
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      roomID,
      volunteer: {
        _id: volunteerId,
        username: volunteer.user.username,
        email: volunteer.user.email,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check for incoming calls (polling endpoint)
router.get("/check-calls", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Find calls where user is the callee
    const incomingCalls = [];
    for (const [roomID, call] of activeCalls.entries()) {
      if (call.callee === userId && call.status === "ringing") {
        // Get caller info
        const caller = await User.findById(call.caller, "username email");
        incomingCalls.push({
          roomID,
          caller: {
            id: call.caller,
            username: caller?.username,
            email: caller?.email,
          },
          timestamp: call.timestamp,
        });
      }
    }

    res.json({ incomingCalls });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Answer call
router.post("/answer-call", authenticateToken, async (req, res) => {
  try {
    const { roomID } = req.body;
    const call = activeCalls.get(roomID);

    if (!call) {
      return res.status(404).json({ error: "Call not found" });
    }

    call.status = "active";
    res.json({ success: true, message: "Call answered" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// End call
router.post("/end-call", authenticateToken, async (req, res) => {
  try {
    const { roomID } = req.body;
    const call = activeCalls.get(roomID);

    if (call) {
      // Free the volunteer
      await VolunteerProfile.findOneAndUpdate(
        { user: call.callee },
        { isAvailable: true }
      );
    }

    activeCalls.delete(roomID);
    res.json({ success: true, message: "Call ended" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;