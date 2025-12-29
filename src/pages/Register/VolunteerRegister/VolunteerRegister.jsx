import React from "react";
import styles from "./VolunteerRegister.module.css";

const VolunteerRegister = () => {
  return (
    <main className={styles.pageContainer}>
      <section className={styles.loginSection} aria-labelledby="volunteer-title">

        <header className={styles.loginHeader}>
          <h1 id="volunteer-title">Volunteer Registration</h1>
          <p>Complete your volunteer profile</p>
        </header>

        <form className={styles.loginForm}>
          <legend className={styles.srOnly}>Volunteer Registration Form</legend>

          {/* Languages */}
          <div className={styles.formGroup}>
            <label htmlFor="languages">Languages Known</label>
            <input
              type="text"
              id="languages"
              placeholder="English, Hindi, Malayalam"
            />
          </div>

          {/* Availability */}
          <div className={styles.checkboxGroup}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" />
              <span>Available for volunteer calls</span>
            </label>
          </div>

          {/* Consent */}
          <div className={styles.checkboxGroup}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" required />
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