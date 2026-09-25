import random
import string

from sqlalchemy.orm import Session

from app.models.classroom import Classroom
from app.schemas.classroom import ClassroomCreate
from app.models.user import User
from app.models.classroom_member import ClassroomMember


def generate_invite_code():
    return ''.join(
        random.choices(
            string.ascii_uppercase + string.digits,
            k=6
        )
    )


def create_classroom(
    db: Session,
    classroom: ClassroomCreate,
    user: User
):
    new_class = Classroom(
        title=classroom.title,
        description=classroom.description,
        invite_code=generate_invite_code(),
        owner_id=user.id
    )

    db.add(new_class)
    db.commit()
    db.refresh(new_class)

    return new_class


def get_my_classrooms(
    db: Session,
    owner_id: int
):
    return (
        db.query(Classroom)
        .filter(Classroom.owner_id == owner_id)
        .all()
    )


def get_classroom(
    db: Session,
    classroom_id: int,
    user: User
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        return None

    # Teacher صاحب کلاس
    if classroom.owner_id == user.id: # type: ignore
        return classroom

    # فقط عضو active اجازه ورود دارد
    is_member = (
        db.query(ClassroomMember)
        .filter(
            ClassroomMember.classroom_id == classroom.id,
            ClassroomMember.user_id == user.id,
            ClassroomMember.status == "active"
        )
        .first()
    )

    if is_member:
        return classroom

    return False


def get_classroom_members(
    db: Session,
    classroom_id: int,
    user: User
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        return None

    is_owner = classroom.owner_id == user.id

    is_member = (
        db.query(ClassroomMember)
        .filter(
            ClassroomMember.classroom_id == classroom_id,
            ClassroomMember.user_id == user.id,
            ClassroomMember.status == "active"
        )
        .first()
        is not None
    )

    if not is_owner and not is_member: # type: ignore
        return False

    members = (
        db.query(ClassroomMember)
        .filter(
            ClassroomMember.classroom_id == classroom_id
        )
        .all()
    )

    return [
        {
            "id": member.id,
            "user_id": member.user_id,
            "username": member.user.username,
            "status": member.status
        }
        for member in members
    ]


def join_classroom(
    db: Session,
    invite_code: str,
    user: User
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.invite_code == invite_code)
        .first()
    )

    if classroom is None:
        return None

    # Teacher نباید به کلاس خودش join شود
    if classroom.owner_id == user.id: # type: ignore
        return classroom

    member = (
        db.query(ClassroomMember)
        .filter(
            ClassroomMember.classroom_id == classroom.id,
            ClassroomMember.user_id == user.id
        )
        .first()
    )

    # اولین ورود
    if member is None:

        member = ClassroomMember(
            classroom_id=classroom.id,
            user_id=user.id,
            status="active"
        )

        db.add(member)
        db.commit()

        return {
            "status": "active",
            "classroom": classroom
        }

    # قبلاً Kick شده
    if member.status == "kicked": # type: ignore

        member.status = "pending" # type: ignore
        db.commit()

        return {
            "status": "pending",
            "classroom": classroom
        }

    # درخواست قبلاً در انتظار است
    if member.status == "pending": # type: ignore

        return {
            "status": "pending",
            "classroom": classroom
        }

    # active
    return {
        "status": "active",
        "classroom": classroom
    }
def get_joined_classrooms(
    db: Session,
    user_id: int
):
    return (
        db.query(Classroom)
        .join(
            ClassroomMember,
            Classroom.id == ClassroomMember.classroom_id
        )
        .filter(
            ClassroomMember.user_id == user_id,
            ClassroomMember.status == "active"
        )
        .all()
    )


def kick_student(
    db: Session,
    classroom_id: int,
    student_id: int,
    teacher: User
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        return None

    # فقط صاحب کلاس می‌تواند دانشجو را اخراج کند
    if classroom.owner_id != teacher.id: # type: ignore
        return False

    member = (
        db.query(ClassroomMember)
        .filter(
            ClassroomMember.classroom_id == classroom_id,
            ClassroomMember.user_id == student_id
        )
        .first()
    )

    if member is None:
        return None

    # استاد را نمی‌توان Kick کرد
    if member.user_id == classroom.owner_id: # type: ignore
        return False

    member.status = "kicked" # type: ignore

    db.commit()
    db.refresh(member)

    return member


def request_rejoin(
    db: Session,
    classroom_id: int,
    student: User
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        return None

    member = (
        db.query(ClassroomMember)
        .filter(
            ClassroomMember.classroom_id == classroom_id,
            ClassroomMember.user_id == student.id
        )
        .first()
    )

    if member is None:
        return False

    if member.status != "kicked": # type: ignore
        return False

    member.status = "pending" # type: ignore

    db.commit()
    db.refresh(member)

    return member


def approve_rejoin(
    db: Session,
    classroom_id: int,
    student_id: int,
    teacher: User
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        return None

    if classroom.owner_id != teacher.id: # type: ignore
        return False

    member = (
        db.query(ClassroomMember)
        .filter(
            ClassroomMember.classroom_id == classroom_id,
            ClassroomMember.user_id == student_id
        )
        .first()
    )

    if member is None:
        return None

    if member.status != "pending": # type: ignore
        return False

    member.status = "active" # type: ignore

    db.commit()
    db.refresh(member)

    return member


def reject_rejoin(
    db: Session,
    classroom_id: int,
    student_id: int,
    teacher: User
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        return None

    if classroom.owner_id != teacher.id: # type: ignore
        return False

    member = (
        db.query(ClassroomMember)
        .filter(
            ClassroomMember.classroom_id == classroom_id,
            ClassroomMember.user_id == student_id
        )
        .first()
    )

    if member is None:
        return None

    if member.status != "pending": # type: ignore
        return False

    member.status = "kicked" # type: ignore

    db.commit()
    db.refresh(member)

    return member

def get_join_requests(
    db: Session,
    classroom_id: int,
    teacher: User
):
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )

    if classroom is None:
        return None

    if classroom.owner_id != teacher.id: # type: ignore
        return False

    members = (
        db.query(ClassroomMember)
        .filter(
            ClassroomMember.classroom_id == classroom_id,
            ClassroomMember.status == "pending"
        )
        .all()
    )

    return [
        {
            "user_id": member.user_id,
            "username": member.user.username,
            "status": member.status
        }
        for member in members
    ]