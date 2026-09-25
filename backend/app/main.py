from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ORIGINS
from app.database.database import SessionLocal, engine, Base

# Import all models so their tables are registered on Base.metadata
# before create_all() runs below.
from app.models import (
    User,
    Classroom,
    ClassroomMember,
    ChatMessage,
    WhiteboardStroke,
    WhiteboardPermission,
    MicPermission,
    RegisteredPerson,
)

from app.api import auth, users, classrooms, websocket, chat
from seed import seed_registered_people

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Smart AI Blackboard API",
    version="1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(classrooms.router)
app.include_router(websocket.router)
app.include_router(chat.router)


@app.get("/")
def home():
    return {
        "message": "Smart AI Blackboard Backend is running!"
    }


@app.on_event("startup")
def startup():
    db = SessionLocal()

    try:
        seed_registered_people(db)
    finally:
        db.close()
