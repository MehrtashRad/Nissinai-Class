import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import api from "../api/api";
import "./TeacherDashboard.css";

export default function TeacherDashboard() {
    const navigate = useNavigate();

    const [editingClassroomId, setEditingClassroomId] = useState(null);
    const [editTitle, setEditTitle] = useState("");
    const [editDescription, setEditDescription] = useState("");
    const [classrooms, setClassrooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [accountName, setAccountName] = useState("");

    async function handleDeleteClassroom(classroomId) {
        const confirmed = window.confirm(
            "آیا مطمئن هستید که می‌خواهید این کلاس را حذف کنید؟"
        );

        if (!confirmed) {
            return;
        }

        try {
            const token = localStorage.getItem("token");

            await api.delete(
                `/classrooms/${classroomId}`,
                {
                    headers: {
                        Authorization: "Bearer " + token
                    }
                }
            );

            setClassrooms((previous) =>
                previous.filter(
                    (classroom) =>
                        classroom.id !== classroomId
                )
            );

            alert("کلاس با موفقیت حذف شد.");

        } catch (error) {
            console.error(error);

            if (error.response?.data?.detail) {
                alert(error.response.data.detail);
            } else {
                alert("حذف کلاس ناموفق بود.");
            }
        }
    }

    function handleEditClassroom(classroom) {
        setEditingClassroomId(classroom.id);
        setEditTitle(classroom.title);
        setEditDescription(
            classroom.description || ""
        );
    }

    async function handleSaveEdit(classroomId) {
        if (editTitle.trim() === "") {
            alert("نام کلاس نمی‌تواند خالی باشد.");
            return;
        }

        try {
            const token = localStorage.getItem("token");

            const response = await api.put(
                `/classrooms/${classroomId}`,
                {
                    title: editTitle.trim(),
                    description: editDescription.trim()
                },
                {
                    headers: {
                        Authorization: "Bearer " + token
                    }
                }
            );

            setClassrooms((previous) =>
                previous.map((classroom) =>
                    classroom.id === classroomId
                        ? response.data
                        : classroom
                )
            );

            setEditingClassroomId(null);
            setEditTitle("");
            setEditDescription("");

        } catch (error) {
            console.log(
                "STATUS:",
                error.response?.status
            );

            console.log(
                "RESPONSE:",
                error.response?.data
            );

            console.error(error);

            if (error.response?.data?.detail) {
                alert(error.response.data.detail);
            } else {
                alert("ویرایش کلاس ناموفق بود.");
            }
        }
    }

    function handleCancelEdit() {
        setEditingClassroomId(null);
        setEditTitle("");
        setEditDescription("");
    }

    useEffect(() => {
        let mounted = true;

        async function loadDashboard() {
            const token = localStorage.getItem("token");

            if (!token) {
                navigate("/");
                return;
            }

            try {
                const decodedToken = jwtDecode(token);

                if (mounted) {
                    setAccountName(
                        decodedToken.username || "Teacher"
                    );
                }

            } catch (error) {
                console.error(
                    "Failed to decode token:",
                    error
                );

                if (mounted) {
                    setAccountName("Teacher");
                }
            }

            try {
                const response = await api.get(
                    "/classrooms",
                    {
                        headers: {
                            Authorization: "Bearer " + token
                        }
                    }
                );

                if (mounted) {
                    setClassrooms(response.data);
                }

            } catch (error) {
                console.error(
                    "Failed to load classrooms:",
                    error
                );

            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        }

        loadDashboard();

        return () => {
            mounted = false;
        };
    }, [navigate]);

    async function copyInviteCode(code) {
        try {
            await navigator.clipboard.writeText(code);
            alert("کد دعوت کپی شد!");

        } catch (error) {
            console.error(
                "Failed to copy invite code:",
                error
            );

            alert("امکان کپی کردن کد دعوت وجود ندارد.");
        }
    }

    if (loading) {
        return (
            <main
                className="teacher-page"
                dir="rtl"
            >
                <div className="teacher-loading">
                    <div className="teacher-loading-brand">
                        Nissinai Class
                    </div>

                    <div className="teacher-loading-spinner"></div>

                    <p>
                        در حال بارگذاری داشبورد...
                    </p>
                </div>
            </main>
        );
    }

    return (
        <main
            className="teacher-page"
            dir="rtl"
        >

            <div className="teacher-background">
                <div className="teacher-glow teacher-glow-one"></div>
                <div className="teacher-glow teacher-glow-two"></div>
            </div>


            <div className="teacher-wrapper">

                {/* =========================
                    HEADER
                ========================= */}

                <header className="teacher-header">

                    <div className="teacher-brand">
                        <h1>
                            Nissinai Class
                        </h1>

                        <div className="teacher-brand-line"></div>
                    </div>


                    <div className="teacher-account">

                        <div className="teacher-account-avatar">
                            {accountName
                                ? accountName.charAt(0).toUpperCase()
                                : "T"}
                        </div>

                        <div className="teacher-account-info">

                            <span>
                                حساب کاربری
                            </span>

                            <strong>
                                {accountName}
                            </strong>

                        </div>

                    </div>

                </header>


                {/* =========================
                    HERO
                ========================= */}

                <section className="teacher-hero">

                    <div className="teacher-hero-content">

                        <span className="teacher-eyebrow">
                            پنل مدرس
                        </span>

                       <h1>
                            سلام، {accountName}
                        </h1>

                        <p>
                            کلاس‌های خود را مدیریت کنید،
                            کد دعوت را با دانشجویان به اشتراک بگذارید
                            و وارد محیط کلاس شوید.
                        </p>

                    </div>


                    <button
                        type="button"
                        className="teacher-create-button"
                        onClick={() =>
                            navigate("/create-classroom")
                        }
                    >
                        <span className="teacher-create-icon">
                            +
                        </span>

                        <span>
                            ایجاد کلاس جدید
                        </span>
                    </button>

                </section>


                {/* =========================
                    SECTION HEADER
                ========================= */}

                <div className="teacher-section-header">

                    <div>
                        <span>
                            فضای آموزشی شما
                        </span>

                        <h3>
                            کلاس‌های من
                        </h3>
                    </div>

                    <div className="teacher-class-count">
                        <strong>
                            {classrooms.length}
                        </strong>

                        <span>
                            کلاس
                        </span>
                    </div>

                </div>


                {/* =========================
                    EMPTY STATE
                ========================= */}

                {classrooms.length === 0 ? (

                    <section className="teacher-empty">

                        <div className="teacher-empty-icon">
                            +
                        </div>

                        <h3>
                            هنوز کلاسی ایجاد نکرده‌اید
                        </h3>

                        <p>
                            اولین کلاس خود را ایجاد کنید
                            و فضای آموزشی‌تان را بسازید.
                        </p>

                        <button
                            type="button"
                            onClick={() =>
                                navigate("/create-classroom")
                            }
                        >
                            ایجاد اولین کلاس
                        </button>

                    </section>

                ) : (

                    /* =========================
                       CLASSROOM GRID
                    ========================= */

                    <section className="teacher-classrooms">

                        {classrooms.map((classroom) => (

                            <article
                                key={classroom.id}
                                className={`teacher-class-card ${
                                    editingClassroomId === classroom.id
                                        ? "teacher-card-editing"
                                        : ""
                                }`}
                            >

                                {editingClassroomId === classroom.id ? (

                                    /* =========================
                                       EDIT MODE
                                    ========================= */

                                    <div className="teacher-edit-mode">

                                        <div className="teacher-edit-header">

                                            <div>
                                                <span>
                                                    ویرایش کلاس
                                                </span>

                                                <h3>
                                                    اطلاعات کلاس
                                                </h3>
                                            </div>

                                            <div className="teacher-edit-icon">
                                                ✎
                                            </div>

                                        </div>


                                        <div className="teacher-edit-form">

                                            <div className="teacher-field">

                                                <label>
                                                    نام کلاس
                                                </label>

                                                <input
                                                    type="text"
                                                    value={editTitle}
                                                    onChange={(e) =>
                                                        setEditTitle(
                                                            e.target.value
                                                        )
                                                    }
                                                />

                                            </div>


                                            <div className="teacher-field">

                                                <label>
                                                    توضیحات کلاس
                                                </label>

                                                <textarea
                                                    value={editDescription}
                                                    onChange={(e) =>
                                                        setEditDescription(
                                                            e.target.value
                                                        )
                                                    }
                                                    rows="4"
                                                />

                                            </div>

                                        </div>


                                        <div className="teacher-edit-actions">

                                            <button
                                                type="button"
                                                className="teacher-save-button"
                                                onClick={() =>
                                                    handleSaveEdit(
                                                        classroom.id
                                                    )
                                                }
                                            >
                                                ذخیره تغییرات
                                            </button>

                                            <button
                                                type="button"
                                                className="teacher-cancel-button"
                                                onClick={
                                                    handleCancelEdit
                                                }
                                            >
                                                انصراف
                                            </button>

                                        </div>

                                    </div>

                                ) : (

                                    /* =========================
                                       NORMAL CARD
                                    ========================= */

                                    <>

                                        <div className="teacher-card-top">

                                            <div className="teacher-card-symbol">
                                                ◈
                                            </div>

                                            <div className="teacher-card-menu">
                                                کلاس
                                            </div>

                                        </div>


                                        <div className="teacher-card-content">

                                            <h3>
                                                {classroom.title}
                                            </h3>

                                            <p>
                                                {classroom.description ||
                                                    "توضیحی برای این کلاس ثبت نشده است."}
                                            </p>

                                        </div>


                                        {/* Invite */}

                                        <div className="teacher-invite">

                                            <div className="teacher-invite-label">
                                                <span>
                                                    کد دعوت
                                                </span>

                                                <small>
                                                    برای اشتراک‌گذاری با دانشجویان
                                                </small>
                                            </div>


                                            <div className="teacher-invite-code">

                                                <code>
                                                    {classroom.invite_code}
                                                </code>

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        copyInviteCode(
                                                            classroom.invite_code
                                                        )
                                                    }
                                                    aria-label="کپی کد دعوت"
                                                >
                                                    کپی
                                                </button>

                                            </div>

                                        </div>


                                        {/* Actions */}

                                        <div className="teacher-card-actions">

                                            <button
                                                type="button"
                                                className="teacher-enter-button"
                                                onClick={() =>
                                                    navigate(
                                                        `/classroom/${classroom.id}`
                                                    )
                                                }
                                            >
                                                <span>
                                                    ورود به کلاس
                                                </span>

                                                <span>
                                                    ←
                                                </span>
                                            </button>


                                            <div className="teacher-secondary-actions">

                                                <button
                                                    type="button"
                                                    className="teacher-edit-button"
                                                    onClick={() =>
                                                        handleEditClassroom(
                                                            classroom
                                                        )
                                                    }
                                                >
                                                    ویرایش
                                                </button>


                                                <button
                                                    type="button"
                                                    className="teacher-delete-button"
                                                    onClick={() =>
                                                        handleDeleteClassroom(
                                                            classroom.id
                                                        )
                                                    }
                                                >
                                                    حذف
                                                </button>

                                            </div>

                                        </div>

                                    </>

                                )}

                            </article>

                        ))}

                    </section>

                )}

            </div>

            <footer className="dashboard-footer">
                <span>
                    Nissinai Class
                </span>

                <span>
                    محیط آموزشی هوشمند برای یادگیری بهتر
                </span>
            </footer>

        </main>
    );
}