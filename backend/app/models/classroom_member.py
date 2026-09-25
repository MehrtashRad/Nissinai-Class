from sqlalchemy import Column, Integer, ForeignKey, DateTime, String
from sqlalchemy.orm import relationship
from datetime import datetime

from app.database.database import Base


class ClassroomMember(Base):
    __tablename__ = "classroom_members"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    user_id = Column(
        Integer,
        ForeignKey("users.id")
    )

    classroom_id = Column(
        Integer,
        ForeignKey("classrooms.id")
    )

    joined_at = Column(
        DateTime,
        default=datetime.utcnow
    )

    status = Column(
        String,
        default="active",
        nullable=False
    )

    user = relationship(
        "User",
        back_populates="classroom_members"
    )

    classroom = relationship(
        "Classroom",
        back_populates="members"
    )