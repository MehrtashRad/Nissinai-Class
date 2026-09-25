import axios from "axios";

// Configurable via the VITE_API_URL environment variable (see
// frontend/.env.example). Falls back to the default local backend
// address for development.
export const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// WebSocket base URL, derived from API_URL unless explicitly overridden.
export const WS_URL =
  import.meta.env.VITE_WS_URL || API_URL.replace(/^http/, "ws");

const api = axios.create({
  baseURL: API_URL,
});

export default api;