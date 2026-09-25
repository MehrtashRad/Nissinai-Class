from sqlalchemy.orm import Session

from app.models.chat_message import ChatMessage
from app.models.user import User


def save_message(
    db: Session,
    classroom_id: int,
    user: User,
    message: str
):

    chat = ChatMessage(
        classroom_id=classroom_id,
        sender_id=user.id,
        message=message
    )

    db.add(chat)
    db.commit()
    db.refresh(chat)

    return chat


def get_chat_history(
    db: Session,
    classroom_id: int
):

    messages = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.classroom_id == classroom_id
        )
        .order_by(ChatMessage.created_at)
        .all()
    )

    return [
        {
            "id": msg.id,
            "sender": msg.sender.username,
            "role": msg.sender.role,
            "message": msg.message,
            "time": msg.created_at.isoformat()
        }
        for msg in messages
    ]