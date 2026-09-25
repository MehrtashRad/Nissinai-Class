from pydantic import BaseModel


class WSChatMessage(BaseModel):
    classroom_id: int
    message: str