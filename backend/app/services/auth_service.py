from sqlalchemy.orm import Session

from app.models.user import User
from app.models.registered_person import RegisteredPerson
from app.auth.security import verify_password
from app.auth.security import hash_password
from app.auth.jwt_handler import create_access_token


def login_user(
    db: Session,
    username: str,
    password: str
):

    # =========================================================
    # 1. بررسی کاربر رسمی دانشگاه
    # =========================================================
    #
    # برای کاربر رسمی:
    #
    # username = National ID
    # password = Institutional ID
    #
    # =========================================================

    registered_person = (
        db.query(RegisteredPerson)
        .filter(
            RegisteredPerson.national_id == username,
            RegisteredPerson.institutional_id == password
        )
        .first()
    )

    if registered_person:

        # -----------------------------------------------------
        # بررسی اینکه قبلاً برای این فرد User ساخته شده یا نه
        # -----------------------------------------------------

        user = (
            db.query(User)
            .filter(
                User.email == registered_person.national_id
            )
            .first()
        )

        # -----------------------------------------------------
        # اگر User وجود ندارد، ایجادش کن
        # -----------------------------------------------------

        if not user:

            user = User(
                username=registered_person.full_name,
                email=registered_person.national_id,
                password=hash_password(
                    registered_person.institutional_id # type: ignore
                ),
                role=registered_person.role
            )

            db.add(user)
            db.commit()
            db.refresh(user)

        # -----------------------------------------------------
        # ساخت JWT
        # -----------------------------------------------------

        token = create_access_token(
       {
        "sub": user.email,
        "username": user.username,
        "role": user.role,
        "user_id": user.id
      }
    )

        return {
            "access_token": token,
            "token_type": "bearer"
        }

    # =========================================================
    # 2. اگر کاربر رسمی نبود → بررسی Guest
    # =========================================================

    user = (
        db.query(User)
        .filter(User.email == username)
        .first()
    )

    if not user:
        return None

    # ---------------------------------------------------------
    # بررسی Password برای Guest
    # ---------------------------------------------------------

    if not verify_password(password, user.password):
        return None

    # =========================================================
    # ساخت JWT برای Guest
    # =========================================================

    token = create_access_token(
        {
            "sub": user.email,
            "username": user.username,
            "role": user.role,
            "user_id": user.id
        }
    )

    return {
        "access_token": token,
        "token_type": "bearer"
    }