import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ntk/shared", "@ntk/messaging", "@ntk/zk", "@ntk/bank-signer"],
  serverExternalPackages: ["@aztec/bb.js", "@noir-lang/noir_js", "@noir-lang/acvm_js", "@noir-lang/noirc_abi", "@noir-lang/types"],
};

export default nextConfig;
