from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import json

from app.database.database import get_db
from app.auth.dependencies import get_current_user
from app.websocket.manager import manager
from app.models.whiteboard_permission import WhiteboardPermission
from app.models.classroom_member import ClassroomMember
from app.models.mic_permission import MicPermission
from app.models.chat_message import ChatMessage
from app.schemas.classroom import (
    ClassroomCreate,
    ClassroomUpdate,
    ClassroomResponse,
    ClassroomJoin
)

from app.services.classroom_service import (
    create_classroom,
    get_my_classrooms,
    get_classroom,
    get_classroom_members,
    join_classroom,
    get_joined_classrooms,
    kick_student,
    request_rejoin,
    approve_rejoin,
    reject_rejoin,
    get_join_requests
)
from app.models.whiteboard import WhiteboardStroke
from app.models.user import User
from app.models.classroom import Classroom
router = APIRouter(
    prefix="/classrooms",
    tags=["Classrooms"]
)


# =========================================================
# CREATE CLASSROOM
# =========================================================

@router.post("/")
def create(
    classroom: ClassroomCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    return create_classroom(
        db,
        classroom,
        current_user
    )


# =========================================================
# GET MY CLASSROOMS - TEACHER
# =========================================================

@router.get(
    "/",
    response_model=list[ClassroomResponse]
)
def get_my_classes(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    return get_my_classrooms(
        db,
        current_user.id
    )

# =========================================================
# UPDATE CLASSROOM
# =========================================================

@router.put("/{classroom_id}")
def update_classroom(
    classroom_id: int,
    classroom: ClassroomUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    existing_classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if existing_classroom is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    if existing_classroom.owner_id != current_user.id: # type: ignore
        raise HTTPException(
            status_code=403,
            detail="Only the teacher can edit this classroom"
        )

    existing_classroom.title = classroom.title # type: ignore
    existing_classroom.description = classroom.description # type: ignore

    db.commit()
    db.refresh(existing_classroom)

    return existing_classroom

# =========================================================
# DELETE CLASSROOM
# =========================================================

@router.delete("/{classroom_id}")
def delete_classroom(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    # فقط صاحب کلاس می‌تواند آن را حذف کند
    if classroom.owner_id != current_user.id: # type: ignore
        raise HTTPException(
            status_code=403,
            detail="Only the teacher can delete this classroom"
        )

    # حذف اعضای کلاس
    db.query(ClassroomMember).filter(
        ClassroomMember.classroom_id == classroom_id
    ).delete(synchronize_session=False)

    # حذف پیام‌های کلاس
    db.query(ChatMessage).filter(
        ChatMessage.classroom_id == classroom_id
    ).delete(synchronize_session=False)

    # حذف Whiteboard permissionها
    db.query(WhiteboardPermission).filter(
        WhiteboardPermission.classroom_id == classroom_id
    ).delete(synchronize_session=False)

    # حذف Mic permissionها
    db.query(MicPermission).filter(
        MicPermission.classroom_id == classroom_id
    ).delete(synchronize_session=False)

    # حذف نقاشی‌های تخته
    db.query(WhiteboardStroke).filter(
        WhiteboardStroke.classroom_id == classroom_id
    ).delete(synchronize_session=False)

    # در نهایت خود کلاس
    db.delete(classroom)

    db.commit()

    return {
        "message": "Classroom deleted successfully",
        "classroom_id": classroom_id
    }
# =========================================================
# JOIN CLASSROOM
# =========================================================

@router.post("/join")
def join(
    data: ClassroomJoin,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    result = join_classroom(
        db,
        data.invite_code,
        current_user
    )

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    if result is False:
        raise HTTPException(
            status_code=400,
            detail="Unable to join classroom"
        )

    return result


# =========================================================
# GET JOINED CLASSROOMS - STUDENT
# =========================================================

@router.get(
    "/joined",
    response_model=list[ClassroomResponse]
)
def joined_classes(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    return get_joined_classrooms(
        db,
        current_user.id
    )

@router.get("/{classroom_id}/teacher-online")
def check_teacher_online(classroom_id: int):
    return {
        "teacher_online": manager.is_teacher_online(
            classroom_id
        )
    }
# =========================================================
# GET CLASSROOM MEMBERS
# =========================================================

@router.get("/{classroom_id}/members")
def members(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    result = get_classroom_members(
        db,
        classroom_id,
        current_user
    )

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    if result is False:
        raise HTTPException(
            status_code=403,
            detail="Access denied"
        )

    return result


# =========================================================
# GET SINGLE CLASSROOM
# =========================================================

@router.get(
    "/{classroom_id}",
    response_model=ClassroomResponse
)
def get_single_classroom(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    classroom = get_classroom(
        db,
        classroom_id,
        current_user
    )

    if classroom is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    if classroom is False:
        raise HTTPException(
            status_code=403,
            detail="Access denied"
        )

    return classroom

@router.get("/{classroom_id}/whiteboard")
def get_whiteboard(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    strokes = (
        db.query(WhiteboardStroke)
        .filter(
            WhiteboardStroke.classroom_id
            == classroom_id
        )
        .order_by(
            WhiteboardStroke.id.asc()
        )
        .all()
    )

    return [
    {
        "id": stroke.id,
        "stroke_type": stroke.stroke_type,
        "x": stroke.x,
        "y": stroke.y,
        "prevX": stroke.prev_x,
        "prevY": stroke.prev_y,
        "color": stroke.color,
        "width": stroke.width
    }
    for stroke in strokes
]
# =========================================================
# GET MIC PERMISSIONS
# =========================================================

@router.get("/{classroom_id}/mic/permissions")
def get_mic_permissions(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    # پیدا کردن کلاس
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    # فقط اعضای کلاس می‌توانند permissionها را ببینند
    # فعلاً همان ساختار ساده‌ی پروژه را حفظ می‌کنیم.
    permissions = (
        db.query(MicPermission)
        .filter(
            MicPermission.classroom_id == classroom_id
        )
        .all()
    )

    return [
        {
            "user_id": permission.user_id,
            "can_speak": permission.can_speak
        }
        for permission in permissions
    ]
# =========================================================
# GRANT WHITEBOARD PERMISSION
# =========================================================
@router.get("/{classroom_id}/whiteboard/permissions")
def get_whiteboard_permissions(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    permissions = (
        db.query(WhiteboardPermission)
        .filter(
            WhiteboardPermission.classroom_id == classroom_id
        )
        .all()
    )

    return [
        {
            "user_id": permission.user_id,
            "can_draw": permission.can_draw
        }
        for permission in permissions
    ]

@router.post("/{classroom_id}/whiteboard/permissions/{user_id}")
def grant_whiteboard_permission(
    classroom_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    # پیدا کردن کلاس
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    # فقط استاد صاحب کلاس اجازه دارد
    if classroom.owner_id != current_user.id: # type: ignore
        raise HTTPException(
            status_code=403,
            detail="Only the teacher can manage whiteboard permissions"
        )

    # پیدا کردن دانشجو
    student = (
        db.query(User)
        .filter(User.id == user_id)
        .first()
    )

    if student is None:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    # نباید به استاد permission بدهیم
    if student.role == "teacher": # type: ignore
        raise HTTPException(
            status_code=400,
            detail="Teacher already has whiteboard permission"
        )

    # آیا قبلاً permission وجود دارد؟
    permission = (
        db.query(WhiteboardPermission)
        .filter(
            WhiteboardPermission.classroom_id == classroom_id,
            WhiteboardPermission.user_id == user_id
        )
        .first()
    )

    # اگر وجود ندارد، بساز
    if permission is None:

        permission = WhiteboardPermission(
            classroom_id=classroom_id,
            user_id=user_id,
            can_draw=True
        )

        db.add(permission)

    else:
        # اگر وجود دارد، فعالش کن
        permission.can_draw = True # pyright: ignore[reportAttributeAccessIssue]

    db.commit()

    return {
        "message": "Whiteboard permission granted",
        "user_id": user_id,
        "can_draw": True
    }


# =========================================================
# REVOKE WHITEBOARD PERMISSION
# =========================================================

@router.delete("/{classroom_id}/whiteboard/permissions/{user_id}")
def revoke_whiteboard_permission(
    classroom_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    # پیدا کردن کلاس
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    # فقط صاحب کلاس
    if classroom.owner_id != current_user.id: # type: ignore
        raise HTTPException(
            status_code=403,
            detail="Only the teacher can manage whiteboard permissions"
        )

    # پیدا کردن permission
    permission = (
        db.query(WhiteboardPermission)
        .filter(
            WhiteboardPermission.classroom_id == classroom_id,
            WhiteboardPermission.user_id == user_id
        )
        .first()
    )

    if permission is None:
        return {
            "message": "Permission already revoked",
            "user_id": user_id,
            "can_draw": False
        }

    permission.can_draw = False # type: ignore

    db.commit()

    return {
        "message": "Whiteboard permission revoked",
        "user_id": user_id,
        "can_draw": False
    }

# =========================================================
# KICK STUDENT
# =========================================================

@router.post("/{classroom_id}/members/{user_id}/kick")
async def kick(
    classroom_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    result = kick_student(
        db,
        classroom_id,
        user_id,
        current_user
    )

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom or member not found"
        )

    if result is False:
        raise HTTPException(
            status_code=403,
            detail="Only the teacher can kick students"
        )

    # Broadcast to every connected client (including the kicked
    # student, who is still connected at this point) so all Online
    # Users lists stay in sync — not just the teacher's local state.
    await manager.broadcast(
        classroom_id,
        json.dumps({
            "type": "student_kicked",
            "user_id": user_id
        })
    )

    connections = manager.active_connections.get(
        classroom_id,
        []
    )

    for connection in connections:

        if connection["user_id"] == user_id:

            try:
                await connection["websocket"].close(
                    code=4003
                )
            except Exception:
                pass

            break

    return {
        "message": "Student kicked",
        "user_id": user_id,
        "status": "kicked"
    }
# =========================================================
# REQUEST REJOIN
# =========================================================

@router.post("/{classroom_id}/rejoin")
def rejoin(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    result = request_rejoin(
        db,
        classroom_id,
        current_user
    )

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    if result is False:
        raise HTTPException(
            status_code=400,
            detail="You cannot request to rejoin this classroom"
        )

    return {
        "message": "Rejoin request sent",
        "user_id": current_user.id,
        "status": "pending"
    }
# =========================================================
# GET JOIN REQUESTS
# =========================================================

@router.get("/{classroom_id}/join-requests")
def join_requests(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    result = get_join_requests(
        db,
        classroom_id,
        current_user
    )

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    if result is False:
        raise HTTPException(
            status_code=403,
            detail="Only the teacher can view join requests"
        )

    return result

# =========================================================
# APPROVE REJOIN
# =========================================================

@router.post("/{classroom_id}/join-requests/{user_id}/approve")
def approve(
    classroom_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    result = approve_rejoin(
        db,
        classroom_id,
        user_id,
        current_user
    )

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom or request not found"
        )

    if result is False:
        raise HTTPException(
            status_code=403,
            detail="Only the teacher can approve requests"
        )

    return {
        "message": "Rejoin request approved",
        "user_id": user_id,
        "status": "active"
    }

    # =========================================================
# REJECT REJOIN
# =========================================================

@router.post("/{classroom_id}/join-requests/{user_id}/reject")
def reject(
    classroom_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    result = reject_rejoin(
        db,
        classroom_id,
        user_id,
        current_user
    )

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom or request not found"
        )

    if result is False:
        raise HTTPException(
            status_code=403,
            detail="Only the teacher can reject requests"
        )

    return {
        "message": "Rejoin request rejected",
        "user_id": user_id,
        "status": "kicked"
    }

# =========================================================
# LEAVE CLASSROOM - STUDENT
# =========================================================

@router.delete("/{classroom_id}/leave")
def leave_classroom(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    # پیدا کردن کلاس
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found"
        )

    # استاد صاحب کلاس نمی‌تواند کلاس خودش را Leave کند
    if classroom.owner_id == current_user.id:
        raise HTTPException(
            status_code=400,
            detail="Teacher cannot leave their own classroom"
        )

    # پیدا کردن عضویت دانشجو
    membership = (
        db.query(ClassroomMember)
        .filter(
            ClassroomMember.classroom_id == classroom_id,
            ClassroomMember.user_id == current_user.id
        )
        .first()
    )

    if membership is None:
        raise HTTPException(
            status_code=404,
            detail="You are not a member of this classroom"
        )

    # حذف عضویت
    db.delete(membership)
    db.commit()

    return {
        "message": "Left classroom successfully",
        "classroom_id": classroom_id
    }