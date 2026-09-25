from typing import Optional

from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):

    username: str
    email: EmailStr
    password: str

    role: str = "student"

    teacher_code: Optional[str] = None


class UserLogin(BaseModel):

    national_id: str
    institutional_id: str


class UserResponse(BaseModel):

    id: int
    username: str
    email: EmailStr
    role: str

    class Config:
        from_attributes = True