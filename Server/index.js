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
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
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

//testing function for gemini call with search data and the medical history 

async function getConsumabilityAdviceWithGemini({
  productName,
  serpData,
  medicalProfile
}) {
  if (!Array.isArray(serpData) || serpData.length === 0) {
    return {
      isSafe: false,
      advice: "Insufficient ingredient information available",
      risks: []
    };
  }

  // Convert SERP objects into readable text
  const searchText = serpData
    .map(item => item.snippet)
    .filter(Boolean)
    .join("\n\n");

  const prompt = `
You are a qualified medical nutritionist advising a visually impaired patient.

Patient medical history:
- Allergies: ${medicalProfile.allergies.length ? medicalProfile.allergies.join(", ") : "none"}
- Medical conditions: ${medicalProfile.medicalConditions.length ? medicalProfile.medicalConditions.join(", ") : "none"}
- Dietary preferences: ${medicalProfile.dietaryPreferences.length ? medicalProfile.dietaryPreferences.join(", ") : "none"}

Product under consideration:
${productName}

Ingredient-related information from reliable sources (verbatim, unfiltered):
${searchText}

Your task:
Carefully assess whether this product is appropriate for the patient.

Guidelines:
- Base your advice ONLY on the information provided above.
- Do NOT assume or invent ingredients.
- Be medically conservative.
- If there is any meaningful risk, advise against consumption.
- If information is insufficient, clearly say so.

Response style:
- Write as a doctor or clinical nutritionist speaking directly to the patient.
- Use clear, calm, and supportive language.
- Avoid technical jargon.
- Do NOT mention probabilities, percentages, or internal reasoning.
- Do NOT output JSON, bullet points, headings, or labels.

Return ONLY the medical advice.
`;


  try {
    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });

    const rawText = response.text || "";

    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    const jsonText = jsonMatch ? jsonMatch[1] : rawText;

    return JSON.parse(jsonText);

  } catch (err) {
    console.error("❌ Gemini consumability error:", err.message);
    return {
      isSafe: false,
      risks: ["Unable to verify product safety"],
      advice: "Please consult a healthcare professional before consuming"
    };
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

async function identifyUserIntent(transcribedText) {
  const intentPrompt = `You are an intent classifier for a visually impaired user assistance application.
Based on the user's speech, identify which module they want to use.

Available modules:
1. "Product Identification Module" - User wants to identify/know what a product is
2. "Medical Compatibility Module" - User wants to check if a product is safe for them medically (allergies, health conditions)
3. "Price Comparison Module" - User wants to compare prices or find best deals
4. "Volunteer Video Call Module" - User wants to connect with a volunteer for video assistance
5. "AI Assistance Module" - User wants general help, questions, or conversation
6. "Currency Recognition Module" - User wants to identify currency notes or coins, know the denomination of money

Analyze this user speech and respond with ONLY the exact module name from the list above. Nothing else.

User said: "${transcribedText}"`;

  try {
    const intentResponse = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: intentPrompt
    });

    return (intentResponse.text || "AI Assistance Module").trim();
  } catch (error) {
    console.error("[identifyUserIntent] Error:", error.message);
    return "AI Assistance Module";
  }
}

/**
 * Send audio buffer to FastAPI for speech-to-text transcription
 * @param {Buffer} audioBuffer - The audio file buffer
 * @param {string} filename - Original filename
 * @param {string} mimeType - Audio MIME type
 * @returns {Promise<{text: string, error?: string}>}
 */
async function speechToText(audioBuffer, filename = 'audio.wav', mimeType = 'audio/wav') {
  const FormData = (await import('form-data')).default;
  const formData = new FormData();
  formData.append('file', audioBuffer, {
    filename: filename,
    contentType: mimeType
  });

  const fastApiUrl = process.env.FASTAPI_URL || 'http://localhost:8000';
  console.log("[speechToText] Sending to FastAPI:", `${fastApiUrl}/stt-upload`);

  try {
    const response = await axios.post(`${fastApiUrl}/stt-upload`, formData, {
      headers: {
        ...formData.getHeaders()
      },
      timeout: 60000 // 60 second timeout
    });

    const text = response.data?.text;
    console.log("[speechToText] Transcribed:", text);

    if (!text || text === "Error") {
      return { text: null, error: response.data?.error || "No transcription returned" };
    }

    return { text };
  } catch (error) {
    console.error("[speechToText] Error:", error.message);
    return { text: null, error: error.message };
  }
}

/**
 * Send text to FastAPI for text-to-speech synthesis
 * @param {string} text - Text to convert to speech
 * @returns {Promise<{audio: Buffer, error?: string}>}
 */
async function textToSpeech(text) {
  const fastApiUrl = process.env.FASTAPI_URL || 'http://localhost:8000';
  console.log("[textToSpeech] Sending to TTS:", `${fastApiUrl}/tts`);

  try {
    const response = await axios.post(
      `${fastApiUrl}/tts`,
      { text },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer',
        timeout: 120000 // 2 minute timeout
      }
    );

    console.log("[textToSpeech] Audio received, size:", response.data.length);
    return { audio: Buffer.from(response.data) };
  } catch (error) {
    console.error("[textToSpeech] Error:", error.message);
    return { audio: null, error: error.message };
  }
}

app.use("/api/call", callRoutes);
// Health
app.get("/health", (_req, res) => res.json({ status: "ok" }));

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

    res.status(201).json({ message: "User registered successfully", token: token });
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

app.post("/medical-check2", authMiddleware, upload.single("image"), async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).json({
        message: "No image uploaded",
        error: "Image file is required"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ message: "Missing OPENAI_API_KEY" });
    }

    if (!process.env.SERPAPI_KEY) {
      return res.status(500).json({ message: "Missing SERPAPI_KEY" });
    }

    // -----------------------------
    // Decode user from JWT
    // -----------------------------
    const { userId, role } = req.user;

    if (role !== "blind") {
      return res.status(403).json({
        message: "Medical check is only available for blind users"
      });
    }

    // -----------------------------
    // Fetch blind medical profile
    // -----------------------------
    const blindProfile = await BlindProfile.findOne({ user: userId });

    if (!blindProfile) {
      return res.status(404).json({
        message: "Blind medical profile not found"
      });
    }


    const productName = await identifyProductWithGPT(
      req.file.buffer,
      req.file.mimetype || "image/jpeg"
    );

    if (!productName) {
      return res.status(502).json({
        message: "Could not identify product from image"
      });
    }

    console.log("[INFO] GPT identified product:", productName);

    // -----------------------------
    // Fetch raw ingredient data from SerpApi
    // -----------------------------
    const query = `${productName} ingredients and allergens`;
    console.log("[INFO] Querying SerpApi with:", query);

    const serpData = await searchSerpApi(query);

    if (!serpData || serpData.length === 0) {
      return res.status(502).json({
        message: "Failed to retrieve ingredient information"
      });
    }

    // -----------------------------
    // SINGLE Gemini call:
    // raw SERP data + medical history
    // -----------------------------
    console.log("[INFO] Getting consumability advice from Gemini...");

    const aiAdvice = await getConsumabilityAdviceWithGemini({
      productName,
      serpData,
      medicalProfile: blindProfile
    });

    // -----------------------------
    // Final response
    // -----------------------------
    return res.status(200).json({
      message: "Medical check completed successfully",
      product_name: productName,
      medical_profile_used: {
        allergies: blindProfile.allergies,
        medicalConditions: blindProfile.medicalConditions,
        dietaryPreferences: blindProfile.dietaryPreferences
      },
      ai_advice: aiAdvice
    });

  } catch (error) {
    console.error("Medical check error:", error);
    return res.status(500).json({
      message: "Server error during medical check",
      error: error.message
    });
  }
}
);

// Multer config for audio uploads
const audioStorage = multer.memoryStorage();
const audioUpload = multer({
  storage: audioStorage,
  fileFilter: (req, file, cb) => {
    // Accept common audio formats
    const allowedMimes = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg', 'audio/flac', 'audio/m4a', 'audio/x-m4a'];
    if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

app.post("/pi_audio", audioUpload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No audio file uploaded", error: "Audio file is required" });
    }

    console.log("[pi_audio] Received audio file:", req.file.originalname, "Size:", req.file.size);

    // 1) Speech-to-text
    const sttResult = await speechToText(
      req.file.buffer,
      req.file.originalname || 'audio.wav',
      req.file.mimetype || 'audio/wav'
    );

    if (!sttResult.text) {
      return res.status(502).json({
        message: "Speech-to-text failed",
        error: sttResult.error
      });
    }

    const transcribedText = sttResult.text;

    // 2) Identify user intent module
    const detectedModule = await identifyUserIntent(transcribedText);
    console.log("[pi_audio] Detected module:", detectedModule);

    // 3) Generate appropriate response based on detected module
    //     const geminiPrompt = `You are a helpful AI assistant for a visually impaired user.
    // The user's intent has been identified as: ${detectedModule}

    // Respond to the following user query in a clear, concise, and conversational manner.
    // Keep your response brief but helpful. Acknowledge what they want to do and guide them appropriately.

    // User said: "${transcribedText}"`;

    //     const geminiResponse = await gemini.models.generateContent({
    //       model: "gemini-2.5-flash",
    //       contents: geminiPrompt
    //     });

    //     const aiResponse = geminiResponse.text || "";
    //     console.log("[pi_audio] Gemini response:", aiResponse);

    // 4) Text-to-speech
    const ttsResult = await textToSpeech(detectedModule);

    if (!ttsResult.audio) {
      return res.status(502).json({
        message: "Text-to-speech failed",
        error: ttsResult.error
      });
    }

    // 5) Return the audio WAV file with module info in headers
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Disposition': 'inline; filename=response.wav',
      'Content-Length': ttsResult.audio.length,
      'X-Detected-Module': detectedModule,
      'X-Transcribed-Text': encodeURIComponent(transcribedText)
    });

    return res.send(ttsResult.audio);

  } catch (error) {
    console.error("[pi_audio] Error:", error.message);

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        message: "FastAPI service unavailable",
        error: "Could not connect to speech-to-text/TTS service"
      });
    }

    return res.status(500).json({
      message: "Error processing audio",
      error: error.message
    });
  }
})

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`server running on port ${port}`);
});
