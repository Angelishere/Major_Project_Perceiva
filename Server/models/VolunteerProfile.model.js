import mongoose from "mongoose";

const VolunteerProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true
    },
    languages: {
      type: [String],
      default: []
    },
    isAvailable: {
      type: Boolean,
      default: false
    },
    consentGiven: {
      type: Boolean,
      required: true
    }
  },
  { timestamps: true }
);

export default mongoose.model("VolunteerProfile", VolunteerProfileSchema);
