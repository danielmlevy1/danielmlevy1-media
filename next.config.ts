import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Served under the launcher's domain at /media (daniellevy.app/media → this
  // deploy). Next prefixes <Link>, router, redirect() and _next assets, but NOT
  // fetch(): use lib/base-path api() for same-app fetches. Bare "/" 404s.
  basePath: "/media",
  // firebase-admin pulls in ESM-only `jose`; keep it out of the bundle.
  serverExternalPackages: ["firebase-admin"],
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3095", "daniellevy.app"] },
  },
};

export default config;
