import type { NextConfig } from "next";
import { resolveAppNetwork } from "./lib/config/network";

// Resolve the active Arc network ONCE at build/config time and inline it
// into both the server and client bundles. This is what lets the no-secret
// value `process.env.NEXT_PUBLIC_APP_NETWORK` be read from client
// components (chain pickers, deposit modal, …) without asking you to
// duplicate the decision in Vercel's env settings: production builds get
// "mainnet", local/preview builds get "testnet".
const appNetwork = resolveAppNetwork(process.env);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_NETWORK: appNetwork,
  },
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "flagcdn.com" }],
  },
};

export default nextConfig;
