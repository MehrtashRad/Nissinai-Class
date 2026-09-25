import api from "../api/api";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./JoinClassroom.css";

export default function JoinClassroom() {

    const navigate = useNavigate();

    const [inviteCode, setInviteCode] = useState("");

    async function handleJoin(e) {

        e.preventDefault();

        try {

            const token = localStorage.getItem("token");

            const response = await api.post(
                "/classrooms/join",
                {
                    invite_code: inviteCode
                },
                {
                    headers: {
                        Authorization: "Bearer " + token
                    }
                }
            );

            alert("با موفقیت به کلاس پیوستید!");

            console.log(response.data);
            navigate("/student-dashboard");


        } catch(err) {

            console.log(err);
            alert("پیوستن به کلاس ناموفق بود.");

        }

    }


    return (
        <main className="join-page" dir="rtl">

            <div className="join-background">
                <div className="join-glow join-glow-one"></div>
                <div className="join-glow join-glow-two"></div>
            </div>

            <section className="join-container">

                <div className="join-brand">
                    <h1>Nissinai Class</h1>
                    <div className="join-brand-line"></div>
                </div>


                <div className="join-card">

                    <div className="join-card-icon">
                        +
                    </div>

                    <div className="join-header">

                        <span className="join-eyebrow">
                            پیوستن به کلاس
                        </span>

                        <h2>
                            ورود به یک کلاس جدید
                        </h2>

                        <p>
                            کد دعوتی را که از استاد دریافت کرده‌اید
                            وارد کنید تا به کلاس بپیوندید.
                        </p>

                    </div>


                    <form
                        onSubmit={handleJoin}
                        className="join-form"
                    >

                        <div className="join-form-group">

                            <label htmlFor="invite-code">
                                کد دعوت کلاس
                            </label>

                            <input
                                id="invite-code"
                                type="text"
                                placeholder="کد دعوت را وارد کنید"
                                value={inviteCode}
                                onChange={(e) =>
                                    setInviteCode(e.target.value)
                                }
                                required
                                autoComplete="off"
                                dir="ltr"
                            />

                            <span className="join-input-hint">
                                کد دعوت را دقیقاً همان‌طور که دریافت کرده‌اید وارد کنید.
                            </span>

                        </div>


                        <button
                            type="submit"
                            className="join-submit-button"
                        >
                            <span>
                                پیوستن به کلاس
                            </span>

                            <span className="join-button-arrow">
                                ←
                            </span>
                        </button>

                    </form>


                    <button
                        type="button"
                        className="join-back-button"
                        onClick={() =>
                            navigate("/student-dashboard")
                        }
                    >
                        بازگشت به داشبورد
                    </button>
                    </div>


                <p className="join-footer">
                    محیط آموزشی هوشمند برای یادگیری بهتر
                </p>

            </section>

        </main>
    );
}