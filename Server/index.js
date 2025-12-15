// index.js
import bodyParser from "body-parser";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { generateToken04 } from "./zegoToken.js";
import jwt from "jsonwebtoken";


import mongoose from "mongoose";
import express from "express";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();


import User from "./models/Users.model.js"

const app = express();
app.use(express.json());
app.use(cors()); // allow all origins for dev; tighten in production
app.use(bodyParser.json({ limit: "10kb" }));

const MONGOURI= process.env.MONGOURI
mongoose.connect(MONGOURI).then(
  ()=>{
    console.log("Connected to Mongodb successfully")
  }
).catch(
  (Error)=>{console.error(Error)}
)


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

app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // basic presence check
    if (!username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // check if user already exists
    const existingUser = await User.findOne({
      $or: [{ username }, { email }]
    });

    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // create user
    await User.create({
      username,
      email,
      password: hashedPassword,
      lastLogin: null
    });

    res.status(201).json({ message: "User registered successfully" });
    console.log(`Account created for username: "${username}"`);

  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // basic check
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    // find user by username (or email if you want later)
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // update last login
    user.lastLogin = new Date();
    await user.save();

    // generate JWT
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || "1h" }
    );

    // response
    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        lastLogin: user.lastLogin
      }
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});


const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Zego token server running on port ${port}`);
});
