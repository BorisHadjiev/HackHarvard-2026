import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ntk/shared", "@ntk/messaging"],
};

export default nextConfig;
