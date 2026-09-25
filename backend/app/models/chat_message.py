from datetime import datetime

from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship

from app.database.database import Base


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)

    classroom_id = Column(
        Integer,
        ForeignKey("classrooms.id")
    )

    sender_id = Column(
        Integer,
        ForeignKey("users.id")
    )

    message = Column(String, nullable=False)

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )

    classroom = relationship(
        "Classroom"
    )

    sender = relationship(
        "User"
    )