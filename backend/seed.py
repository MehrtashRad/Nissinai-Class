from sqlalchemy.orm import Session

from app.database.database import SessionLocal
from app.models.registered_person import RegisteredPerson


def seed_registered_people(db: Session):
    """
    Populate the `registered_people` table with a small set of demo
    accounts on first run, so the "official university account" login
    flow (national ID as username, institutional ID as password) can
    be tried out without any real personal data.

    This data is entirely fictional and is only meant to demonstrate
    the registration/login flow described in the README.
    """

    # Avoid re-seeding if data already exists.
    if db.query(RegisteredPerson).first():
        return

    teachers = [
        {
            "full_name": "Demo Teacher One",
            "national_id": "1000000001",
            "institutional_id": "DEMO-T-001",
        },
        {
            "full_name": "Demo Teacher Two",
            "national_id": "1000000002",
            "institutional_id": "DEMO-T-002",
        },
    ]

    students = [
        {
            "full_name": "Demo Student One",
            "national_id": "2000000001",
            "institutional_id": "DEMO-S-001",
        },
        {
            "full_name": "Demo Student Two",
            "national_id": "2000000002",
            "institutional_id": "DEMO-S-002",
        },
        {
            "full_name": "Demo Student Three",
            "national_id": "2000000003",
            "institutional_id": "DEMO-S-003",
        },
    ]

    for teacher in teachers:
        db.add(
            RegisteredPerson(
                full_name=teacher["full_name"],
                national_id=teacher["national_id"],
                institutional_id=teacher["institutional_id"],
                role="teacher",
            )
        )

    for student in students:
        db.add(
            RegisteredPerson(
                full_name=student["full_name"],
                national_id=student["national_id"],
                institutional_id=student["institutional_id"],
                role="student",
            )
        )

    db.commit()


if __name__ == "__main__":
    db = SessionLocal()

    try:
        seed_registered_people(db)
    finally:
        db.close()
