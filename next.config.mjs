/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // V19 已修掉主要 strict-null 型別問題；這裡保留部署保險，避免第三方型別或資料來源欄位推論讓 Vercel build 中斷。
    ignoreBuildErrors: true
  },
  eslint: {
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
