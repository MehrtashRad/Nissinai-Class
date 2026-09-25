import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/api";
import "./Register.css";

export default function Register() {
    const navigate = useNavigate();

    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState("student");
    const [teacherCode, setTeacherCode] = useState("");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleRegister(event) {
        event.preventDefault();

        setError("");

        if (role === "teacher" && teacherCode.trim() === "") {
            setError("کد استاد الزامی است.");
            return;
        }

        setLoading(true);

        try {
            const userData = {
                username: username,
                email: email,
                password: password,
                role: role
            };

            if (role === "teacher") {
                userData.teacher_code = teacherCode;
            }

            const response = await api.post(
                "/auth/register",
                userData
            );

            console.log(response.data);

            alert("ثبت‌نام با موفقیت انجام شد.");

            navigate("/");

        } catch (err) {
            console.error(err);

            if (err.response && err.response.data) {
                const detail = err.response.data.detail;

                if (typeof detail === "string") {
                    setError(detail);

                } else if (Array.isArray(detail)) {
                    setError(
                        detail
                            .map((item) => item.msg)
                            .join(", ")
                    );

                } else {
                    setError("ثبت‌نام ناموفق بود.");
                }

            } else {
                setError("امکان اتصال به سرور وجود ندارد.");
            }

        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="register-page" dir="rtl">
            <div className="register-background">
                <div className="register-glow register-glow-one"></div>
                <div className="register-glow register-glow-two"></div>
            </div>

            <section className="register-container">

                <div className="register-brand">
                    <h1>Nissinai Class</h1>
                    <div className="brand-line"></div>
                </div>

                <div className="register-card">

                    <div className="register-header">
                        <h2>ثبت‌نام به عنوان مهمان</h2>

                        <p>
                            برای ایجاد حساب کاربری، اطلاعات خود را وارد کنید
                        </p>
                    </div>

                    <form
                        onSubmit={handleRegister}
                        className="register-form"
                    >

                        <div className="form-group">
                            <label htmlFor="username">
                                نام کاربری
                            </label>

                            <div className="input-wrapper">
                                <span className="input-icon">
                                    ◉
                                </span>

                                <input
                                    id="username"
                                    type="text"
                                    placeholder="نام کاربری خود را وارد کنید"
                                    value={username}
                                    onChange={(event) =>
                                        setUsername(event.target.value)
                                    }
                                    required
                                    autoComplete="off"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="email">
                                ایمیل
                            </label>

                            <div className="input-wrapper">
                                <span className="input-icon">
                                    @
                                </span>

                                <input
                                    id="email"
                                    type="email"
                                    placeholder="ایمیل خود را وارد کنید"
                                    value={email}
                                    onChange={(event) =>
                                        setEmail(event.target.value)
                                    }
                                    required
                                    autoComplete="username"
                                    dir="ltr"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="password">
                                رمز عبور
                            </label>

                            <div className="input-wrapper">
                                <span className="input-icon">
                                    ◈
                                </span>

                                <input
                                    id="password"
                                    type="password"
                                    placeholder="رمز عبور خود را وارد کنید"
                                    value={password}
                                    onChange={(event) =>
                                        setPassword(event.target.value)
                                    }
                                    required
                                    autoComplete="new-password"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="role">
                                نوع حساب
                            </label>

                            <div className="input-wrapper select-wrapper">
                                <span className="input-icon">
                                    ◆
                                </span>

                                <select
                                    id="role"
                                    value={role}
                                    onChange={(event) => {
                                        setRole(event.target.value);
                                        setTeacherCode("");
                                        setError("");
                                    }}
                                >
                                    <option value="student">
                                        دانشجو
                                    </option>

                                    <option value="teacher">
                                        استاد
                                    </option>
                                </select>

                                <span className="select-arrow">
                                   ⌄
                                </span>
                            </div>
                        </div>

                        {role === "teacher" && (
                            <div className="form-group teacher-code-group">
                                <label htmlFor="teacher-code">
                                    کد استاد
                                </label>
                               <div className="input-wrapper">
                                    <span className="input-icon">
                                        ◆
                                    </span>

                                    <input
                                        id="teacher-code"
                                        type="text"
                                        placeholder="کد استاد را وارد کنید"
                                        value={teacherCode}
                                        onChange={(event) =>
                                            setTeacherCode(
                                                event.target.value
                                            )
                                        }
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="register-error">
                                <span className="error-icon">
                                    !
                                </span>

                                <span>
                                    {error}
                                </span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="register-submit"
                        >
                            <span>
                                {loading
                                    ? "در حال ثبت‌نام..."
                                    : "ثبت‌نام به عنوان مهمان"}
                            </span>

                            {!loading && (
                                <span className="button-arrow">
                                    ←
                                </span>
                            )}
                        </button>

                    </form>

                    <div className="login-section">
                        <span>
                            قبلاً حساب کاربری ساخته‌اید؟
                        </span>

                        <button
                            type="button"
                            onClick={() => navigate("/")}
                            className="back-login-button"
                        >
                            ورود به حساب
                        </button>
                    </div>

                </div>

                <p className="register-footer">
                    محیط آموزشی هوشمند برای یادگیری بهتر
                </p>

            </section>
        </main>
    );
} 