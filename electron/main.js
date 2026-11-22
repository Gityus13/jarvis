const { app, BrowserWindow, Menu, shell, session, systemPreferences } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile, spawn } = require("child_process");

const userDirectory = app.getPath("userData");
process.env.JARVIS_DATA_DIR = path.join(userDirectory, "data");
process.env.JARVIS_LOG_DIR = path.join(userDirectory, "logs");
process.env.JARVIS_BUNDLED_PLUGINS = path.join(app.getAppPath(), "plugins");
if (app.isPackaged) {
  process.env.JARVIS_PLUGIN_DIR = path.join(userDirectory, "plugins");
}
process.env.PORT = process.env.PORT || "3000";
process.env.HOST = "127.0.0.1";

fs.mkdirSync(process.env.JARVIS_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.JARVIS_LOG_DIR, { recursive: true });
if (app.isPackaged) {
  fs.mkdirSync(process.env.JARVIS_PLUGIN_DIR, { recursive: true });
  process.env.JARVIS_NATIVE_DICTATION = path.join(process.resourcesPath, "macos-dictation");
}
process.env.JARVIS_NATIVE_DICTATION = process.env.JARVIS_NATIVE_DICTATION ||
  (app.isPackaged ? path.join(process.resourcesPath, "macos-dictation") : path.join(app.getAppPath(), "resources", "macos-dictation"));

let window;

function findExecutable(names) {
  const fsPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    path.join(process.env.HOME || "", ".local", "bin"),
  ];
  for (const name of names) {
    for (const dir of fsPaths) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  for (const candidate of [
    "/Applications/Ollama.app/Contents/MacOS/Ollama",
    "/Applications/Ollama.app",
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function startOllama() {
  if (process.platform !== "darwin") return;
  const ollama = findExecutable(["ollama"]);
  if (!ollama) return;
  try {
    const args = ollama.endsWith(".app") ? ["-a", "Ollama"] : ["serve"];
    const command = ollama.endsWith(".app") ? "open" : ollama;
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
  } catch {}
}

function openOllamaSetup() {
  const ollama = findExecutable(["ollama"]);
  const command = ollama
    ? `${JSON.stringify(ollama)} serve; ollama pull llama3.2`
    : 'brew install ollama && ollama serve && ollama pull llama3.2';
  execFile("/usr/bin/osascript", [
    "-e",
    'tell application "Terminal" to activate',
    "-e",
    `tell application "Terminal" to do script "${command.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  ]);
}

function openPermissions() {
  const script = app.isPackaged
    ? path.join(process.resourcesPath, "setup-permissions.sh")
    : path.join(app.getAppPath(), "setup-permissions.sh");

  const executable = process.execPath;
  const command = `JARVIS_EXECUTABLE_PATH=${JSON.stringify(executable)} bash ${JSON.stringify(script)}`;
  const appleScriptCommand = command
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  execFile("/usr/bin/osascript", [
    "-e",
    'tell application "Terminal" to activate',
    "-e",
    `tell application "Terminal" to do script "${appleScriptCommand}"`,
  ], (error) => {
    if (error) shell.openPath(script);
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    title: "Jarvis",
    backgroundColor: "#05070a",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  window.loadURL("http://127.0.0.1:3000");
  window.on("closed", () => { window = null; });
}

app.whenReady().then(() => {
  startOllama();
  if (process.platform === "darwin" && systemPreferences.askForMediaAccess) {
    Promise.resolve(systemPreferences.askForMediaAccess("microphone")).catch(() => false);
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "microphone" || permission === "audioCapture");
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media" || permission === "microphone" || permission === "audioCapture";
  });

  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  require(path.join(app.getAppPath(), "server.js"));

  setTimeout(createWindow, 500);

  const menu = Menu.buildFromTemplate([
    { label: "Jarvis", submenu: [
      { role: "quit" },
    ] },
    { label: "View", submenu: [
      { role: "reload" },
      { role: "togglefullscreen" },
    ] },
    { label: "Mac Control", submenu: [
      { label: "Open macOS Permissions", click: openPermissions },
      { label: "Set Up Ollama / Download llama3.2", click: openOllamaSetup },
      { label: "Enable Microphone", click: async () => {
        if (process.platform === "darwin" && systemPreferences.askForMediaAccess) {
          await systemPreferences.askForMediaAccess("microphone");
        }
        if (window) {
          window.webContents.executeJavaScript("window.JarvisVoice && window.JarvisVoice.retryMicrophone()");
        }
      } },
    ] },
  ]);
  Menu.setApplicationMenu(menu);
});

app.on("window-all-closed", () => app.quit());
