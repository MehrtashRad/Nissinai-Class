from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.dependencies import get_current_user

from app.schemas.chat import ChatMessageResponse
from app.services.chat_service import get_chat_history


router = APIRouter(
    prefix="/chat",
    tags=["Chat"]
)


@router.get(
    "/{classroom_id}",
    response_model=list[ChatMessageResponse]
)
def history(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):

    return get_chat_history(
        db,
        classroom_id
    )