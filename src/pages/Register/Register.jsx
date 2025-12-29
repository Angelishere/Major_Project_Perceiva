import React, { useState } from "react";
import { Link } from "react-router-dom";
import "./Register.css"; // reuse same styles
import axios from "axios";
import { useNavigate } from "react-router-dom";






const Register = () => {
    const navigate = useNavigate();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [username, setUsername] = useState("");
    const [role, setRole] = useState("blind");

    const handleSubmit = (e) => {
        e.preventDefault();
        console.log(role)   

        axios.post("https://major-project-perceiva.onrender.com/register", { name: name, email: email, password: password, username: username, role: role }, {
            headers: {
                "Content-Type": "application/json"
            }
        }).then((e) => {
            if (e.data.message == "User registered successfully") {
                localStorage.setItem("token", e.data.token);
                navigate('/addDetails')
            }
        }).catch((Error) => {
            console.log(Error)
        })
    }
    return (
        <main className="page-container">
            <section className="login-section" aria-labelledby="register-title">

                <header className="login-header">
                    <h1 id="register-title">Register</h1>
                    <p>Create your account</p>
                </header>

                <form className="login-form">

                    <legend className="sr-only">User Registration Form</legend>

                    <div className="form-group">
                        <label htmlFor="name">Full Name</label>
                        <input
                            type="text"
                            id="name"
                            placeholder="Enter your full name"
                            required
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value)
                            }}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="name">User Name</label>
                        <input
                            type="text"
                            id="username"
                            placeholder="Enter your user name"
                            required
                            value={username}
                            onChange={(e) => {
                                setUsername(e.target.value)
                            }}
                        />
                    </div>


                    <div className="form-group">
                        <label htmlFor="email">Email Address</label>
                        <input
                            type="email"
                            id="email"
                            placeholder="Enter your email"
                            required
                            value={email}
                            onChange={(e) => {
                                setEmail(e.target.value)
                            }}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <input
                            type="password"
                            id="password"
                            placeholder="Create a password"
                            required
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value)
                            }}
                        />
                    </div>
                    <div className="form-group">
                        <label>User Type</label>
                        <select required value={role} onChange={(e)=>{setRole(e.target.value)}}>
                            <option value="blind" >Blind</option>
                            <option value="volunteer" >Volunteer</option>
                        </select>
                    </div>

                    <button type="button" className="login-button" onClick={handleSubmit}>
                        Register
                    </button>

                </form>

                <footer className="login-footer">
                    <p>
                        Already have an account?{" "}
                        <Link to="/">Login</Link>
                    </p>
                </footer>

            </section>
        </main>
    );
};

export default Register;