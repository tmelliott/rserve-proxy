import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { Upload } from "lucide-react";
import type { AppConfig } from "@rserve-proxy/shared";
import { api, ApiError } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.js";
import { TagInput } from "../../components/ui/TagInput.js";
import { Button } from "../../components/ui/Button.js";
import { Spinner } from "../../components/ui/Spinner.js";

interface EditFormData {
  name: string;
  rVersion: string;
  packages: string[];
  codeSourceType: "git" | "upload";
  repoUrl: string;
  branch: string;
  entryScript: string;
}

export function AppEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [app, setApp] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<EditFormData>();

  const codeSourceType = watch("codeSourceType");

  useEffect(() => {
    if (!id) return;
    api.apps
      .get(id)
      .then(({ app }) => {
        setApp(app);
        reset({
          name: app.name,
          rVersion: app.rVersion,
          packages: app.packages,
          codeSourceType: app.codeSource.type,
          repoUrl:
            app.codeSource.type === "git" ? app.codeSource.repoUrl : "",
          branch:
            app.codeSource.type === "git"
              ? (app.codeSource.branch ?? "")
              : "",
          entryScript: app.entryScript,
        });
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load app"),
      )
      .finally(() => setLoading(false));
  }, [id, reset]);

  const onSubmit = async (data: EditFormData) => {
    if (!id) return;
    setError("");
    try {
      const codeSource =
        data.codeSourceType === "git"
          ? {
              type: "git" as const,
              repoUrl: data.repoUrl,
              ...(data.branch ? { branch: data.branch } : {}),
            }
          : { type: "upload" as const };

      await api.apps.update(id, {
        name: data.name,
        rVersion: data.rVersion,
        packages: data.packages,
        codeSource,
        entryScript: data.entryScript,
      });
      navigate(`/apps/${id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to update app",
      );
    }
  };

  const handleUpload = async (file: File) => {
    if (!id) return;
    setUploadStatus("");
    try {
      const result = await api.apps.upload(id, file);
      setUploadStatus(`Uploaded: ${result.filename}`);
    } catch (err) {
      setUploadStatus(
        err instanceof ApiError ? err.message : "Upload failed",
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-red-600">{error || "App not found"}</p>
        <Link to="/" className="mt-2 inline-block text-sm text-indigo-600">
          Back to apps
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-lg font-semibold text-gray-900">
        Edit {app.name}
      </h1>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5">
        <Input
          id="name"
          label="Name"
          {...register("name", { required: "Name is required" })}
          error={errors.name?.message}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Slug
          </label>
          <p className="mt-1 text-sm text-gray-500">{app.slug}</p>
        </div>

        <Input
          id="rVersion"
          label="R Version"
          {...register("rVersion", {
            required: "R version is required",
            pattern: {
              value: /^\d+\.\d+\.\d+$/,
              message: "Must be X.Y.Z format",
            },
          })}
          error={errors.rVersion?.message}
        />

        <Controller
          name="packages"
          control={control}
          render={({ field }) => (
            <TagInput
              label="R Packages"
              value={field.value}
              onChange={field.onChange}
              placeholder="e.g. dplyr, ggplot2"
            />
          )}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Code Source
          </label>
          <div className="mt-2 flex gap-4">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                value="git"
                {...register("codeSourceType")}
                className="text-indigo-600"
              />
              Git repository
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                value="upload"
                {...register("codeSourceType")}
                className="text-indigo-600"
              />
              File upload
            </label>
          </div>
        </div>

        {codeSourceType === "git" && (
          <>
            <Input
              id="repoUrl"
              label="Repository URL"
              {...register("repoUrl", {
                required:
                  codeSourceType === "git"
                    ? "Repository URL is required"
                    : false,
              })}
              error={errors.repoUrl?.message}
            />
            <Input
              id="branch"
              label="Branch (optional)"
              {...register("branch")}
              placeholder="main"
            />
          </>
        )}

        {codeSourceType === "upload" && (
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Upload Files
            </label>
            <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 hover:border-gray-400">
              <Upload className="h-4 w-4" />
              Choose .zip, .tar.gz, .tgz, or .R file
              <input
                type="file"
                accept=".zip,.tar.gz,.tgz,.R"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
              />
            </label>
            {uploadStatus && (
              <p className="mt-1 text-xs text-gray-600">{uploadStatus}</p>
            )}
          </div>
        )}

        <Input
          id="entryScript"
          label="Entry Script"
          {...register("entryScript", {
            required: "Entry script is required",
          })}
          error={errors.entryScript?.message}
        />

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={isSubmitting}>
            Save Changes
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate(`/apps/${id}`)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
