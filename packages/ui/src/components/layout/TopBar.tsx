import { LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext.js";

export function TopBar() {
  const { user, logout } = useAuth();

  return (
    <header className="flex h-14 items-center justify-end border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600">
          {user?.username}
          {user?.role === "admin" && (
            <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
              admin
            </span>
          )}
        </span>
        <button
          onClick={logout}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </header>
  );
}
