// index.js
import bodyParser from "body-parser";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { generateToken04 } from "./zegoToken.js";
import callRoutes from "./routes/call.routes.js";
import jwt from "jsonwebtoken";
import OpenAI from "openai";
import multer from "multer";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import mongoose from "mongoose";
import express from "express";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";


import User from "./models/Users.model.js"
import BlindProfile from "./models/BlindProfile.model.js";
import VolunteerProfile from "./models/VolunteerProfile.model.js";

dotenv.config({ override: true });

const k = process.env.OPENAI_API_KEY;
console.log(
  "RAW:", k,
  "CHARS:", [...k].map(c => c.charCodeAt(0))
);

const app = express();
app.use(express.json());
app.use(cors()); // allow all origins for dev; tighten in production
app.use(bodyParser.json({ limit: "10kb" }));

const MONGOURI = process.env.MONGOURI
mongoose.connect(MONGOURI).then(
  () => {
    console.log("Connected to Mongodb successfully")
  }
).catch(
  (Error) => { console.error(Error) }
)
const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, role, username }
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

const storage = multer.memoryStorage();
const upload = multer(
  {
    storage,
    fileFilter: (req,file,cb)=>{
      if (file.mimetype.startsWith('image/')){
        cb(null, true);
      }
      else {
        cb(new Error('Only image files are allowed'), false)
      }

    }
  }
)

async function extractIngredientsWithGemini(serpData) {
  if (!Array.isArray(serpData) || serpData.length === 0) {
    return { ingredients: [], allergens: [], warnings: [] };
  }

  // 1) Convert SERP objects into readable text
  const searchText = serpData
    .map(item => item.snippet)
    .filter(Boolean)
    .join("\n\n");

  const prompt = `
Extract ingredients and common allergens from the text below.
Do not invent items.

Return JSON only in this format:
{
  "ingredients": [],
  "allergens": [],
  "warnings": []
}

Text:
${searchText}
`;

  try {
    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });

    const rawText = response.text || "";
    console.log("[Gemini RAW]", rawText);

    if (!rawText) {
      return { ingredients: [], allergens: [], warnings: [] };
    }

    // 2) Strip markdown fences if present
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    const jsonText = jsonMatch ? jsonMatch[1] : rawText;

    // 3) Parse the correct variable
    return JSON.parse(jsonText);

  } catch (err) {
    console.error("❌ Gemini extraction error:", err.message);
    return { ingredients: [], allergens: [], warnings: [] };
  }
}





async function searchSerpApi(query) {
  const params = {
    engine: "google_ai_mode",
    q: query,
    api_key: process.env.SERPAPI_KEY
  };

  try {
    const response = await axios.get('https://serpapi.com/search', { params });
    console.log("Results from SerpApi:", response.data.text_blocks);
    return response.data.text_blocks;
  } catch (error) {
    console.error("❌ Error contacting SerpApi:", error.message);
    return null;
  }
}


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function identifyProductWithGPT(imageBuffer, mimeType) {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const base64 = imageBuffer.toString("base64");
  const prompt = "Look at the product photo and reply with ONLY the brand and exact product name. No other text.";

  const resp = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt
          },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${base64}`
          }
        ]
      }
    ]
  });

  const text = resp.output_text || "";
  return text.trim().replace(/^["']|["']$/g, "");
}

app.use("/api/call", callRoutes);
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
    const { name, username, email, password, role } = req.body;

    // basic presence check
    if (!name || !username || !email || !password || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }
    const allowedRoles = ["blind", "volunteer"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
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
    const user = await User.create({
      name,
      username,
      email,
      password: hashedPassword,
      role,
      lastLogin: null
    });

    if (role === "blind") {
      await BlindProfile.create({
        user: user._id
      });
      console.log(`Blind Profile Create for  "${username}"`);

    }

    if (role === "volunteer") {
      await VolunteerProfile.create({
        user: user._id,
        consentGiven: false   // force explicit consent later
      });
      console.log(`Volunteer Profile Create for  "${username}"`);

    }

    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || "1h" }
    );

    res.status(201).json({ message: "User registered successfully", token:token });
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
      { userId: user._id, username: user.username, role: user.role },
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
        role: user.role,
        lastLogin: user.lastLogin
      }
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/profile", authMiddleware, async (req, res) => {
  try {
    const { userId, role } = req.user;

    if (role === "blind") {
      const profile = await BlindProfile.findOne({ user: userId });
      return res.json(profile);
    }

    if (role === "volunteer") {
      const profile = await VolunteerProfile.findOne({ user: userId });
      return res.json(profile);
    }

    return res.status(400).json({ message: "Invalid role" });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/profile", authMiddleware, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const updates = req.body;

    if (role === "blind") {
      const updatedProfile = await BlindProfile.findOneAndUpdate(
        { user: userId },
        updates,
        { new: true, runValidators: true }
      );
      return res.json(updatedProfile);
    }

    if (role === "volunteer") {
      const updatedProfile = await VolunteerProfile.findOneAndUpdate(
        { user: userId },
        updates,
        { new: true, runValidators: true }
      );
      return res.json(updatedProfile);
    }

    return res.status(400).json({ message: "Invalid role" });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ message: "Server error" });
  }
});


app.post("/medical-check", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded", error: "Image file is required" });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ message: "Missing OPENAI_API_KEY" });
    }
    if (!process.env.SERPAPI_KEY) {
      return res.status(500).json({ message: "Missing SERPAPI_KEY" });
    }

    // 1) Let GPT name the product from the image
    const productName = await identifyProductWithGPT(req.file.buffer, req.file.mimetype || "image/jpeg");
    if (!productName) {
      return res.status(502).json({ message: "Could not identify product from image" });
    }

    // 2) Fetch ingredient info via SerpApi
    const query = `${productName} ingredients and contain any allergens?`;
    console.log("[INFO] GPT identified:", productName);
    console.log("[INFO] Querying SerpApi with:", query);

    const data = await searchSerpApi(query);
    if (!data) {
      return res.status(502).json({ message: "Failed to retrieve ingredient information", error: "No data from SerpApi" });
    }

    // 3) Extract ingredients/allergens using Gemini
    console.log("[INFO] Extracting ingredients with Gemini...");
    const result = await extractIngredientsWithGemini(data, productName);

    return res.status(200).json({
      message: "Medical check completed successfully",
      product_name: productName,
      ingredients: result.ingredients,
      allergens: result.allergens,
      warnings: result.warnings,
      summary: {
        total_ingredients: result.total_ingredients,
        allergens_detected: result.allergen_count
      }
    });
  } catch (error) {
    console.error("Medical check error:", error);
    res.status(500).json({ message: "Server error during medical check", error: error.message });
  }
});


app.post("/identify-product", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded", error: "Image file is required" });
    }
  

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    

    const mimeType = req.file.mimetype || "image/jpeg";
    const base64 = req.file.buffer.toString("base64");
    const prompt = "which product is this, just answer the name of it";

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${base64}`
            }
          ]
        }
      ]
    });

    const productName = (resp.output_text || "").trim().replace(/^["']|["']$/g, "");

    if (!productName) {
      return res.status(502).json({ message: "Could not identify product from image" });
    }

    return res.status(200).json({
      message: "Product identified successfully",
      product_name: productName,
      usage: resp.usage
    });
  } catch (error) {
    console.error("Identify product error:", error);
    res.status(500).json({ message: "Server error during product identification", error: error.message });
  }
});

// Add this AFTER line 238 (after the identifyProductWithGPT function)
// Temporary debug route - remove after fixing
app.get("/debug-openai", async (req, res) => {
  try {
    const envKey = process.env.OPENAI_API_KEY;
    const client = new OpenAI({ apiKey: envKey });

    // Try to list models to test the key
    const models = await client.models.list();
    
    return res.json({
      success: true,
      env_key_preview: envKey ? `${envKey.substring(0, 20)}...${envKey.slice(-10)}` : "MISSING",
      env_key_length: envKey?.length,
      hardcoded_key_length: 164, // Your hardcoded key length
      keys_match: envKey?.length === 164,
      api_test: "✅ API key works - models retrieved",
      model_count: models.data.length,
      all_env_vars: {
        OPENAI_API_KEY: envKey ? "SET" : "MISSING",
        OPENAI_ORG_ID: process.env.OPENAI_ORG_ID || "not set",
        OPENAI_PROJECT: process.env.OPENAI_PROJECT || "not set"
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      env_key_preview: process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 20)}...` : "MISSING",
      env_key_length: process.env.OPENAI_API_KEY?.length,
      all_env_vars: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "SET" : "MISSING",
        OPENAI_ORG_ID: process.env.OPENAI_ORG_ID || "not set",
        OPENAI_PROJECT: process.env.OPENAI_PROJECT || "not set"
      }
    });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Zego token server running on port ${port}`);
});
