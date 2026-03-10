import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { router, Href } from "expo-router";

const api = axios.create({
    baseURL: "https://major-project-perceiva.onrender.com",
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 5000,
});

// Request interceptor — attach token from SecureStore
api.interceptors.request.use(
    async (config) => {
        const token = await SecureStore.getItemAsync("token");
        if (token && token !== "undefined" && token !== "null") {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor — handle 401
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response?.status === 401) {
            await SecureStore.deleteItemAsync("token");
            router.replace("/login" as Href);
        }
        return Promise.reject(error);
    }
);

export default api;
