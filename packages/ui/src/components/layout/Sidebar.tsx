import { NavLink } from "react-router-dom";
import { Box, Key, UserCircle } from "lucide-react";
import clsx from "clsx";

const links = [
  { to: "/", label: "Apps", icon: Box },
  { to: "/tokens", label: "API Tokens", icon: Key },
  { to: "/profile", label: "Profile", icon: UserCircle },
] as const;

export function Sidebar() {
  return (
    <aside className="flex w-56 flex-col border-r border-gray-200 bg-gray-50">
      <div className="flex h-14 items-center border-b border-gray-200 px-4">
        <span className="text-lg font-semibold text-gray-900">
          rserve-proxy
        </span>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-3">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                isActive
                  ? "bg-gray-200 text-gray-900"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
