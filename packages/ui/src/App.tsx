import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.js";
import { AppShell } from "./components/layout/AppShell.js";
import { Login } from "./pages/Login.js";
import { AppList } from "./pages/apps/AppList.js";
import { AppNew } from "./pages/apps/AppNew.js";
import { AppDetail } from "./pages/apps/AppDetail.js";
import { AppEdit } from "./pages/apps/AppEdit.js";
import { AppLogs } from "./pages/apps/AppLogs.js";

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AppShell />}>
            <Route index element={<AppList />} />
            <Route path="apps/new" element={<AppNew />} />
            <Route path="apps/:id" element={<AppDetail />} />
            <Route path="apps/:id/edit" element={<AppEdit />} />
            <Route path="apps/:id/logs" element={<AppLogs />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
