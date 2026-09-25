from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    Float,
    String,
    DateTime,
    ForeignKey
)

from app.database.database import Base


class WhiteboardStroke(Base):

    __tablename__ = "whiteboard_strokes"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    classroom_id = Column(
        Integer,
        ForeignKey("classrooms.id"),
        nullable=False,
        index=True
    )

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False
    )

    stroke_type = Column(
        String,
        nullable=False,
        default="draw"
    )

    x = Column(
        Float,
        nullable=False
    )

    y = Column(
        Float,
        nullable=False
    )

    prev_x = Column(
        Float,
        nullable=False
    )

    prev_y = Column(
        Float,
        nullable=False
    )

    color = Column(
        String,
        nullable=False,
        default="#000000"
    )

    width = Column(
        Float,
        nullable=False,
        default=1.0
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )