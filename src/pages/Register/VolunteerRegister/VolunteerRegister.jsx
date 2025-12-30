import React, { useState } from "react";
import styles from "./VolunteerRegister.module.css";
import api from "../../../api/api.js"
import { useNavigate } from "react-router-dom";

const VolunteerRegister = () => {
  const navigate = useNavigate();

  const [languages, setLanguages] = useState("");
  const [isAvailable, setIsAvailable] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);

  const handleSubmit = async (e) => {
  e.preventDefault();

  if (!consentGiven) {
    alert("You must give consent to continue");
    return;
  }

  try {
    await api.put("/api/profile", {
      languages: languages
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),

      isAvailable,
      consentGiven,
    });

    alert("Volunteer profile saved");
    navigate("/volunteer/dashboard");
  } catch (err) {
    console.error(err);
    alert("Failed to save profile");
  }
};


  return (
    <main className={styles.pageContainer}>
      <section className={styles.loginSection} aria-labelledby="volunteer-title">

        <header className={styles.loginHeader}>
          <h1 id="volunteer-title">Volunteer Registration</h1>
          <p>Complete your volunteer profile</p>
        </header>

        <form className={styles.loginForm} onSubmit={handleSubmit} >
          <legend className={styles.srOnly}>Volunteer Registration Form</legend>

          {/* Languages */}
          <div className={styles.formGroup}>
            <label htmlFor="languages">Languages Known</label>
            <input
              type="text"
              id="languages"
              placeholder="English, Hindi, Malayalam"
              value={languages}
              onChange={(e)=>{setLanguages(e.target.value)}}
            />
          </div>

          {/* Availability */}
          <div className={styles.checkboxGroup}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={isAvailable} onChange={(e)=>{setIsAvailable(e.target.checked)}}/>
              <span>Available for volunteer calls</span>
            </label>
          </div>

          {/* Consent */}
          <div className={styles.checkboxGroup}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" required checked={consentGiven} onChange={(e)=>{setConsentGiven(e.target.checked)}} />
              <span>I give my consent to participate as a volunteer</span>
            </label>
          </div>

          <button type="submit" className={styles.loginButton}>
            Save Profile
          </button>
        </form>

      </section>
    </main>
  );
};

export default VolunteerRegister;