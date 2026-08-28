import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['127.0.0.1'],
  images: {
  remotePatterns: [{ protocol: "https", hostname: "flagcdn.com" }],
  }
};

export default nextConfig;
