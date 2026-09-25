"""
Centralized application configuration.

All configurable values (secrets, URLs, feature toggles) are read from
environment variables here, with safe local-development defaults.
Copy `.env.example` to `.env` and adjust the values before running the
app in any shared or production environment.
"""

import os

from dotenv import load_dotenv

load_dotenv()


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


# --- Database ---------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./smart_blackboard.db")

# --- JWT / authentication ---------------------------------------------
# In production this MUST be overridden with a long, random value via
# the environment. The default below is only for local development.
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-only-insecure-secret-change-me")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "180")
)

# --- Teacher self-registration -----------------------------------------
# Guests who register with role="teacher" must supply this code.
TEACHER_REGISTER_CODE = os.getenv("TEACHER_REGISTER_CODE", "CHANGE-ME")

# --- CORS ---------------------------------------------------------------
CORS_ORIGINS = _split_csv(
    os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173",
    )
)
