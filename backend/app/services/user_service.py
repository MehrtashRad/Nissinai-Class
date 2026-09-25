from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models.user import User
from app.models.registered_person import RegisteredPerson
from app.schemas.user import UserCreate
from app.auth.security import hash_password
from app.config import TEACHER_REGISTER_CODE


def create_user(db: Session, user: UserCreate):

    # =========================================================
    # بررسی نقش
    # =========================================================

    if user.role not in ["student", "teacher"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid role. Role must be student or teacher."
        )

    # =========================================================
    # Guest Teacher
    # =========================================================
    # اگر کاربر مهمان بخواهد Teacher باشد،
    # باید Teacher Code معتبر داشته باشد.
    # =========================================================

    if user.role == "teacher":

        if not user.teacher_code:
            raise HTTPException(
                status_code=400,
                detail="Teacher code is required."
            )

        if user.teacher_code != TEACHER_REGISTER_CODE:
            raise HTTPException(
                status_code=400,
                detail="Invalid teacher registration code."
            )

    # =========================================================
    # بررسی تکراری نبودن Username / Email
    # =========================================================

    existing_username = (
        db.query(User)
        .filter(User.username == user.username)
        .first()
    )

    if existing_username:
        raise HTTPException(
            status_code=400,
            detail="Username already exists."
        )

    existing_email = (
        db.query(User)
        .filter(User.email == user.email)
        .first()
    )

    if existing_email:
        raise HTTPException(
            status_code=400,
            detail="Email already exists."
        )

    # =========================================================
    # ساخت Guest User
    # =========================================================

    new_user = User(
        username=f"{user.username} (مهمان)",
        email=user.email,
        password=hash_password(user.password),
        role=user.role
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user