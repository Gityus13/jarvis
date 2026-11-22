const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

module.exports = async function signMacOS(context) {
  if (process.platform !== "darwin") return;

  const appOutDir = context.appOutDir;
  const appName = context.packager.appInfo.productFilename + ".app";
  const appPath = path.join(appOutDir, appName);
  if (!fs.existsSync(appPath)) {
    throw new Error(`Cannot ad-hoc sign missing app bundle: ${appPath}`);
  }

  execFileSync("/usr/bin/codesign", [
    "--deep",
    "--force",
    "--sign",
    "-",
    appPath,
  ], { stdio: "inherit" });

  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
};
