import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import api from "../api/api";
import "./Login.css";

export default function Login() {
    const navigate = useNavigate();

    const [nationalId, setNationalId] = useState("");
    const [institutionalId, setInstitutionalId] = useState("");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleLogin(event) {
        event.preventDefault();

        setError("");
        setLoading(true);

        try {
            const formData = new URLSearchParams();

            // Backend فعلاً از OAuth2PasswordRequestForm استفاده می‌کند
            // بنابراین National ID را در username
            // و Institutional ID را در password می‌فرستیم.

            formData.append("username", nationalId);
            formData.append("password", institutionalId);

            const response = await api.post(
                "/auth/login",
                formData,
                {
                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded"
                    }
                }
            );

            const token = response.data.access_token;

            // ذخیره JWT
            localStorage.setItem("token", token);

            // خواندن اطلاعات داخل JWT
            const decodedToken = jwtDecode(token);

            console.log("Decoded token:", decodedToken);

            const role = decodedToken.role;

            // انتقال بر اساس نقش
            if (role === "teacher") {
                navigate("/teacher-dashboard");
            } else if (role === "student") {
                navigate("/student-dashboard");
            } else {
                setError("نقش کاربری نامعتبر است.");
                localStorage.removeItem("token");
            }

        } catch (err) {
            console.error(err);

            if (err.response && err.response.data) {
                const detail = err.response.data.detail;

                if (typeof detail === "string") {
                    setError(detail);
                } else {
                    setError("ورود ناموفق بود.");
                }
            } else {
                setError("امکان اتصال به سرور وجود ندارد.");
            }

        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="login-page" dir="rtl">
            <div className="login-background">
                <div className="login-glow login-glow-one"></div>
                <div className="login-glow login-glow-two"></div>
            </div>

            <section className="login-container">
                <div className="login-brand">


                    <h1>Nissinai Class</h1>

                    <div className="brand-line"></div>
                </div>

                <div className="login-card">
                    <div className="login-header">
                        <h2>خوش آمدید</h2>
                        <p>
                            برای ورود به کلاس، اطلاعات حساب خود را وارد کنید
                        </p>
                    </div>

                    <form onSubmit={handleLogin} className="login-form">

                        <div className="form-group">
                            <label htmlFor="national-id">
                               نام کاربری
                            </label>

                            <div className="input-wrapper">
                                <span className="input-icon">
                                    ◉
                                </span>
<input
                                    id="national-id"
                                    type="text"
                                    placeholder="نام کاربری خود را وارد کنید"
                                    value={nationalId}
                                    onChange={(event) =>
                                        setNationalId(event.target.value)
                                    }
                                    required
                                    autoComplete="username"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="institutional-id">
                               رمز عبور
                            </label>

                            <div className="input-wrapper">
                                <span className="input-icon">
                                    ◈
                                </span>

                                <input
                                    id="institutional-id"
                                    type="password"
                                    placeholder="رمز عبور خود را وارد کنید"
                                    value={institutionalId}
                                    onChange={(event) =>
                                        setInstitutionalId(event.target.value)
                                    }
                                    required
                                    autoComplete="current-password"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="login-error">
                                <span className="error-icon">!</span>
                                <span>{error}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="login-button"
                        >
                            <span>
                                {loading
                                    ? "در حال ورود..."
                                    : "ورود به حساب"}
                            </span>

                            {!loading && (
                                <span className="button-arrow">
                                    ←
                                </span>
                            )}
                        </button>
                    </form>

                    <div className="register-section">
                        <span>هنوز حساب کاربری ندارید؟</span>

                        <button
                            type="button"
                            onClick={() =>
                                navigate("/register")
                            }
                            className="register-button"
                        >
                          به عنوان مهمان ثبت‌نام کنید
                        </button>
                    </div>
                </div>

                <p className="login-footer">
                    محیط آموزشی هوشمند برای یادگیری بهتر
                </p>
            </section>
        </main>
    );
} 