import React from 'react'
import styles from "./BlindRegister.module.css"

const BlindRegister = () => {
  return (
    <main className={styles.pageContainer}>
      <section className={styles.loginSection}>

        <header className={styles.loginHeader}>
          <h1>Blind Profile Setup</h1>
          <p>Personalize your Perceiva experience</p>
        </header>

        <form className={styles.loginForm}>

          {/* Medical Conditions */}
          <div className={styles.formGroup}>
            <label>Medical Conditions</label>
            <input
              type="text"
              placeholder="e.g. Diabetes, BP"
            />
          </div>

          {/* Allergies */}
          <div className={styles.formGroup}>
            <label>Allergies</label>
            <input
              type="text"
              placeholder="e.g. Nuts, Milk"
            />
          </div>

          {/* Dietary Preferences */}
          <div className={styles.formGroup}>
            <label>Dietary Preferences</label>
            <input
              type="text"
              placeholder="e.g. Vegetarian, Low Sugar"
            />
          </div>

          {/* Preferred Language */}
          <div className={styles.formGroup}>
            <label>Preferred Language</label>
            <select>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="ml">Malayalam</option>
            </select>
          </div>

          {/* Audio Speed */}
          <div className={styles.formGroup}>
            <label>Audio Speed</label>
            <select>
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