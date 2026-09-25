from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # classroom_id -> list of connected users
        self.active_connections = {}

    async def connect(
        self,
        classroom_id: int,
        websocket: WebSocket,
        user_id: int,
        username: str,
        role: str
    ):
        await websocket.accept()

        if classroom_id not in self.active_connections:
            self.active_connections[classroom_id] = []

        self.active_connections[classroom_id].append({
            "websocket": websocket,
            "user_id": user_id,
            "username": username,
            "role": role
        })

    def disconnect(
        self,
        classroom_id: int,
        websocket: WebSocket
    ):
        if classroom_id not in self.active_connections:
            return

        self.active_connections[classroom_id] = [
            user
            for user in self.active_connections[classroom_id]
            if user["websocket"] != websocket
        ]

        if not self.active_connections[classroom_id]:
            del self.active_connections[classroom_id]

    def online_count(self, classroom_id: int):
        return len(
            self.active_connections.get(
                classroom_id,
                []
            )
        )
    def is_teacher_online(self, classroom_id: int):
        connections = self.active_connections.get(
            classroom_id,
            []
        )

        return any(
            connection["role"] == "teacher"
            for connection in connections
        )
    def get_online_users(self, classroom_id: int):
        return [
            {
                "id": user["user_id"],
                "username": user["username"],
                "role": user["role"]
            }
            for user in self.active_connections.get(
                classroom_id,
                []
            )
        ]

    async def send_to_user(
        self,
        classroom_id: int,
        user_id: int,
        message: str
    ):
        connections = self.active_connections.get(
            classroom_id,
            []
        )

        for connection in connections:

            if connection["user_id"] != user_id:
                continue

            try:
                await connection["websocket"].send_text(
                    message
                )
            except Exception:
                pass

            break

    async def broadcast(
        self,
        classroom_id: int,
        message: str,
        exclude: WebSocket = None # type: ignore
    ):
        connections = self.active_connections.get(
            classroom_id,
            []
        )

        for user in connections:
            websocket = user["websocket"]

            if websocket == exclude:
                continue

            try:
                await websocket.send_text(message)
            except Exception:
                pass


manager = ConnectionManager()