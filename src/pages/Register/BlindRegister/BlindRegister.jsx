import React, { useState } from 'react'
import styles from "./BlindRegister.module.css"
import api from "../../../api/api.js"
import { useNavigate } from 'react-router-dom'

const BlindRegister = () => {
  const navigate = useNavigate();

  const [medicalConditions, setMedicalConditions] = useState("");
  const [allergies, setAllergies] = useState("");
  const [dietaryPreferences, setDietaryPreferences] = useState("");
  const [language, setLanguage] = useState("en");
  const [audioSpeed, setAudioSpeed] = useState("1.0");

  const handleSubmit = async (e) => {
  e.preventDefault();

  try {
    await api.put("/api/profile", {
      medicalConditions: medicalConditions
        .split(",")
        .map((i) => i.trim())
        .filter(Boolean),

      allergies: allergies
        .split(",")
        .map((i) => i.trim())
        .filter(Boolean),

      dietaryPreferences: dietaryPreferences
        .split(",")
        .map((i) => i.trim())
        .filter(Boolean),

      language,
      audioSpeed: Number(audioSpeed),
    });

    alert("Profile saved successfully");
    navigate("/blind/home");
  } catch (err) {
    console.error(err);
    alert("Failed to save profile");
  }
};


   return (
    <main className={styles.pageContainer}>
      <section className={styles.loginSection}>

        <header className={styles.loginHeader}>
          <h1>Blind Profile Setup</h1>
          <p>Personalize your Perceiva experience</p>
        </header>

        <form className={styles.loginForm} onSubmit={handleSubmit}>

          {/* Medical Conditions */}
          <div className={styles.formGroup}>
            <label>Medical Conditions</label>
            <input
              type="text"
              placeholder="e.g. Diabetes, BP"
              value={medicalConditions}
              onChange={(e)=>{setMedicalConditions(e.target.value)}}
            />
          </div>

          {/* Allergies */}
          <div className={styles.formGroup}>
            <label>Allergies</label>
            <input
              type="text"
              placeholder="e.g. Nuts, Milk"
              value={allergies}
              onChange={(e)=>{setAllergies(e.target.value)}}
            />
          </div>

          {/* Dietary Preferences */}
          <div className={styles.formGroup}>
            <label>Dietary Preferences</label>
            <input
              type="text"
              placeholder="e.g. Vegetarian, Low Sugar"
              value={dietaryPreferences}
              onChange={(e)=>{setDietaryPreferences(e.target.value)}}
            />
          </div>

          {/* Preferred Language */}
          <div className={styles.formGroup}>
            <label>Preferred Language</label>
            <select value={language} onChange={(e)=>{setLanguage(e.target.value)}}>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="ml">Malayalam</option>
            </select>
          </div>

          {/* Audio Speed */}
          <div className={styles.formGroup}>
            <label>Audio Speed</label>
            <select value={audioSpeed} onChange={(e) => setAudioSpeed(e.target.value)} >
              <option value="0.8">Slow</option>
              <option value="1.0">Normal</option>
              <option value="1.2">Fast</option>
            </select>
          </div>

          <button className={styles.loginButton}>
            Save Blind Profile
          </button>

        </form>



      </section>
    </main>
  )
}

export default BlindRegister