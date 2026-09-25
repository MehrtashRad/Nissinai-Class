import { Routes, Route } from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import TeacherDashboard from "./pages/TeacherDashboard";
import StudentDashboard from "./pages/StudentDashboard";
import Classroom from "./pages/Classroom";
import CreateClassroom from "./pages/CreateClassroom";
import JoinClassroom from "./pages/JoinClassroom";

function App() {
return (
<Routes>
<Route path="/" element={<Login />} />

        <Route
            path="/register"
            element={<Register />}
        />

        <Route
            path="/teacher-dashboard"
            element={<TeacherDashboard />}
        />

        <Route
            path="/student-dashboard"
            element={<StudentDashboard />}
        />

        <Route
            path="/create-classroom"
            element={<CreateClassroom />}
        />

        <Route
            path="/join-classroom"
            element={<JoinClassroom />}
        />

        <Route
            path="/classroom/:id"
            element={<Classroom />}
        />
    </Routes>
);

}

export default App;