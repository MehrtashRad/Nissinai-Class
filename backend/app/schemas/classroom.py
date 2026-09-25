from pydantic import BaseModel
from datetime import datetime
from app.schemas.user import UserResponse


class ClassroomCreate(BaseModel):
    title: str
    description: str | None = None


class ClassroomUpdate(BaseModel):
    title: str
    description: str | None = None


class ClassroomResponse(BaseModel):
    id: int
    title: str
    description: str | None
    invite_code: str


    class Config:
        from_attributes = True

class ClassroomMembersResponse(BaseModel):
    id: int
    title: str
    members: list[UserResponse]

    class Config:
        from_attributes = True

class ClassroomJoin(BaseModel):
    invite_code: str       