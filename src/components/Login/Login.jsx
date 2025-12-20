import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./Login.css";
import axios from "axios";

const Login = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setpassword] = useState("");

  const handleLogin = (e) => {
    e.preventDefault();
    axios.post("https://major-project-perceiva.onrender.com/login", { username: username, password: password }, {
      headers: {
        "Content-Type": "application/json"
      }
    }).then((e) => {
      console.log(e.data.message)
      sessionStorage.setItem("token",e.data.token)
      alert("Login Succesfull")
      
    }).catch((e) => { console.log(e) })
  }
  return (
    <main className="page-container">
      <section className="login-section" aria-labelledby="login-title">

        <header className="login-header">
          <h1 id="login-title">Login</h1>
          <p>Sign in to your account</p>
        </header>

        <form className="login-form">

          <legend className="sr-only">User Login Form</legend>

          <div className="form-group">
            <label htmlFor="identifier">Email or Username</label>
            <input
              type="text"
              id="identifier"
              name="identifier"
              placeholder="Enter your email or username"
              required
              value={username}
              onChange={(e) => { setUsername(e.target.value) }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              placeholder="Enter your password"
              required
              value={password}
              onChange={(e) => {
                setpassword(e.target.value)
              }}
            />
          </div>

          <button type="submit" className="login-button" onClick={handleLogin}>
            Login
          </button>

        </form>

        <footer className="login-footer">
          <p>
            Don’t have an account?{" "}
            <Link to="/register">Register</Link>
          </p>
        </footer>

      </section>
    </main>
  );
};

export default Login;