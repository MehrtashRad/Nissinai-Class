from sqlalchemy import Column, Integer, Boolean, ForeignKey

from app.database.database import Base


class MicPermission(Base):
    __tablename__ = "mic_permissions"

    id = Column(Integer, primary_key=True, index=True)
    classroom_id = Column(Integer, ForeignKey("classrooms.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    can_speak = Column(Boolean, default=False)