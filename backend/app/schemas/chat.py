from pydantic import BaseModel


class ChatMessageResponse(BaseModel):
    id: int
    sender: str
    role: str
    message: str
    time: str

    class Config:
        from_attributes = True