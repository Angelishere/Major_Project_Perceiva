// index.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { generateToken04 } = require("./zegoToken");

const app = express();

// Middlewares
app.use(cors()); // allow all origins for dev; tighten in production
app.use(bodyParser.json({ limit: "10kb" }));

// Health
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Token endpoint
app.post("/api/zego/token", (req, res) => {
  try {
    const roomID = (req.body && req.body.roomID) || "defaultRoom";

    const appID = Number(process.env.ZEGO_APP_ID);
    const serverSecret = process.env.ZEGO_SERVER_SECRET;
    const expire = Number(process.env.ZEGO_TOKEN_EXPIRES) || 3600;
    const userID = "user_" + uuidv4(); // less predictable

    if (!appID || !serverSecret) {
      return res.status(500).json({ error: "Missing ZEGO_APP_ID or ZEGO_SERVER_SECRET" });
    }

    const token = generateToken04(appID, userID, serverSecret, expire);
    const tokenStr = token.toString ? token.toString() : String(token);
    
    console.log("Token generated:", {
      appID,
      userID,
      tokenType: typeof token,
      tokenLength: tokenStr.length,
      tokenPreview: tokenStr.slice(0, 80),
      tokenFull: tokenStr, // Log full token for debugging
      roomID
    });

    return res.json({
      appID,
      userID,
      token: tokenStr,
      roomID
    });
  } catch (err) {
    console.error("Token generation error:", err);
    return res.status(500).json({ error: "internal_error", details: err.message });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Zego token server running on port ${port}`);
});
