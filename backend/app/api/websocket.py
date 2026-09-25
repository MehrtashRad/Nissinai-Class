import json

from fastapi import APIRouter, WebSocket
from sqlalchemy.orm import Session

from app.database.database import SessionLocal
from app.websocket.manager import manager

from app.auth.jwt_handler import decode_access_token
from app.models.user import User
from app.models.whiteboard_permission import WhiteboardPermission
from app.models.classroom_member import ClassroomMember
from app.models.whiteboard import WhiteboardStroke
from app.services.chat_service import save_message
from app.models.mic_permission import MicPermission

router = APIRouter(
    tags=["WebSocket"]
)

# In-memory per-classroom board state: current mode and the last
# file that was shared (if any). This is intentionally simple
# (resets if the server restarts) but it means a client connecting
# at any time — a late joiner, or anyone refreshing, including the
# teacher — can be told the current state directly, rather than
# relying solely on another connected client's live resync message.
classroom_board_state = {}


@router.websocket("/ws/{classroom_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    classroom_id: int,
    token: str,
):
    db: Session = SessionLocal()
    connected=False
    try:
        # -----------------------------
        # AUTHENTICATION
        # -----------------------------

        payload = decode_access_token(token)

        if payload is None:
            await websocket.close(code=1008)
            return

        user = (
            db.query(User)
            .filter(User.email == payload["sub"])
            .first()
        )

        if user is None:
            await websocket.close(code=1008)
            return
        def has_current_whiteboard_permission():
            if user.role == "teacher": # pyright: ignore[reportGeneralTypeIssues]
                return True

            db.commit()  # snapshot مربوط به session را آزاد می‌کند تا داده‌های فعلی خوانده شوند

            permission = (
                db.query(WhiteboardPermission)
                .filter(
                    WhiteboardPermission.classroom_id
                    == classroom_id,
                    WhiteboardPermission.user_id
                    == user.id
                )
                .first()
            )

            return (
                permission is not None
                and permission.can_draw
            )
# -----------------------------
# CHECK CLASSROOM MEMBERSHIP
# -----------------------------

        member = (
            db.query(ClassroomMember)
            .filter(
                ClassroomMember.classroom_id == classroom_id,
                ClassroomMember.user_id == user.id
            )
            .first()
        )

        if user.role != "teacher": # type: ignore

            # Student اصلاً عضو کلاس نیست
            if member is None:
                await websocket.close(code=4004)
                return

            # Student عضو کلاس است ولی اجازه ورود ندارد
            if member.status != "active": # type: ignore

                await websocket.send_text(
                    json.dumps({
                        "type": "join_required",
                        "status": member.status
                    })
                )

                await websocket.close(code=4003)
                return
        # -----------------------------
        # WHITEBOARD PERMISSION
        # -----------------------------

        can_draw = user.role == "teacher"

        if not can_draw: # type: ignore

            permission = (
                db.query(WhiteboardPermission)
                .filter(
                    WhiteboardPermission.classroom_id == classroom_id,
                    WhiteboardPermission.user_id == user.id
                )
                .first()
            )

            can_draw = (
                permission is not None
                and permission.can_draw
            )

        db.rollback()
        # -----------------------------
        # CONNECT
        # -----------------------------

        await manager.connect(
            classroom_id,
            websocket,
            user.id, # type: ignore
            user.username, # pyright: ignore[reportArgumentType]
            user.role # type: ignore
        )
        connected=True

        online_users = manager.get_online_users(
            classroom_id
        )

        # -----------------------------
        # SEND CURRENT ONLINE USERS
        # TO THE NEW USER
        # -----------------------------

        await websocket.send_text(
           json.dumps({
             "type": "online_users",
             "users": online_users,
             "current_user_id": user.id
              })
            )

        # -----------------------------
        # RESTORE CURRENT BOARD STATE
        # FOR THE NEW / RECONNECTING USER
        # -----------------------------

        board_state = classroom_board_state.get(classroom_id)

        if board_state is not None:

            current_mode = board_state.get("mode")

            if current_mode:
                await websocket.send_text(
                    json.dumps({
                        "type": "board_mode",
                        "mode": current_mode
                    })
                )

            current_file = board_state.get("file")

            if current_file:
                await websocket.send_text(
                    json.dumps({
                        "type": "board_file",
                        "file_data": current_file.get("file_data"),
                        "file_name": current_file.get("file_name")
                    })
                )

        # -----------------------------
        # NOTIFY EVERYONE
        # -----------------------------

        await manager.broadcast(
            classroom_id,
            json.dumps({
                "type": "user_join",
                "user_id": user.id,
                "username": user.username,
                "role": user.role,
                "online": len(online_users)
            })
        )

        # -----------------------------
        # MESSAGE LOOP
        # -----------------------------

        while True:

            data = await websocket.receive_text()

            message = json.loads(data)

            message_type = message.get("type")

            # -------------------------
            # DRAW / ERASE
            # -------------------------

            if message_type in ["draw", "erase"]:

                if not has_current_whiteboard_permission(): # type: ignore
                    continue

                stroke = WhiteboardStroke(
                    classroom_id=classroom_id,
                    user_id=user.id,
                    stroke_type=message_type,

                    x=message["x"],
                    y=message["y"],

                    prev_x=message["prevX"],
                    prev_y=message["prevY"],

                    color=message.get(
                        "color",
                        "#000000"
                    ),

                    width=message.get(
                        "width",
                        1.0
                    )
                )

                db.add(stroke)
                db.commit()

                await manager.broadcast(
                    classroom_id,
                    json.dumps(message)
                )

            # -------------------------
            # STOP
            # -------------------------

            elif message_type == "stop":

                await manager.broadcast(
                    classroom_id,
                    json.dumps(message),
                    websocket
                )

            # -------------------------
            # CLEAR
            # -------------------------

            elif message_type == "clear":

                if user.role != "teacher": # type: ignore
                    return

                db.query(
                    WhiteboardStroke
                ).filter(
                    WhiteboardStroke.classroom_id == classroom_id
                ).delete(
                    synchronize_session=False
                )

                db.commit()

                await manager.broadcast(
                    classroom_id,
                    json.dumps({
                        "type": "clear"
                    })
                )

            # -------------------------
            # WHITEBOARD PERMISSION
            # -------------------------

            elif message_type == "permission":

                # فقط استاد می‌تواند permission بدهد
                if user.role != "teacher": # type: ignore
                    continue

                target_user_id = message.get("user_id")

                can_draw_permission = message.get(
                    "can_draw",
                    False
                )

                if target_user_id is None:
                    continue

                # بررسی اینکه کاربر واقعاً عضو کلاس است
                target_user = (
                    db.query(User)
                    .join(
                        ClassroomMember,
                        ClassroomMember.user_id == User.id
                    )
                    .filter(
                        User.id == target_user_id,
                        ClassroomMember.classroom_id == classroom_id
                    )
                    .first()
                )

                if target_user is None:
                    continue

                # استاد نباید permission خودش را مدیریت کند
                if target_user.role == "teacher": # type: ignore
                    continue

                # پیدا کردن permission قبلی
                permission = (
                    db.query(WhiteboardPermission)
                    .filter(
                        WhiteboardPermission.classroom_id
                        == classroom_id,

                        WhiteboardPermission.user_id
                        == target_user_id
                    )
                    .first()
                )

                # اگر وجود نداشت، بساز
                if permission is None:

                    permission = WhiteboardPermission(
                        classroom_id=classroom_id,
                        user_id=target_user_id,
                        can_draw=can_draw_permission
                    )

                    db.add(permission)

                else:

                    permission.can_draw = can_draw_permission

                db.commit()

                # ارسال وضعیت جدید فقط به همان دانشجو
                connections = (
                    manager.active_connections.get(
                        classroom_id,
                        []
                    )
                )

                for connection in connections:

                    if connection["user_id"] == target_user_id:

                        try:

                            await connection["websocket"].send_text(
                                json.dumps({
                                    "type": "whiteboard_permission",
                                    "can_draw": can_draw_permission
                                })
                            )

                        except Exception:
                            pass

                        break
            elif message_type == "board_mode":

                if user.role != "teacher": # type: ignore
                    continue

                mode = message.get("mode")

                if mode not in ["whiteboard", "file", "camera"]:
                    continue

                target_user_id = message.get("target_user_id")

                # --------------------------------
                # Normal change → everyone
                # --------------------------------
                if target_user_id is None:

                    classroom_board_state.setdefault(
                        classroom_id, {}
                    )["mode"] = mode

                    await manager.broadcast(
                        classroom_id,
                        json.dumps({
                            "type": "board_mode",
                            "mode": mode
                        })
                    )

                # --------------------------------
                # Late joiner → only target user
                # --------------------------------
                else:

                    connections = manager.active_connections.get(
                        classroom_id,
                        []
                    )

                    for connection in connections:

                        if (
                            int(connection["user_id"])
                            == int(target_user_id)
                        ):

                            try:
                                await connection["websocket"].send_text(
                                    json.dumps({
                                        "type": "board_mode",
                                        "mode": mode
                                    })
                                )

                            except Exception as error:
                                print(
                                    "Failed to send board_mode:",
                                    repr(error)
                                )

                            break

            # -------------------------
            # BOARD FILE
            # -------------------------
            elif message_type == "board_file":

                # Teacher همیشه اجازه دارد.
                # Student باید permission فعلی داشته باشد.
                if user.role != "teacher": # type: ignore
                    db.commit()  # همان راه‌حل — مجبور کردن session به خواندن تازه
                    permission = (
                        db.query(WhiteboardPermission)
                        .filter(
                            WhiteboardPermission.classroom_id == classroom_id,
                            WhiteboardPermission.user_id == user.id
                        )
                        .first()
                    )

                    if (
                        permission is None
                        or not permission.can_draw # type: ignore
                    ):
                        continue

                file_data = message.get("file_data")
                file_name = message.get("file_name")

                if not file_data or not file_name:
                    continue

                # --------------------------------
                # Normal sharing → everyone
                # --------------------------------
                if message.get("target_user_id") is None:

                    classroom_board_state.setdefault(
                        classroom_id, {}
                    )["file"] = {
                        "file_data": file_data,
                        "file_name": file_name
                    }

                    await manager.broadcast(
                        classroom_id,
                        json.dumps({
                            "type": "board_file",
                            "file_data": file_data,
                            "file_name": file_name
                        })
                    )

                # --------------------------------
                # Late joiner → only target user
                # --------------------------------
                else:

                    target_user_id = message.get(
                        "target_user_id"
                    )

                    connections = (
                        manager.active_connections.get(
                            classroom_id,
                            []
                        )
                    )

                    for connection in connections:

                        if (
                            int(connection["user_id"])
                            == int(target_user_id)
                        ):

                            try:
                                await connection["websocket"].send_text(
                                    json.dumps({
                                        "type": "board_file",
                                        "file_data": file_data,
                                        "file_name": file_name
                                    })
                                )

                            except Exception as error:
                                print(
                                    "Failed to send board file:",
                                    repr(error)
                                )

                            break 
                # -------------------------
            # STUDENT KICKED
            # -------------------------

            elif message_type == "student_kicked":

                if user.role != "teacher": # type: ignore
                    continue

                target_user_id = message.get("user_id")

                if target_user_id is None:
                    continue

                # فقط دانشجوی همان کلاس
                target_member = (
                    db.query(ClassroomMember)
                    .filter(
                        ClassroomMember.classroom_id == classroom_id,
                        ClassroomMember.user_id == target_user_id
                    )
                    .first()
                )

                if target_member is None:
                    continue

                target_member.status = "kicked" # type: ignore
                db.commit()

                # اطلاع به دانشجو
                await manager.send_to_user(
                    classroom_id,
                    target_user_id,
                    json.dumps({
                        "type": "student_kicked"
                    })
                )

                # پیدا کردن WebSocket دانشجو
                connections = manager.active_connections.get(
                    classroom_id,
                    []
                )

                for connection in connections:

                    if connection["user_id"] == target_user_id:

                        try:
                            await connection["websocket"].close(
                                code=4003
                            )
                        except Exception:
                            pass

                        break  
            elif message_type == "mic_permission":

                            if user.role != "teacher": # type: ignore
                                continue

                            target_user_id = message.get("user_id")
                            can_speak_permission = message.get("can_speak", False)

                            if target_user_id is None:
                                continue

                            # بررسی اینکه کاربر واقعاً عضو کلاس است
                            target_user = (
                                db.query(User)
                                .join(
                                    ClassroomMember,
                                    ClassroomMember.user_id == User.id
                                )
                                .filter(
                                    User.id == target_user_id,
                                    ClassroomMember.classroom_id == classroom_id
                                )
                                .first()
                            )

                            if target_user is None:
                                continue

                            # استاد نباید permission میکروفون بگیرد
                            if target_user.role == "teacher": # type: ignore
                                continue

                            # پیدا کردن permission قبلی
                            permission = (
                                db.query(MicPermission)
                                .filter(
                                    MicPermission.classroom_id == classroom_id,
                                    MicPermission.user_id == target_user_id
                                )
                                .first()
                            )

                            # ساخت permission جدید یا آپدیت قبلی
                            if permission is None:
                                permission = MicPermission(
                                    classroom_id=classroom_id,
                                    user_id=target_user_id,
                                    can_speak=can_speak_permission
                                )
                                db.add(permission)
                            else:
                                permission.can_speak = can_speak_permission

                            db.commit()

                            # ارسال وضعیت جدید فقط به همان دانشجو
                            connections = manager.active_connections.get(
                                classroom_id,
                                []
                            )

                            for connection in connections:

                                if connection["user_id"] == target_user_id:

                                    try:
                                        await connection["websocket"].send_text(
                                            json.dumps({
                                                "type": "mic_permission",
                                                "can_speak": can_speak_permission
                                            })
                                        )
                                    except Exception:
                                        pass

                                    break
                        
            # -------------------------
            # WEBRTC SIGNALING
            # -------------------------

            elif message_type == "webrtc_offer":

                target_user_id = message.get("target_user_id")
                offer = message.get("offer")

                if target_user_id is None or offer is None:
                    continue

                connections = manager.active_connections.get(
                    classroom_id,
                    []
                )

                for connection in connections:

                    if connection["user_id"] == target_user_id:

                        try:
                            await connection["websocket"].send_text(
                                json.dumps({
                                    "type": "webrtc_offer",
                                    "from_user_id": user.id,
                                    "offer": offer,
                                    "kind": message.get("kind"),
                                })
                            )
                        except Exception as e:
                            print(
                                "Failed to send WebRTC offer:",
                                repr(e)
                            )

                        break

            elif message_type == "webrtc_answer":

                target_user_id = message.get("target_user_id")
                answer = message.get("answer")

                if target_user_id is None or answer is None:
                    continue

                connections = manager.active_connections.get(
                    classroom_id,
                    []
                )

                for connection in connections:

                    if connection["user_id"] == target_user_id:

                        try:
                            await connection["websocket"].send_text(
                                json.dumps({
                                    "type": "webrtc_answer",
                                    "from_user_id": user.id,
                                    "answer": answer,
                                    "kind": message.get("kind"),
                                })
                            )
                        except Exception as e:
                            print(
                                "Failed to send WebRTC answer:",
                                repr(e)
                            )

                        break

            elif message_type == "webrtc_ice_candidate":

                target_user_id = message.get("target_user_id")
                candidate = message.get("candidate")

                if target_user_id is None or candidate is None:
                    continue

                connections = manager.active_connections.get(
                    classroom_id,
                    []
                )

                for connection in connections:

                    if connection["user_id"] == target_user_id:

                        try:
                            await connection["websocket"].send_text(
                                json.dumps({
                                   "type": "webrtc_ice_candidate",
                                   "from_user_id": user.id,
                                   "candidate": candidate,
                                   "kind": message.get("kind"),
                                })
                            )
                        except Exception as e:
                            print(
                                "Failed to send WebRTC ICE candidate:",
                                repr(e)
                            )

                        break

            # -------------------------
            # CHAT
            # -------------------------

            elif message_type == "chat":

                save_message(
                    db=db,
                    classroom_id=classroom_id,
                    user=user,
                    message=message["message"]
                )

                await manager.broadcast(
                    classroom_id,
                    json.dumps({
                        "type": "chat",
                        "sender": user.username,
                        "role": user.role,         
                        "message": message["message"]
                    }),
                    websocket
                )

            # -------------------------
            # RAISE HAND
            # -------------------------

            elif message_type == "raise_hand":

                # Sender is always taken from the authenticated
                # connection, never from client-provided data.
                raised = bool(message.get("raised", False))

                await manager.broadcast(
                    classroom_id,
                    json.dumps({
                        "type": "raise_hand",
                        "user_id": user.id,
                        "raised": raised
                    })
                )

    except Exception as e:

        print(
            "WEBSOCKET ERROR:",
            repr(e)
        )

    finally:

        if connected:

            manager.disconnect(
                classroom_id,
                websocket
            )

            online_users = manager.get_online_users(
                classroom_id
            )

            try:
                assert user is not None
                await manager.broadcast(
                    classroom_id,
                    json.dumps({
                        "type": "user_leave",
                        "user_id": user.id,
                        "username": user.username,
                        "role": user.role,
                        "online": len(online_users)
                    })
                )
            except Exception:
                pass

        # VERY IMPORTANT:
        # Release the database session/connection
        db.close()

