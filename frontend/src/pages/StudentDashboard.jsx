import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import api, { API_URL } from "../api/api";
import "./StudentDashboard.css";

export default function StudentDashboard() {
    const navigate = useNavigate();

    const [classrooms, setClassrooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [accountName, setAccountName] = useState("");

    async function handleLeaveClassroom(classroomId) {
        const confirmed = window.confirm(
            "آیا مطمئن هستید که می‌خواهید از این کلاس خارج شوید؟"
        );

        if (!confirmed) {
            return;
        }

        try {
            const token = localStorage.getItem("token");

            await api.delete(
                `/classrooms/${classroomId}/leave`,
                {
                    headers: {
                        Authorization: "Bearer " + token
                    }
                }
            );

            setClassrooms((currentClassrooms) =>
                currentClassrooms.filter(
                    (classroom) =>
                        classroom.id !== classroomId
                )
            );

        } catch (error) {
            console.error(
                "Failed to leave classroom:",
                error
            );

            alert(
                error.response?.data?.detail ||
                "خروج از کلاس با مشکل مواجه شد."
            );
        }
    }

    const handleEnterClassroom = async (classroomId) => {
        try {
            const response = await fetch(
                `${API_URL}/classrooms/${classroomId}/teacher-online`,
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`
                    }
                }
            );

            if (!response.ok) {
                throw new Error(
                    "Failed to check classroom status"
                );
            }

            const data = await response.json();

            if (!data.teacher_online) {
                alert(
                    "استاد هنوز وارد کلاس نشده است."
                );
                return;
            }

            navigate(`/classroom/${classroomId}`);

        } catch (error) {
            console.error(
                "Failed to check teacher status:",
                error
            );

            alert(
                "امکان بررسی وضعیت کلاس وجود ندارد."
            );
        }
    };

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
                        decodedToken.username || "دانشجو"
                    );
                }
            } catch (error) {
                console.error(
                    "Failed to decode token:",
                    error
                );

                if (mounted) {
                    setAccountName("دانشجو");
                }
            }

            try {
                const response = await api.get(
                    "/classrooms/joined",
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
                    "Failed to load joined classrooms:",
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

    if (loading) {
        return (
            <main className="student-dashboard" dir="rtl">
                <div className="dashboard-loading">
                    <div className="loading-spinner"></div>

                    <p>
                        در حال بارگذاری کلاس‌ها...
                    </p>
                </div>
            </main>
        );
    }

    return (
        <main className="student-dashboard" dir="rtl">

            <header className="dashboard-header">

                <div className="dashboard-brand">
                    <span>Nissinai Class</span>
                </div>

                <div className="account-area">
                    <div className="account-avatar">
                        {accountName
                            ? accountName.charAt(0).toUpperCase()
                            : "د"}
                    </div>

                    <div className="account-info">
                        <span className="account-label">
                            حساب کاربری
                        </span>

                        <span className="account-name">
                            {accountName}
                        </span>
                    </div>
                </div>

            </header>

            <div className="dashboard-content">

                <section className="welcome-section">

                    <div className="welcome-text">
                        <span className="section-eyebrow">
                            پنل دانشجو
                        </span>

                        <h1>
                            سلام، {accountName}
                        </h1>

                        <p>
                            کلاس‌های خود را مدیریت کنید و
                            وارد محیط یادگیری شوید.
                        </p>
                    </div>

                    <button
                        type="button"
                        className="join-class-button"
                        onClick={() =>
                            navigate("/join-classroom")
                        }
                    >
                        <span className="join-icon">
                            +
                        </span>

                        <span>
                            پیوستن به کلاس
                        </span>
                    </button>

                </section>

                <div className="dashboard-divider"></div>

                <section className="classrooms-section">

                    <div className="section-heading">

                        <div>
                            <h2>
                                کلاس‌های من
                            </h2>

                            <p>
                                کلاس‌هایی که در آن‌ها عضو هستید
                            </p>
                        </div>

                        <span className="class-count">
                            {classrooms.length} کلاس
                        </span>

                    </div>

                    {classrooms.length === 0 ? (
                        <div className="empty-state">

                            <div className="empty-icon">
                                +
                            </div>

                            <h3>
                                هنوز در کلاسی عضو نیستید
                            </h3>

                            <p>
                                برای شروع یادگیری، با استفاده
                                از کد کلاس به یک کلاس بپیوندید.
                            </p>

                            <button
                                type="button"
                                onClick={() =>
                                    navigate("/join-classroom")
                                }
                            >
                                پیوستن به اولین کلاس
                            </button>

                        </div>
                    ) : (
                        <div className="classroom-grid">

                            {classrooms.map((classroom) => (
                                <article
                                    key={classroom.id}
                                    className="classroom-card"
                                >

                                    <div className="classroom-card-top">

                                        <div className="classroom-icon">
                                            ◈
                                        </div>

                                        <span className="classroom-status">
                                            عضو کلاس
                                        </span>

                                    </div>

                                    <div className="classroom-info">

                                        <h3>
                                            {classroom.title}
                                        </h3>

                                        <p>
                                            {classroom.description ||
                                                "توضیحی برای این کلاس ثبت نشده است."}
                                        </p>

                                    </div>

                                    <div className="classroom-actions">

                                        <button
                                            type="button"
                                            className="enter-class-button"
                                            onClick={() =>
                                                handleEnterClassroom(
                                                    classroom.id
                                                )
                                            }
                                        >
                                            ورود به کلاس

                                            <span>
                                                ←
                                            </span>
                                        </button>

                                        <button
                                            type="button"
                                            className="leave-class-button"
                                            onClick={() =>
                                                handleLeaveClassroom(
                                                    classroom.id
                                                )
                                            }
                                        >
                                            خروج
                                        </button>

                                    </div>

                                </article>
                            ))}

                        </div>
                    )}

                </section>

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