import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/api";
import "./CreateClassroom.css";

export default function CreateClassroom() {
    const navigate = useNavigate();

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleCreate(event) {
        event.preventDefault();

        setError("");

        const token = localStorage.getItem("token");

        if (!token) {
            navigate("/");
            return;
        }

        setLoading(true);

        try {
            await api.post(
                "/classrooms",
                {
                    title,
                    description
                },
                {
                    headers: {
                        Authorization: "Bearer " + token
                    }
                }
            );

            alert("کلاس با موفقیت ایجاد شد");

            navigate("/teacher-dashboard");

        } catch (error) {
            console.error(
                "Failed to create classroom:",
                error
            );

            if (
                error.response &&
                error.response.data &&
                error.response.data.detail
            ) {
                setError(
                    error.response.data.detail
                );
            } else {
                setError(
                    "ایجاد کلاس با مشکل مواجه شد."
                );
            }

        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="create-class-page" dir="rtl">

            <div className="create-class-background">
                <div className="create-class-glow create-class-glow-one"></div>
                <div className="create-class-glow create-class-glow-two"></div>
            </div>

            <section className="create-class-container">

                {/* Brand */}

                <div className="create-class-brand">
                    <h1>Nissinai Class</h1>
                    <div className="create-class-brand-line"></div>
                </div>

                {/* Back */}

                <button
                    type="button"
                    className="create-class-back"
                    onClick={() =>
                        navigate("/teacher-dashboard")
                    }
                >
                    <span>→</span>
                    <span>بازگشت به داشبورد استاد</span>
                </button>

                {/* Card */}

                <section className="create-class-card">

                    <div className="create-class-header">

                        <div className="create-class-icon">
                            +
                        </div>

                        <h2>
                            ایجاد کلاس جدید
                        </h2>

                        <p>
                            اطلاعات کلاس جدید خود را وارد کنید
                        </p>

                    </div>

                    <form
                        onSubmit={handleCreate}
                        className="create-class-form"
                    >

                        {/* Title */}

                        <div className="create-form-group">

                            <label htmlFor="class-title">
                                نام کلاس
                            </label>

                            <div className="create-input-wrapper">

                                <span className="create-input-icon">
                                    ◇
                                </span>

                                <input
                                id="class-title"
                                    type="text"
                                    placeholder="نام کلاس را وارد کنید"
                                    value={title}
                                    onChange={(event) =>
                                        setTitle(event.target.value)
                                    }
                                    required
                                />

                            </div>

                        </div>

                        {/* Description */}

                        <div className="create-form-group">

                            <label htmlFor="class-description">
                                توضیحات کلاس
                            </label>

                            <div className="create-textarea-wrapper">

                                <span className="create-textarea-icon">
                                    ≡
                                </span>

                                <textarea
                                    id="class-description"
                                    placeholder="توضیح کوتاهی درباره این کلاس بنویسید..."
                                    value={description}
                                    onChange={(event) =>
                                        setDescription(
                                            event.target.value
                                        )
                                    }
                                    rows="5"
                                />

                            </div>

                            <span className="create-field-hint">
                                توضیحات به دانش‌آموزان برای شناخت بهتر کلاس کمک می‌کند.
                            </span>

                        </div>

                        {/* Error */}

                        {error && (
                            <div className="create-class-error">

                                <span className="create-error-icon">
                                    !
                                </span>

                                <span>
                                    {error}
                                </span>

                            </div>
                        )}

                        {/* Submit */}

                        <button
                            type="submit"
                            disabled={loading}
                            className="create-class-button"
                        >

                            <span>
                                {loading
                                    ? "در حال ایجاد کلاس..."
                                    : "ایجاد کلاس"}
                            </span>

                            {!loading && (
                                <span className="create-button-arrow">
                                    ←
                                </span>
                            )}

                        </button>

                    </form>

                </section>

                <p className="create-class-footer">
                    محیط آموزشی هوشمند برای یادگیری بهتر
                </p>

            </section>

        </main>
    );
}