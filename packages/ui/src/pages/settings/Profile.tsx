import { useState } from "react";
import { useForm } from "react-hook-form";
import { Check } from "lucide-react";
import { useAuth } from "../../context/AuthContext.js";
import { api, ApiError } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function Profile() {
  const { user } = useAuth();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<PasswordForm>();

  const onSubmit = async (data: PasswordForm) => {
    setError("");
    setSuccess(false);
    try {
      await api.auth.changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      setSuccess(true);
      reset();
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to change password",
      );
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-lg font-semibold text-gray-900">Profile</h1>

      {/* Account info (read-only) */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-medium text-gray-700">Account</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Username</dt>
            <dd className="font-medium text-gray-900">{user?.username}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Email</dt>
            <dd className="font-medium text-gray-900">{user?.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Role</dt>
            <dd>
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                {user?.role}
              </span>
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Member since</dt>
            <dd className="text-gray-900">
              {user?.createdAt
                ? new Date(user.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "—"}
            </dd>
          </div>
        </dl>
      </div>

      {/* Change password */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-medium text-gray-700">Change password</h2>

        {error && (
          <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            <Check className="h-4 w-4" />
            Password changed successfully.
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          <Input
            id="current-password"
            type="password"
            label="Current password"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register("currentPassword", {
              required: "Current password is required",
            })}
          />
          <Input
            id="new-password"
            type="password"
            label="New password"
            autoComplete="new-password"
            error={errors.newPassword?.message}
            {...register("newPassword", {
              required: "New password is required",
              minLength: {
                value: 8,
                message: "Must be at least 8 characters",
              },
            })}
          />
          <Input
            id="confirm-password"
            type="password"
            label="Confirm new password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register("confirmPassword", {
              required: "Please confirm your new password",
              validate: (value) =>
                value === watch("newPassword") || "Passwords do not match",
            })}
          />
          <div className="pt-1">
            <Button type="submit" loading={isSubmitting}>
              Update password
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
