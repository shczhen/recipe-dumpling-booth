// Match the development server and portable launcher: local use by default.
process.env.HOST ??= "127.0.0.1";
await import("../.output/server/index.mjs");
