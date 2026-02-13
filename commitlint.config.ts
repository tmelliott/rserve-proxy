export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Allow these scopes matching project structure
    "scope-enum": [
      2,
      "always",
      [
        "api",
        "ui",
        "shared",
        "spawner",
        "db",
        "docker",
        "traefik",
        "deps",
        "ci",
      ],
    ],
    "scope-empty": [0], // scope is optional
  },
};
