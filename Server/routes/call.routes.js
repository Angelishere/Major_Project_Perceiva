import express from "express";
import User from "../models/Users.model.js";
import { generateToken04 } from "../zegoToken.js";
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
      "username email _id"
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

// Get room + Zego token for a call
router.post("/get-room", authenticateToken, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.user.userId;

    if (!targetUserId) {
      return res.status(400).json({ error: "targetUserId required" });
    }

    // Generate deterministic room ID
    const roomID = generateRoomId(currentUserId, targetUserId);

    // Get Zego token
    const appID = Number(process.env.ZEGO_APP_ID);
    const serverSecret = process.env.ZEGO_SERVER_SECRET;
    const expire = Number(process.env.ZEGO_TOKEN_EXPIRES) || 3600;

    const token = generateToken04(appID, currentUserId, serverSecret, expire);

    res.json({
      roomID,
      appID,
      userID: currentUserId,
      token,
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
    activeCalls.delete(roomID);
    res.json({ success: true, message: "Call ended" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;