from sqlalchemy import Column, Integer, Boolean, ForeignKey
from sqlalchemy.orm import relationship

from app.database.database import Base


class WhiteboardPermission(Base):

    __tablename__ = "whiteboard_permissions"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    classroom_id = Column(
        Integer,
        ForeignKey("classrooms.id"),
        nullable=False
    )

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False
    )

    can_draw = Column(
        Boolean,
        default=False,
        nullable=False
    )

    user = relationship("User")
    classroom = relationship("Classroom")