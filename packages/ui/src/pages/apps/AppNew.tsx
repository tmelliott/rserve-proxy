import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { api, ApiError } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.js";
import { TagInput } from "../../components/ui/TagInput.js";
import { Button } from "../../components/ui/Button.js";

interface AppFormData {
  name: string;
  slug: string;
  rVersion: string;
  packages: string[];
  codeSourceType: "git" | "upload";
  repoUrl: string;
  branch: string;
  entryScript: string;
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function AppNew() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [rVersions, setRVersions] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<AppFormData>({
    defaultValues: {
      name: "",
      slug: "",
      rVersion: "4.4.1",
      packages: [],
      codeSourceType: "git",
      repoUrl: "",
      branch: "",
      entryScript: "run_rserve.R",
    },
  });

  const codeSourceType = watch("codeSourceType");

  useEffect(() => {
    api.apps.rVersions().then(({ versions }) => {
      setRVersions(versions);
      if (versions.length > 0) setValue("rVersion", versions[0]);
    });
  }, [setValue]);

  const onSubmit = async (data: AppFormData) => {
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

      const { app } = await api.apps.create({
        name: data.name,
        slug: data.slug,
        rVersion: data.rVersion,
        packages: data.packages,
        codeSource,
        entryScript: data.entryScript,
        replicas: 1,
      });
      navigate(`/apps/${app.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create app",
      );
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-lg font-semibold text-gray-900">New App</h1>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5">
        <Input
          id="name"
          label="Name"
          {...register("name", {
            required: "Name is required",
            onChange: (e) => {
              if (!slugEdited) {
                setValue("slug", slugify(e.target.value));
              }
            },
          })}
          error={errors.name?.message}
        />

        <Input
          id="slug"
          label="Slug"
          {...register("slug", {
            required: "Slug is required",
            pattern: {
              value: /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/,
              message:
                "3-64 chars, lowercase letters, numbers, and hyphens only",
            },
            onChange: () => setSlugEdited(true),
          })}
          error={errors.slug?.message}
          placeholder="my-app"
        />

        <div>
          <label htmlFor="rVersion" className="block text-sm font-medium text-gray-700">
            R Version
          </label>
          <select
            id="rVersion"
            {...register("rVersion", { required: "R version is required" })}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            {rVersions.length === 0 && (
              <option value="">Loading...</option>
            )}
            {rVersions.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          {errors.rVersion?.message && (
            <p className="mt-1 text-sm text-red-600">{errors.rVersion.message}</p>
          )}
        </div>

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
              placeholder="https://github.com/user/repo"
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
          <p className="text-sm text-gray-500">
            You can upload files after creating the app.
          </p>
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
            Create App
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("/")}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
