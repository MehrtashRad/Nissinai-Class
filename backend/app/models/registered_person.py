from sqlalchemy import Column, Integer, String

from app.database.database import Base


class RegisteredPerson(Base):

    __tablename__ = "registered_people"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    full_name = Column(
        String,
        nullable=False
    )

    national_id = Column(
        String,
        unique=True,
        nullable=False,
        index=True
    )

    institutional_id = Column(
        String,
        unique=True,
        nullable=False,
        index=True
    )

    role = Column(
        String,
        nullable=False
    )