import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./Login.css";
import axios from "axios";
import api from "../../api/api";

const Login = () => {
  const navigate = useNavigate();

  useEffect(
    ()=>{
      const token = localStorage.getItem("token");
      if(token){
        navigate("/",{ replace:true })
      }
    }, [navigate]
  )
  const [username, setUsername] = useState("");
  const [password, setpassword] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post("/login",{
        username,password,
      })
      localStorage.setItem("token",res.data.token);
      console.log("Login Successful")
      navigate("/")
    } catch (error) {
      console.log(error);
      alert("Invalid credentials");
      
    }
  }
  return (
    <main className="page-container">
      <section className="login-section" aria-labelledby="login-title">

        <header className="login-header">
          <h1 id="login-title">Login</h1>
          <p>Sign in to your account</p>
        </header>

        <form className="login-form" onSubmit={handleLogin}>

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

          <button type="submit" className="login-button">
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