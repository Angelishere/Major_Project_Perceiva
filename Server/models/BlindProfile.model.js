import mongoose from "mongoose";

const BlindProfileSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true
        },
        allergies: {
            type: [String],
            default: []
        },
        medicalConditions: {
            type: [String],
            default: []
        },
        dietaryPreferences: {
            type: [String],
            default: [] 
        },
        language: {
            type: String,
            default: "en"
        },
        audioSpeed: {
            type: Number,
            default: 1.0
        }
    },
    { timestamps: true }
)