// ClaudeDeck launcher — starts the electron-vite dev server with NO console
// window (uses CREATE_NO_WINDOW, which Windows Terminal / DefTerm cannot
// override). Compiled as a winexe so the launcher itself shows no window.
// First run (node_modules missing) opens a normal console so npm install
// progress is visible.
//
// Self-locating: works whether the .exe sits at the project root or inside
// the launcher\ subfolder — it walks up from its own location to find the
// folder that contains package.json.
using System;
using System.Diagnostics;
using System.IO;

class ClaudeDeck
{
    static void Main()
    {
        string exePath = Process.GetCurrentProcess().MainModule.FileName;
        string exeDir  = Path.GetDirectoryName(exePath);

        // find project root = nearest ancestor (incl. self) with package.json
        string root = exeDir;
        for (string d = exeDir; d != null; d = Path.GetDirectoryName(d))
        {
            if (File.Exists(Path.Combine(d, "package.json"))) { root = d; break; }
        }

        // start-dev.bat lives in <root>\launcher\ (fallback: next to the exe)
        string bat = Path.Combine(root, "launcher", "start-dev.bat");
        if (!File.Exists(bat)) bat = Path.Combine(exeDir, "start-dev.bat");

        bool firstRun = !Directory.Exists(Path.Combine(root, "node_modules"));

        var psi = new ProcessStartInfo
        {
            FileName         = "cmd.exe",
            Arguments        = "/c \"\"" + bat + "\"\"",
            WorkingDirectory = root,
        };

        if (firstRun)
        {
            // visible console so the user can watch dependency installation
            psi.UseShellExecute = true;
        }
        else
        {
            // no console at all — survives Windows Terminal being the default
            psi.UseShellExecute = false;
            psi.CreateNoWindow  = true;
        }

        Process.Start(psi);
        // launcher exits immediately; the dev server keeps running detached
    }
}
