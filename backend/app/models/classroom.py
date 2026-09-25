from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime

from app.database.database import Base


class Classroom(Base):

    __tablename__ = "classrooms"


    id = Column(
        Integer,
        primary_key=True,
        index=True
    )


    title = Column(
        String,
        nullable=False
    )


    description = Column(
        String,
        nullable=True
    )


    invite_code = Column(
        String,
        unique=True,
        index=True
    )


    owner_id = Column(
        Integer,
        ForeignKey("users.id")
    )


    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )


    # صاحب کلاس (Teacher)
    owner = relationship(
        "User",
        back_populates="classrooms"
    )


    # اعضای کلاس از طریق جدول واسط
    members = relationship(
        "ClassroomMember",
        back_populates="classroom",
        cascade="all, delete-orphan"
    )