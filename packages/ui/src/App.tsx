import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard.js";
import { Login } from "./pages/Login.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
