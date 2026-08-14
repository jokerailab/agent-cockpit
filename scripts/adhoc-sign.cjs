// electron-builder afterPack hook.
// No Developer ID cert → electron-builder skips signing entirely, which leaves
// the bundle's seal not covering the injected app.asar → Gatekeeper reports the
// downloaded arm64 app as "damaged". We ad-hoc deep-sign the whole .app here so
// the seal is valid; users still do a one-time "Open Anyway" (no notarization).
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = join(context.appOutDir, `${appName}.app`);
  // --deep is deprecated for real signing but is the pragmatic path for ad-hoc
  // sealing of an Electron bundle (nested frameworks + helpers) with no identity.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit"
  });
  console.log(`  • ad-hoc signed ${appName}.app`);
};
