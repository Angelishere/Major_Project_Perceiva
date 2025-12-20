import axios from "axios";

const api = axios.create({
    baseURL: "https://major-project-perceiva.onrender.com"
    ,
    headers: {
        "Content-Type": "application/json",

    },
    timeout: 1000
});


api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem("token");
        if (token && token !== "undefined" && token !== "null") {
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
    },
    (error)=>{
        Promise.reject(error)
    }
)

api.interceptors.response.use(
    (response)=> response,
    (error)=>{
        if (error.response?.status === 401) {
            localStorage.removeItem("token");
            window.location.href = "/login";

        }
        return Promise.reject(error)
    }
)


