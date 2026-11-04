// Command index shown in the UI palette (Ctrl+K). cmd = what gets inserted.
module.exports = [
  // INTEL
  { cat: "INTEL", cmd: "daily briefing", desc: "Time, weather, tasks, calendar, top headline" },
  { cat: "INTEL", cmd: "weather in London", desc: "Conditions + 3-day forecast (any city)" },
  { cat: "INTEL", cmd: "weather tomorrow", desc: "Tomorrow's forecast" },
  { cat: "INTEL", cmd: "news", desc: "World headlines (BBC)" },
  { cat: "INTEL", cmd: "tech news", desc: "Hacker News front page" },
  { cat: "INTEL", cmd: "bitcoin price", desc: "Live crypto prices" },
  { cat: "INTEL", cmd: "convert 100 usd to eur", desc: "Currency conversion (live rates)" },
  { cat: "INTEL", cmd: "who is nikola tesla", desc: "Wikipedia summary" },
  { cat: "INTEL", cmd: "define ephemeral", desc: "Dictionary" },
  { cat: "INTEL", cmd: "translate good morning to spanish", desc: "Translate into 25 languages" },
  { cat: "INTEL", cmd: "time in tokyo", desc: "Time in any city" },
  // TIME
  { cat: "TIME", cmd: "set a timer for 10 minutes", desc: "Countdown with spoken alert" },
  { cat: "TIME", cmd: "remind me in 30 minutes to stretch", desc: "Timed reminder" },
  { cat: "TIME", cmd: "remind me at 5pm to call mom", desc: "Clock reminder" },
  { cat: "TIME", cmd: "set an alarm for 7:30 am", desc: "Alarm" },
  { cat: "TIME", cmd: "start a focus session", desc: "25-minute focus timer" },
  { cat: "TIME", cmd: "list timers", desc: "Active timers and reminders" },
  // DATA
  { cat: "DATA", cmd: "add task ", desc: "Add to your task list" },
  { cat: "DATA", cmd: "my tasks", desc: "Read your tasks" },
  { cat: "DATA", cmd: "complete task 1", desc: "Check a task off" },
  { cat: "DATA", cmd: "take a note: ", desc: "Save a quick note" },
  { cat: "DATA", cmd: "show my notes", desc: "Read your notes" },
  { cat: "DATA", cmd: "set my city to ", desc: "Home location for weather" },
  // SYSTEM
  { cat: "SYSTEM", cmd: "system status", desc: "CPU, memory, disk, battery, uptime" },
  { cat: "SYSTEM", cmd: "what's using my cpu", desc: "Top processes" },
  { cat: "SYSTEM", cmd: "battery", desc: "Battery level" },
  { cat: "SYSTEM", cmd: "wifi", desc: "Current network" },
  { cat: "SYSTEM", cmd: "what is my ip address", desc: "Public IP, ISP, latency" },
  { cat: "SYSTEM", cmd: "screenshot", desc: "Capture screen to Desktop" },
  { cat: "SYSTEM", cmd: "volume up", desc: "Also: volume down, mute, unmute" },
  { cat: "SYSTEM", cmd: "lock screen", desc: "Lock the Mac" },
  // APPS
  { cat: "APPS", cmd: "open ", desc: "Open an app or website" },
  { cat: "APPS", cmd: "close ", desc: "Quit an app" },
  { cat: "APPS", cmd: "snap safari to the left", desc: "Window snapping (Rectangle)" },
  { cat: "APPS", cmd: "fullscreen ", desc: "Fullscreen an app" },
  { cat: "APPS", cmd: "run shortcut ", desc: "Run a Shortcuts automation" },
  { cat: "APPS", cmd: "what's on my calendar", desc: "Today's events" },
  // MEDIA
  { cat: "MEDIA", cmd: "play", desc: "Spotify / Music: play, pause, next, previous" },
  { cat: "MEDIA", cmd: "what's playing", desc: "Current track" },
  // FILES
  { cat: "FILES", cmd: "find file ", desc: "Search your home folder (Spotlight)" },
  { cat: "FILES", cmd: "create a folder called ", desc: "New folder on Desktop" },
  { cat: "FILES", cmd: "write an essay about ", desc: "Long writing, saved to Desktop" },
  // CLIPBOARD
  { cat: "CLIPBOARD", cmd: "summarize my clipboard", desc: "AI summary of copied text" },
  { cat: "CLIPBOARD", cmd: "fix my clipboard", desc: "Fix grammar of copied text" },
  { cat: "CLIPBOARD", cmd: "translate my clipboard to turkish", desc: "Translate copied text" },
  // UTILITY
  { cat: "UTILITY", cmd: "calculate 15% of 240", desc: "Calculator" },
  { cat: "UTILITY", cmd: "convert 5 km to miles", desc: "Unit conversion" },
  { cat: "UTILITY", cmd: "generate a password", desc: "Strong password → clipboard" },
  { cat: "UTILITY", cmd: "flip a coin", desc: "Also: roll a d20" },
  { cat: "UTILITY", cmd: "type ", desc: "Type text into the active app" },
  // MODES
  { cat: "MODE", cmd: "switch to friday", desc: "Also: switch to jarvis, switch to ultron" },
];
